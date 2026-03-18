import { Type } from "@sinclair/typebox";
import type { AuditStore } from "../../audit/store.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const AUDIT_ACTIONS = ["decisions", "why", "replay", "stats"] as const;

const AuditToolSchema = Type.Object({
  action: stringEnum(AUDIT_ACTIONS),
  id: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
  goalId: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  toolName: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  since: Type.Optional(Type.Number({ minimum: 0 })),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
});

export function createAuditTool(opts: { auditStore: AuditStore }): AnyAgentTool {
  return {
    label: "Audit",
    name: "audit",
    description:
      "Inspect decision audit logs: query recent decisions, explain one decision, replay a goal or session, or summarize tool usage statistics.",
    parameters: AuditToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        if (action === "decisions") {
          const decisions = opts.auditStore.query({
            sessionKey: readStringParam(params, "sessionKey"),
            goalId: readStringParam(params, "goalId"),
            taskId: readStringParam(params, "taskId"),
            toolName: readStringParam(params, "toolName"),
            since: readNumberParam(params, "since", { integer: true }),
            limit: readNumberParam(params, "limit", { integer: true }) ?? 20,
          });
          return jsonResult({ status: "ok", action, count: decisions.length, decisions });
        }

        if (action === "why") {
          const id = readStringParam(params, "id", { required: true });
          const entry = opts.auditStore.getById(id);
          if (!entry) {
            return jsonResult({ status: "error", error: `Audit entry not found: ${id}` });
          }
          return jsonResult({ status: "ok", action, entry });
        }

        if (action === "replay") {
          const goalId = readStringParam(params, "goalId");
          const sessionKey = readStringParam(params, "sessionKey");
          if (!goalId && !sessionKey) {
            return jsonResult({
              status: "error",
              error: "goalId or sessionKey required",
            });
          }
          const decisions = opts.auditStore
            .query({
              goalId: goalId ?? undefined,
              sessionKey: sessionKey ?? undefined,
              limit: readNumberParam(params, "limit", { integer: true }) ?? 200,
            })
            .toSorted((left, right) => left.at - right.at);
          return jsonResult({ status: "ok", action, count: decisions.length, decisions });
        }

        if (action === "stats") {
          const agentId = readStringParam(params, "agentId", { required: true });
          const stats = opts.auditStore.stats(
            agentId,
            readNumberParam(params, "since", { integer: true }),
          );
          return jsonResult({ status: "ok", action, stats });
        }

        return jsonResult({ status: "error", error: `Unknown action: ${action}` });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
