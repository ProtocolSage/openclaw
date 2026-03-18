// src/verifier/llm-call.ts
//
// Factory that builds the LlmCallFn for the verifier.
// Routes routine checks to Codex/fastMode, deep checks to Codex/full or Grok fallback.
// No new transport -- uses OpenClaw's existing model call infrastructure.

import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildRoutinePrompt,
  buildDeepPrompt,
  parseRoutineResponse,
  parseDeepResponse,
} from "./prompts.js";
import type {
  LlmCallFn,
  VerifierCheckLevel,
  VerifierModelConfig,
  VerifierPromptInput,
  VerifierVerdict,
  RoutineVerdict,
  DeepVerdict,
} from "./types.js";
import { VERIFIER_SCHEMA_VERSION } from "./types.js";

const log = createSubsystemLogger("verifier");

// ── Types for OpenClaw's internal model call ──
// This is whatever the gateway already exposes for making LLM calls.
// Adapt the signature to match your fork's actual callModel implementation.
export type ModelCallFn = (
  modelRef: string,
  messages: Array<{ role: string; content: string }>,
  params?: Record<string, unknown>,
) => Promise<{ content: string }>;

export { parseRoutineResponse, parseDeepResponse };

// ── Parse failure fallback ──
// If the model returns garbage, default to "unclear" with low confidence.
// This is safe: it increases scan frequency without blocking.

function routineParseFailure(): RoutineVerdict {
  return {
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    aligned: "unclear",
    confidence: 0.3,
    reason: "Verification response could not be parsed",
    severity: "medium",
  };
}

function deepParseFailure(): DeepVerdict {
  return {
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    verdict: "block",
    confidence: 0.2,
    reason: "Deep verification response could not be parsed — defaulting to block",
    suggestedCorrection: null,
  };
}

// ── Deep check budget tracker ──
// Rolling window per goal per hour. Tracks timestamps of deep calls.

export class DeepCheckBudget {
  private calls: Map<string, number[]> = new Map();

  constructor(private maxPerGoalPerHour: number) {}

  canCheck(goalId: string): boolean {
    this.pruneGoal(goalId);
    const history = this.calls.get(goalId);
    return !history || history.length < this.maxPerGoalPerHour;
  }

  record(goalId: string): void {
    this.pruneGoal(goalId);
    const history = this.calls.get(goalId) ?? [];
    history.push(Date.now());
    this.calls.set(goalId, history);
  }

  private pruneGoal(goalId: string): void {
    this.prune(goalId);
  }

  /** Prune expired entries and cap memory growth. */
  prune(goalId?: string): void {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;

    if (goalId) {
      // Single-goal prune (called from canCheck/record)
      const history = this.calls.get(goalId);
      if (!history) {
        return;
      }
      const fresh = history.filter((t) => t > oneHourAgo);
      if (fresh.length === 0) {
        this.calls.delete(goalId);
      } else {
        this.calls.set(goalId, fresh.slice(-50));
      }
    } else {
      // Full prune across all goals
      for (const [gid, timestamps] of this.calls) {
        const fresh = timestamps.filter((t) => t > oneHourAgo);
        if (fresh.length === 0) {
          this.calls.delete(gid);
        } else {
          this.calls.set(gid, fresh.slice(-50));
        }
      }
    }

    // Cap total tracked goals to prevent unbounded memory growth
    if (this.calls.size > 500) {
      const sorted = [...this.calls.entries()].toSorted(
        (a, b) => Math.max(...b[1]) - Math.max(...a[1]),
      );
      this.calls = new Map(sorted.slice(0, 500));
    }
  }
}

// ── Factory ──

export interface CreateLlmCallOpts {
  modelConfig: VerifierModelConfig;
  callModel: ModelCallFn;
  deepCheckBudget: DeepCheckBudget;
}

export function createVerifierLlmCall(opts: CreateLlmCallOpts): LlmCallFn {
  const { modelConfig, callModel, deepCheckBudget } = opts;

  return async (
    prompt: VerifierPromptInput,
    level: VerifierCheckLevel,
  ): Promise<VerifierVerdict> => {
    if (level === "routine") {
      return executeRoutineCheck(prompt, modelConfig, callModel);
    } else {
      return executeDeepCheck(prompt, modelConfig, callModel, deepCheckBudget);
    }
  };
}

// ── Routine check (haiku-equivalent) ──

async function executeRoutineCheck(
  prompt: VerifierPromptInput,
  config: VerifierModelConfig,
  callModel: ModelCallFn,
): Promise<RoutineVerdict> {
  const messages = buildRoutinePrompt(prompt);

  // Try primary routine model (Codex fastMode)
  try {
    const response = await callModel(config.routine, messages, config.routineParams);
    const parsed = parseRoutineResponse(response.content);
    if (parsed) {
      return parsed;
    }
  } catch (err) {
    // Primary failed -- try fallback
    log.warn(`Routine check failed on ${config.routine}, falling back to ${config.fallback}`, {
      error: String(err),
    });
  }

  // Fallback to primary agent model
  try {
    const response = await callModel(config.fallback, messages, config.fallbackParams);
    const parsed = parseRoutineResponse(response.content);
    if (parsed) {
      return parsed;
    }
  } catch (err) {
    log.error("Routine check fallback also failed", { error: String(err) });
  }

  // Both failed -- return safe default
  return routineParseFailure();
}

// ── Deep check (sonnet-equivalent) ──

async function executeDeepCheck(
  prompt: VerifierPromptInput,
  config: VerifierModelConfig,
  callModel: ModelCallFn,
  budget: DeepCheckBudget,
): Promise<DeepVerdict> {
  const goalId = prompt.goal.id;
  const lcmAvailable = prompt.lcmContext?.available ?? false;

  // Check budget
  if (!budget.canCheck(goalId)) {
    // Budget exhausted -- soft block with reduced confidence message
    return {
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "block",
      confidence: 0.35,
      reason:
        "Deep verification budget exhausted for this goal. Blocking with reduced confidence pending next budget window.",
      suggestedCorrection: null,
    };
  }

  const messages = buildDeepPrompt(prompt);

  // Try primary deep model (Codex full reasoning)
  try {
    const response = await callModel(config.deep, messages, config.deepParams);
    const parsed = parseDeepResponse(response.content, lcmAvailable);
    if (parsed) {
      budget.record(goalId);
      return parsed;
    }
  } catch (err) {
    log.warn(`Deep check failed on ${config.deep}, falling back to ${config.fallback}`, {
      error: String(err),
    });
  }

  // Fallback
  try {
    const response = await callModel(config.fallback, messages, config.fallbackParams);
    const parsed = parseDeepResponse(response.content, lcmAvailable);
    if (parsed) {
      budget.record(goalId);
      return parsed;
    }
  } catch (err) {
    log.error("Deep check fallback also failed", { error: String(err) });
  }

  // Both failed -- block as safe default
  return deepParseFailure();
}
