import { normalizeToolName } from "../agents/tool-policy.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { OWNER_ONLY_TOOL_ERROR } from "../agents/tools/common.js";
import { generateSecureToken } from "../infra/secure-random.js";
import { redactSensitiveText } from "../logging/redact.js";
import { readSnakeCaseParamRaw } from "../param-key.js";
import { classifyTool, isReversible } from "./reversibility.js";
import type { AuditStore } from "./store.js";
import type { DecisionEntry, DecisionOutcome } from "./types.js";

const MAX_AUDIT_TEXT_LENGTH = 2048;
const wrappedDecisionLogTools = new WeakSet<object>();

function truncateAuditText(text: string | null): string | null {
  if (text === null) {
    return null;
  }
  return text.length > MAX_AUDIT_TEXT_LENGTH ? `${text.slice(0, MAX_AUDIT_TEXT_LENGTH)}…` : text;
}

function stringifyForAudit(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return JSON.stringify({
      unserializable: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function redactAndTruncate(value: unknown): string {
  return truncateAuditText(redactSensitiveText(stringifyForAudit(value))) ?? "";
}

function classifyOutcome(err: unknown): DecisionOutcome {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message === OWNER_ONLY_TOOL_ERROR ||
    message.includes("blocked") ||
    message.includes("restricted") ||
    message.includes("denied")
  ) {
    return "denied";
  }
  return "error";
}

function readAuditContextId(
  params: unknown,
  keys: readonly string[],
  fallbackId?: string,
): string | null {
  if (!params || typeof params !== "object") {
    return fallbackId ?? null;
  }
  const record = params as Record<string, unknown>;
  for (const key of keys) {
    const value = readSnakeCaseParamRaw(record, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallbackId ?? null;
}

function buildDecisionEntry(params: {
  toolName: string;
  toolInput: unknown;
  toolOutput: unknown;
  context: { agentId: string; sessionKey: string; turnId: string };
  outcome: DecisionOutcome;
  /** Timestamp of tool invocation (captured before execute). */
  invokedAt: number;
}): DecisionEntry {
  const normalizedToolName = normalizeToolName(params.toolName || "tool");
  const directGoalId = readAuditContextId(params.toolInput, ["goalId"]);
  const directTaskId = readAuditContextId(params.toolInput, ["taskId"]);
  const idValue =
    params.toolName === "goals"
      ? readAuditContextId(params.toolInput, ["id"], directGoalId ?? undefined)
      : params.toolName === "tasks"
        ? readAuditContextId(params.toolInput, ["id"], directTaskId ?? undefined)
        : undefined;
  const goalId = params.toolName === "goals" ? (idValue ?? directGoalId) : directGoalId;
  const taskId = params.toolName === "tasks" ? (idValue ?? directTaskId) : directTaskId;
  const approvalPolicy = classifyTool(normalizedToolName);
  return {
    id: `audit-${params.invokedAt.toString(36)}-${generateSecureToken(4)}`,
    agentId: params.context.agentId,
    sessionKey: params.context.sessionKey,
    turnId: params.context.turnId,
    at: params.invokedAt,
    toolName: normalizedToolName,
    toolInput: redactAndTruncate(params.toolInput),
    toolOutput:
      params.toolOutput === null
        ? null
        : truncateAuditText(redactSensitiveText(stringifyForAudit(params.toolOutput))),
    // TODO(second-wave): populate from model reasoning/thinking when available.
    rationale: null,
    goalId,
    taskId,
    reversible: isReversible(normalizedToolName),
    approvalPolicy,
    outcome: params.outcome,
  };
}

export function wrapToolWithDecisionLog(
  tool: AnyAgentTool,
  auditStore: AuditStore,
  context: { agentId: string; sessionKey: string; turnId: string },
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute || wrappedDecisionLogTools.has(tool)) {
    return tool;
  }

  const wrappedTool: AnyAgentTool = {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const invokedAt = Date.now();
      try {
        const result = await execute(toolCallId, params, signal, onUpdate);
        try {
          auditStore.append(
            buildDecisionEntry({
              toolName: tool.name,
              toolInput: params,
              toolOutput: result?.details ?? result ?? null,
              context,
              outcome: "success",
              invokedAt,
            }),
          );
        } catch {}
        return result;
      } catch (err) {
        try {
          auditStore.append(
            buildDecisionEntry({
              toolName: tool.name,
              toolInput: params,
              toolOutput: err instanceof Error ? { error: err.message } : { error: String(err) },
              context,
              outcome: classifyOutcome(err),
              invokedAt,
            }),
          );
        } catch {}
        throw err;
      }
    },
  };
  // Track both source and wrapped to prevent double-wrapping regardless of which is passed in.
  wrappedDecisionLogTools.add(tool);
  wrappedDecisionLogTools.add(wrappedTool);
  return wrappedTool;
}
