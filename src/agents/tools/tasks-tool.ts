import { Type } from "@sinclair/typebox";
import { emitTaskCompleteSignal, emitTaskFailedSignal } from "../../feedback/signals.js";
import type { FeedbackStore } from "../../feedback/store.js";
import type { GoalManager } from "../../goals/manager.js";
import type { TaskOutcome } from "../../goals/types.js";
import {
  checkGoalCompletionInBackground,
  type SendToSessionFn,
} from "../coordination/aggregator.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";

const TASK_ACTIONS = ["create", "list", "update", "complete", "fail", "get", "delegate"] as const;

const TasksToolSchema = Type.Object({
  action: stringEnum(TASK_ACTIONS),
  id: Type.Optional(Type.String()),
  goalId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  result: Type.Optional(Type.String()),
  agentPrompt: Type.Optional(Type.String()),
  roleId: Type.Optional(Type.String()),
  runtime: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  sandbox: Type.Optional(Type.String()),
  reportBack: Type.Optional(Type.String()),
  outcome: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
});

export function createTasksTool(opts: {
  goalManager: GoalManager;
  feedbackStore?: FeedbackStore;
  agentId?: string;
  sessionKey?: string;
  sendToSession?: SendToSessionFn;
  spawnTaskSession?: (params: {
    taskId: string;
    task: string;
    roleId?: string;
    runtime?: string;
    agentId?: string;
    model?: string;
    thinking?: string;
    runTimeoutSeconds?: number;
    sandbox?: string;
    reportBack?: string;
  }) => Promise<Record<string, unknown>>;
}): AnyAgentTool {
  const { goalManager } = opts;
  const agentId = opts.agentId ?? "default";
  const sessionKey = opts.sessionKey ?? "unknown";

  return {
    label: "Tasks",
    name: "tasks",
    description:
      "Manage tasks within goals: create, list, update, delegate, complete, fail, or get a specific task. Tasks represent concrete work items with dependency tracking.",
    parameters: TasksToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        if (action === "create") {
          const goalId = readStringParam(params, "goalId", { required: true });
          const title = readStringParam(params, "title", { required: true });
          const description = readStringParam(params, "description");
          const dependsOn = readStringArrayParam(params, "dependsOn");

          // Validate that goal exists
          const goal = goalManager.getGoal(goalId);
          if (!goal) {
            return jsonResult({
              status: "error",
              error: `Goal not found: ${goalId}`,
            });
          }

          const task = goalManager.createTask({
            goalId,
            agentId,
            title,
            description,
            dependsOn,
          });

          return jsonResult({ status: "ok", action: "create", task });
        }

        if (action === "list") {
          const goalId = readStringParam(params, "goalId");

          if (goalId) {
            const tasks = goalManager.listTasks({ goalId });
            return jsonResult({
              status: "ok",
              action: "list",
              count: tasks.length,
              tasks,
            });
          }

          // Default: list ready tasks for this agent
          const readyTasks = goalManager.getReadyTasks(agentId);
          return jsonResult({
            status: "ok",
            action: "list",
            filter: "ready",
            count: readyTasks.length,
            tasks: readyTasks,
          });
        }

        if (action === "get") {
          const id = readStringParam(params, "id", { required: true });
          const task = goalManager.getTask(id);
          if (!task) {
            return jsonResult({ status: "error", error: `Task not found: ${id}` });
          }
          return jsonResult({ status: "ok", action: "get", task });
        }

        if (action === "update") {
          const id = readStringParam(params, "id", { required: true });
          const title = readStringParam(params, "title");
          const description = readStringParam(params, "description");
          const statusStr = readStringParam(params, "status");
          const result = readStringParam(params, "result");
          const dependsOn = readStringArrayParam(params, "dependsOn");

          const patch: Record<string, unknown> = {};
          if (title !== undefined) {
            patch.title = title;
          }
          if (description !== undefined) {
            patch.description = description;
          }
          if (statusStr !== undefined) {
            patch.status = statusStr as import("../../goals/types.js").TaskStatus;
          }
          if (result !== undefined) {
            patch.result = result;
          }
          if (dependsOn !== undefined) {
            patch.dependsOn = dependsOn;
          }

          const task = goalManager.updateTask(id, patch);
          return jsonResult({ status: "ok", action: "update", task });
        }

        if (action === "delegate") {
          const id = readStringParam(params, "id", { required: true });
          const task = goalManager.getTask(id);
          if (!task) {
            return jsonResult({ status: "error", error: `Task not found: ${id}` });
          }
          if (!opts.spawnTaskSession) {
            return jsonResult({
              status: "error",
              error: "Task delegation is not supported in this context",
            });
          }
          if (
            task.status !== "delegated" &&
            !goalManager.validateTaskTransition(task.status, "delegated")
          ) {
            return jsonResult({
              status: "error",
              error: `Task ${task.id} cannot be delegated from status ${task.status}`,
            });
          }

          const spawn = await opts.spawnTaskSession({
            taskId: task.id,
            task: readStringParam(params, "agentPrompt") || task.description || task.title,
            roleId: readStringParam(params, "roleId"),
            runtime: readStringParam(params, "runtime"),
            agentId: readStringParam(params, "agentId"),
            model: readStringParam(params, "model"),
            thinking: readStringParam(params, "thinking"),
            runTimeoutSeconds:
              typeof params.runTimeoutSeconds === "number" ? params.runTimeoutSeconds : undefined,
            sandbox: readStringParam(params, "sandbox"),
            reportBack: readStringParam(params, "reportBack"),
          });
          if (spawn.status !== "accepted") {
            return jsonResult({
              status: "error",
              action: "delegate",
              task: goalManager.getTask(task.id),
              spawn,
            });
          }
          return jsonResult({
            status: "ok",
            action: "delegate",
            task: goalManager.getTask(task.id),
            spawn,
          });
        }

        if (action === "complete") {
          const id = readStringParam(params, "id", { required: true });
          const result = readStringParam(params, "result");
          const outcomeStr = readStringParam(params, "outcome") ?? "success";
          const outcome = outcomeStr as TaskOutcome;

          const task = goalManager.completeTask(id, outcome, result);
          emitTaskCompleteSignal({
            feedbackStore: opts.feedbackStore,
            agentId,
            sessionKey,
            taskId: task.id,
            goalId: task.goalId,
            quality: outcome === "success" ? "good" : outcome === "partial" ? "partial" : "poor",
            result,
          });
          checkGoalCompletionInBackground({
            goalManager,
            goalId: task.goalId,
            sendToSession: opts.sendToSession,
          });
          return jsonResult({ status: "ok", action: "complete", task });
        }

        if (action === "fail") {
          const id = readStringParam(params, "id", { required: true });
          const result = readStringParam(params, "result") ?? "No reason provided";

          const task = goalManager.failTask(id, result);
          emitTaskFailedSignal({
            feedbackStore: opts.feedbackStore,
            agentId,
            sessionKey,
            taskId: task.id,
            goalId: task.goalId,
            reason: result,
            retried: false,
          });
          checkGoalCompletionInBackground({
            goalManager,
            goalId: task.goalId,
            sendToSession: opts.sendToSession,
          });
          return jsonResult({ status: "ok", action: "fail", task });
        }

        return jsonResult({ status: "error", error: `Unknown action: ${action}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ status: "error", error: message });
      }
    },
  };
}
