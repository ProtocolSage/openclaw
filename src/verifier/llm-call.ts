// src/verifier/llm-call.ts
//
// Factory that builds the LlmCallFn for the verifier.
// Routes routine checks to Codex/fastMode, deep checks to Codex/full or Grok fallback.
// No new transport -- uses OpenClaw's existing model call infrastructure.

import { createSubsystemLogger } from "../logging/subsystem.js";
import { buildRoutinePrompt, buildDeepPrompt } from "./prompts.js";
import type {
  LlmCallFn,
  VerifierCheckLevel,
  VerifierModelConfig,
  VerifierPromptInput,
  VerifierVerdict,
  RoutineVerdict,
  DeepVerdict,
  Alignment,
  Severity,
  DeepAction,
} from "./types.js";
import { VERIFIER_SCHEMA_VERSION, LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT } from "./types.js";

const log = createSubsystemLogger("verifier");

// ── Types for OpenClaw's internal model call ──
// This is whatever the gateway already exposes for making LLM calls.
// Adapt the signature to match your fork's actual callModel implementation.
export type ModelCallFn = (
  modelRef: string,
  messages: Array<{ role: string; content: string }>,
  params?: Record<string, unknown>,
) => Promise<{ content: string }>;

// ── Response parsing ──

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const VALID_ALIGNMENTS: Set<string> = new Set(["yes", "no", "unclear"]);
const VALID_SEVERITIES: Set<string> = new Set(["low", "medium", "high"]);
const VALID_DEEP_ACTIONS: Set<string> = new Set(["proceed", "modify", "block"]);

function extractJson(raw: string): string {
  return raw.replace(/```json|```/g, "").trim();
}

export function parseRoutineResponse(raw: string): RoutineVerdict | null {
  try {
    const parsed: unknown = JSON.parse(extractJson(raw));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    if (obj.schemaVersion !== undefined && obj.schemaVersion !== VERIFIER_SCHEMA_VERSION) {
      return null; // schema mismatch -> discard, re-evaluate
    }

    if (typeof obj.aligned !== "string" || !VALID_ALIGNMENTS.has(obj.aligned)) {
      return null;
    }
    if (typeof obj.severity !== "string" || !VALID_SEVERITIES.has(obj.severity)) {
      return null;
    }
    if (typeof obj.confidence !== "number") {
      return null;
    }
    if (typeof obj.reason !== "string") {
      return null;
    }

    return {
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: obj.aligned as Alignment,
      confidence: clamp(obj.confidence, 0, 1),
      reason: obj.reason,
      severity: obj.severity as Severity,
    };
  } catch {
    return null;
  }
}

export function parseDeepResponse(raw: string, lcmAvailable: boolean): DeepVerdict | null {
  try {
    const parsed: unknown = JSON.parse(extractJson(raw));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    if (obj.schemaVersion !== undefined && obj.schemaVersion !== VERIFIER_SCHEMA_VERSION) {
      return null;
    }

    if (typeof obj.verdict !== "string" || !VALID_DEEP_ACTIONS.has(obj.verdict)) {
      return null;
    }
    if (typeof obj.confidence !== "number") {
      return null;
    }
    if (typeof obj.reason !== "string") {
      return null;
    }

    let confidence = clamp(obj.confidence, 0, 1);

    // Apply LCM-unavailable discount
    if (!lcmAvailable) {
      confidence *= LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT;
    }

    // Validate suggestedCorrection exists as string or null
    const suggestedCorrection =
      typeof obj.suggestedCorrection === "string" ? obj.suggestedCorrection : null;

    return {
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: obj.verdict as DeepAction,
      confidence,
      reason: obj.reason,
      suggestedCorrection,
    };
  } catch {
    return null;
  }
}

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
    this.prune(goalId);
    const history = this.calls.get(goalId);
    return !history || history.length < this.maxPerGoalPerHour;
  }

  record(goalId: string): void {
    this.prune(goalId);
    const history = this.calls.get(goalId) ?? [];
    history.push(Date.now());
    this.calls.set(goalId, history);
  }

  private prune(goalId: string): void {
    const history = this.calls.get(goalId);
    if (!history) {
      return;
    }
    const oneHourAgo = Date.now() - 3_600_000;
    const pruned = history.filter((t) => t > oneHourAgo);
    if (pruned.length === 0) {
      this.calls.delete(goalId);
    } else {
      this.calls.set(goalId, pruned);
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
