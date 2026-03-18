// src/verifier/outcome-assertion.ts
//
// Post-execution outcome assertion for the verifier.
// Inspects actual tool results after execution and injects ground-truth
// signals into the session. This prevents the agent from misreporting
// execution outcomes (e.g., claiming "tests pass" when exit code was 1).
//
// Designed to wrap tools AFTER the inline gate and decision log.

import { normalizeToolName } from "../agents/tool-policy.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { EscalationLevel, VerifierContext } from "./types.js";

const log = createSubsystemLogger("verifier");

// ── Outcome classification ──

export type OutcomeClassification = "pass" | "fail" | "indeterminate";

export interface OutcomeAssertion {
  classification: OutcomeClassification;
  evidence: string;
  exitCode?: number;
  toolName: string;
  at: number;
}

// ── Failure detection patterns ──

const FAILURE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(\d+)\s+failed/i, label: "test failures detected" },
  { pattern: /FAIL\s/m, label: "FAIL marker in output" },
  { pattern: /ELIFECYCLE/i, label: "npm lifecycle error" },
  { pattern: /Command failed with exit code\s+\d+/i, label: "command failed" },
  { pattern: /error\s+TS\d+/i, label: "TypeScript compilation error" },
  { pattern: /ERR_MODULE_NOT_FOUND/i, label: "missing module" },
  { pattern: /SyntaxError:/m, label: "syntax error" },
  { pattern: /Cannot find module/m, label: "missing module" },
];

// ── Tools that produce classifiable output ──

const EXEC_TOOL_NAMES = new Set(["exec", "bash", "shell", "command"]);

function isExecTool(toolName: string): boolean {
  return EXEC_TOOL_NAMES.has(normalizeToolName(toolName));
}

// ── Extract exec details from tool result ──

interface ExecDetails {
  status: string;
  exitCode: number | null;
  aggregated?: string;
}

function extractExecDetails(result: unknown): ExecDetails | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const r = result as Record<string, unknown>;

  // Direct details object (from ExecToolDetails)
  if (typeof r.status === "string" && "exitCode" in r) {
    return {
      status: r.status,
      exitCode: r.exitCode as number | null, // exitCode can be number or null
      aggregated: typeof r.aggregated === "string" ? r.aggregated : undefined,
    };
  }

  // Nested in details field
  if (r.details && typeof r.details === "object") {
    return extractExecDetails(r.details);
  }

  return null;
}

// ── Classify outcome from exec result ──

export function classifyExecOutcome(details: ExecDetails): OutcomeAssertion {
  const at = Date.now();

  // Non-zero exit code is an unambiguous failure signal
  if (details.exitCode !== null && details.exitCode !== 0) {
    let evidence = `exit code ${details.exitCode}`;

    // Look for specific failure patterns in output
    if (details.aggregated) {
      for (const { pattern, label } of FAILURE_PATTERNS) {
        if (pattern.test(details.aggregated)) {
          evidence += ` (${label})`;
          break;
        }
      }
    }

    return {
      classification: "fail",
      evidence,
      exitCode: details.exitCode,
      toolName: "exec",
      at,
    };
  }

  // Exit code 0 but check for failure patterns in output (some tools exit 0 on failure)
  if (details.aggregated) {
    for (const { pattern, label } of FAILURE_PATTERNS) {
      if (pattern.test(details.aggregated)) {
        return {
          classification: "fail",
          evidence: `exit code 0 but output contains: ${label}`,
          exitCode: details.exitCode ?? 0,
          toolName: "exec",
          at,
        };
      }
    }
  }

  // Running/pending status is indeterminate
  if (details.status === "running" || details.status.startsWith("approval")) {
    return {
      classification: "indeterminate",
      evidence: `status: ${details.status}`,
      toolName: "exec",
      at,
    };
  }

  return {
    classification: "pass",
    evidence: `exit code ${details.exitCode ?? 0}`,
    exitCode: details.exitCode ?? 0,
    toolName: "exec",
    at,
  };
}

// ── Format ground-truth message ──

function formatGroundTruth(assertion: OutcomeAssertion, command?: string): string {
  const prefix = "[verifier:outcome]";
  const cmd = command ? ` \`${command.slice(0, 80)}\`` : "";

  if (assertion.classification === "fail") {
    return `${prefix} FAILED${cmd} — ${assertion.evidence}`;
  }
  if (assertion.classification === "indeterminate") {
    return `${prefix} INDETERMINATE${cmd} — ${assertion.evidence}`;
  }
  return `${prefix} PASSED${cmd} — ${assertion.evidence}`;
}

// ── Tool wrapper ──

const wrappedOutcomeTools = new WeakSet<object>();

/**
 * Wraps exec-type tools with post-execution outcome assertion.
 *
 * After the tool executes, inspects the result for failure signals.
 * On failure:
 *  - Invalidates the verifier cache for the active goal (forces re-check)
 *  - Sends a ground-truth session message the agent cannot ignore
 *  - Logs the assertion for audit trail
 *
 * On pass/indeterminate: logs only (no session injection).
 */
export function wrapToolWithOutcomeAssertion(
  tool: AnyAgentTool,
  context: VerifierContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute || wrappedOutcomeTools.has(tool)) {
    return tool;
  }
  if (!context.config.enabled) {
    return tool;
  }

  const toolName = normalizeToolName(tool.name);
  if (!isExecTool(toolName)) {
    return tool;
  }

  const wrappedTool: AnyAgentTool = {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      // Extract command for context (needed in both success and error paths)
      const command =
        typeof params === "object" && params !== null
          ? ((params as Record<string, unknown>).command as string | undefined)
          : undefined;

      let result: Awaited<ReturnType<typeof execute>>;
      try {
        result = await execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        // Exec tool rejects on non-zero exit — classify the thrown error as a failure
        const errMsg = err instanceof Error ? err.message : String(err);
        const assertion: OutcomeAssertion = {
          classification: "fail",
          evidence: `exec threw: ${errMsg.slice(0, 120)}`,
          toolName,
          at: Date.now(),
        };

        // Check for known failure patterns in the error message
        for (const { pattern, label } of FAILURE_PATTERNS) {
          if (pattern.test(errMsg)) {
            assertion.evidence += ` (${label})`;
            break;
          }
        }

        const groundTruth = formatGroundTruth(assertion, command);
        log.warn(groundTruth);

        const goals = await context.goalManager.getActiveGoals();
        if (goals.length > 0) {
          context.cache.invalidate(goals[0].id);
        }
        context.sendToSession(groundTruth, "nudge" as EscalationLevel);

        throw err;
      }

      // Extract exec details from resolved result
      const details = extractExecDetails(result?.details ?? result);
      if (!details) {
        return result;
      }

      const assertion = classifyExecOutcome(details);
      assertion.toolName = toolName;

      if (assertion.classification === "fail") {
        const groundTruth = formatGroundTruth(assertion, command);

        log.warn(groundTruth);

        // Invalidate cache for active goal — force verifier re-check
        const goals = await context.goalManager.getActiveGoals();
        if (goals.length > 0) {
          context.cache.invalidate(goals[0].id);
        }

        // Inject ground truth into session
        context.sendToSession(groundTruth, "nudge" as EscalationLevel);
      } else {
        log.debug?.(formatGroundTruth(assertion, command));
      }

      return result;
    },
  };

  wrappedOutcomeTools.add(tool);
  wrappedOutcomeTools.add(wrappedTool);
  return wrappedTool;
}
