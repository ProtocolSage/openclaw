// src/verifier/inline-gate.ts
//
// Inline verification gate for tool execution.
// Wraps irreversible tools with trajectory verification before execution.
// Reversible tools (read, glob, grep, etc.) pass through without any check.

import { normalizeToolName } from "../agents/tool-policy.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { isIrreversibleForVerifier } from "../audit/reversibility.js";
import { applyTieredResponse, shouldEscalateToDeep } from "./escalation.js";
import { assembleTrajectoryContext } from "./trajectory.js";
import type { DeepVerdict, EscalationLevel, RoutineVerdict, VerifierContext } from "./types.js";

const wrappedGateTools = new WeakSet<object>();

/**
 * Maps a RoutineVerdict's alignment + confidence to a 0-1 drift score.
 *
 * - "yes"     -> low drift:  0.0 .. 0.3
 * - "unclear" -> mid drift:  0.3 .. 0.6
 * - "no"      -> high drift: 0.6 .. 1.0
 *
 * Within each band, lower confidence pushes drift higher.
 */
export function computeDriftFromVerdict(verdict: RoutineVerdict): number {
  if (verdict.aligned === "yes") {
    return Math.max(0, 1 - verdict.confidence) * 0.3;
  }
  if (verdict.aligned === "unclear") {
    return 0.3 + (1 - verdict.confidence) * 0.3;
  }
  // aligned === "no"
  return 0.6 + (1 - verdict.confidence) * 0.4;
}

/**
 * Truncates a string for inclusion in the inline gate prompt.
 * Keeps tool input summaries short to stay within token budget.
 */
function truncateForGate(input: string, maxChars = 120): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars - 1)}\u2026`;
}

/**
 * Maps a DeepVerdict to a numeric drift score.
 * "block" -> hardThreshold, "modify" -> softThreshold, "proceed" -> 0.
 */
function driftFromDeepVerdict(
  verdict: DeepVerdict,
  config: { softThreshold: number; hardThreshold: number },
): number {
  if (verdict.verdict === "block") {
    return config.hardThreshold;
  }
  if (verdict.verdict === "modify") {
    return config.softThreshold;
  }
  return 0;
}

/**
 * Wraps a tool with the inline verification gate.
 *
 * Behavior:
 * - Reversible tools pass through (no LLM check).
 * - Irreversible tools: check cache, run routine LLM check if stale/missing,
 *   escalate to deep check if uncertain, apply tiered response.
 * - Uses WeakSet double-wrap prevention (same pattern as decision-log.ts).
 */
export function wrapToolWithInlineGate(tool: AnyAgentTool, context: VerifierContext): AnyAgentTool {
  const execute = tool.execute;
  if (!execute || wrappedGateTools.has(tool)) {
    return tool;
  }
  if (!context.config.enabled) {
    return tool;
  }

  const wrappedTool: AnyAgentTool = {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const toolName = normalizeToolName(tool.name);

      // Reversible tools skip verification entirely
      if (!isIrreversibleForVerifier(toolName)) {
        return execute(toolCallId, params, signal, onUpdate);
      }

      // Find the primary active goal for this action
      const goals = await context.goalManager.getActiveGoals();
      if (goals.length === 0) {
        // No active goals -> nothing to verify against
        return execute(toolCallId, params, signal, onUpdate);
      }

      const goal = goals[0];
      const goalId = goal.id;

      // Acquire per-goal lock (serializes concurrent gate checks for same goal)
      const release = await context.cache.acquireLock(goalId);
      try {
        // Check cache first
        const cached = context.cache.get(goalId);
        if (cached && cached.driftScore < context.config.softThreshold) {
          // Cache warm + drift below soft threshold -> pass through
          return execute(toolCallId, params, signal, onUpdate);
        }

        // Cache cold/stale -> assemble trajectory context + routine check
        const promptInput = await assembleTrajectoryContext(
          {
            goalManager: context.goalManager,
            auditStore: context.auditStore,
            feedbackStore: context.feedbackStore,
            config: context.config,
          },
          goalId,
        );

        // Attach current action metadata
        promptInput.currentAction = {
          toolName,
          toolInputSummary: truncateForGate(JSON.stringify(params)),
        };

        // Routine LLM check
        const routineResult = (await context.llmCall(promptInput, "routine")) as RoutineVerdict;
        const driftScore = computeDriftFromVerdict(routineResult);

        // Determine if deep escalation is needed
        let finalDrift = driftScore;
        let escalationLevel: EscalationLevel;

        if (
          routineResult.aligned !== "yes" &&
          shouldEscalateToDeep(routineResult.confidence, 0, context.config)
        ) {
          // Deep check needed
          const deepResult = (await context.llmCall(promptInput, "deep")) as DeepVerdict;
          finalDrift = driftFromDeepVerdict(deepResult, context.config);
          escalationLevel =
            deepResult.verdict === "block"
              ? "block"
              : deepResult.verdict === "modify"
                ? "nudge"
                : "none";
        } else {
          escalationLevel = applyTieredResponse(driftScore, context.config);
        }

        // Update cache with fresh result
        context.cache.set(goalId, {
          goalId,
          driftScore: finalDrift,
          alignment: routineResult.aligned,
          lastVerifiedAt: Date.now(),
          lcmAvailable: promptInput.lcmContext?.available ?? false,
        });

        // Handle escalation response
        if (escalationLevel === "block") {
          context.sendToSession(
            `Trajectory verification blocked "${toolName}": ${routineResult.reason}`,
            "block",
          );
          throw new Error(
            `Trajectory verifier blocked tool "${toolName}": ${routineResult.reason}`,
          );
        }

        if (escalationLevel === "nudge") {
          context.sendToSession(
            `Trajectory drift detected for "${toolName}": ${routineResult.reason}`,
            "nudge",
          );
        }

        return execute(toolCallId, params, signal, onUpdate);
      } finally {
        release();
      }
    },
  };

  // Track both source and wrapped to prevent double-wrapping
  wrappedGateTools.add(tool);
  wrappedGateTools.add(wrappedTool);
  return wrappedTool;
}
