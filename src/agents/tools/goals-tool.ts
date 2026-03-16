import { Type } from "@sinclair/typebox";
import { emitGoalAbandonedSignal } from "../../feedback/signals.js";
import type { FeedbackStore } from "../../feedback/store.js";
import type { GoalManager } from "../../goals/manager.js";
import type { GoalStatus } from "../../goals/types.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringArrayParam, readStringParam } from "./common.js";

const GOAL_ACTIONS = ["create", "list", "update", "close", "get"] as const;

const GoalsToolSchema = Type.Object({
  action: stringEnum(GOAL_ACTIONS),
  id: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  priority: Type.Optional(Type.Number({ minimum: 1, maximum: 5 })),
  deadline: Type.Optional(Type.String()),
  parentGoalId: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(Type.String()),
  result: Type.Optional(Type.String()),
});

export function createGoalsTool(opts: {
  goalManager: GoalManager;
  feedbackStore?: FeedbackStore;
  agentId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  const { goalManager } = opts;
  const agentId = opts.agentId ?? "default";
  const sessionKey = opts.sessionKey ?? "unknown";

  return {
    label: "Goals",
    name: "goals",
    description:
      "Manage goals: create, list, update, close, or get a specific goal. Goals represent high-level objectives with priority, deadlines, and tags.",
    parameters: GoalsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        if (action === "create") {
          const title = readStringParam(params, "title", { required: true });
          const description = readStringParam(params, "description");
          const priorityRaw = readNumberParam(params, "priority", { integer: true });
          const priority = priorityRaw
            ? (Math.max(1, Math.min(5, priorityRaw)) as 1 | 2 | 3 | 4 | 5)
            : undefined;
          const deadlineStr = readStringParam(params, "deadline");
          const deadlineMs = deadlineStr ? new Date(deadlineStr).getTime() : undefined;
          const parentGoalId = readStringParam(params, "parentGoalId");
          const tags = readStringArrayParam(params, "tags");

          if (deadlineStr && (deadlineMs === undefined || Number.isNaN(deadlineMs))) {
            return jsonResult({
              status: "error",
              error: `Invalid deadline format: ${deadlineStr}`,
            });
          }

          const goal = goalManager.createGoal({
            agentId,
            ownerSessionKey: sessionKey,
            title,
            description,
            priority,
            deadlineMs: deadlineMs ?? null,
            parentGoalId: parentGoalId ?? null,
            tags,
          });

          return jsonResult({ status: "ok", action: "create", goal });
        }

        if (action === "list") {
          const priorityFilter = readNumberParam(params, "priority", { integer: true });
          const tagsFilter = readStringArrayParam(params, "tags");
          const statusFilter = readStringParam(params, "status") as GoalStatus | undefined;

          let goals = statusFilter
            ? goalManager.listGoals(agentId, statusFilter)
            : goalManager.getActiveGoals(agentId);

          if (priorityFilter) {
            goals = goals.filter((g) => g.priority === priorityFilter);
          }
          if (tagsFilter && tagsFilter.length > 0) {
            const tagSet = new Set(tagsFilter);
            goals = goals.filter((g) => g.tags.some((t) => tagSet.has(t)));
          }

          return jsonResult({
            status: "ok",
            action: "list",
            count: goals.length,
            goals,
          });
        }

        if (action === "get") {
          const id = readStringParam(params, "id", { required: true });
          const goal = goalManager.getGoal(id);
          if (!goal) {
            return jsonResult({ status: "error", error: `Goal not found: ${id}` });
          }
          // Also include tasks for this goal
          const tasks = goalManager.listTasks({ goalId: id });
          return jsonResult({ status: "ok", action: "get", goal, tasks });
        }

        if (action === "update") {
          const id = readStringParam(params, "id", { required: true });
          const description = readStringParam(params, "description");
          const statusUpdate = readStringParam(params, "status") as GoalStatus | undefined;
          const priorityRaw = readNumberParam(params, "priority", { integer: true });
          const priority = priorityRaw
            ? (Math.max(1, Math.min(5, priorityRaw)) as 1 | 2 | 3 | 4 | 5)
            : undefined;
          const deadlineStr = readStringParam(params, "deadline");
          const tags = readStringArrayParam(params, "tags");

          let deadlineMs: number | null | undefined;
          if (deadlineStr) {
            const parsed = new Date(deadlineStr).getTime();
            if (Number.isNaN(parsed)) {
              return jsonResult({
                status: "error",
                error: `Invalid deadline format: ${deadlineStr}`,
              });
            }
            deadlineMs = parsed;
          }

          const goal = goalManager.updateGoal(id, {
            description,
            status: statusUpdate,
            priority,
            deadlineMs,
            tags,
          });

          return jsonResult({ status: "ok", action: "update", goal });
        }

        if (action === "close") {
          const id = readStringParam(params, "id", { required: true });
          const closeStatus = readStringParam(params, "status", { required: true });
          const resultNote = readStringParam(params, "result");

          if (closeStatus !== "complete" && closeStatus !== "cancelled") {
            return jsonResult({
              status: "error",
              error: `Close status must be "complete" or "cancelled", got: ${closeStatus}`,
            });
          }

          const goal = goalManager.closeGoal(id, closeStatus, resultNote);
          if (closeStatus === "cancelled") {
            emitGoalAbandonedSignal({
              feedbackStore: opts.feedbackStore,
              agentId,
              sessionKey,
              goalId: goal.id,
              reason: resultNote,
            });
          }
          return jsonResult({ status: "ok", action: "close", goal });
        }

        return jsonResult({ status: "error", error: `Unknown action: ${action}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ status: "error", error: message });
      }
    },
  };
}
