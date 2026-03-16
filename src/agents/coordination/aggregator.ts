import type { GoalManager } from "../../goals/manager.js";
import type { Goal, Task } from "../../goals/types.js";

export type SendToSessionFn = (sessionKey: string, message: string) => Promise<void> | void;

export type GoalCompletionCheckResult =
  | { status: "goal-missing" }
  | { status: "incomplete"; goal: Goal; tasks: Task[] }
  | { status: "completed"; goal: Goal; tasks: Task[]; message: string }
  | { status: "blocked"; goal: Goal; tasks: Task[]; message: string };

function summarizeTaskTitles(tasks: Task[], status: "done" | "failed"): string {
  return tasks
    .filter((task) => task.status === status)
    .map((task) => task.title)
    .join(", ");
}

export async function checkGoalCompletion(params: {
  goalManager: GoalManager;
  goalId: string;
  sendToSession?: SendToSessionFn;
}): Promise<GoalCompletionCheckResult> {
  const goal = params.goalManager.getGoal(params.goalId);
  if (!goal) {
    return { status: "goal-missing" };
  }

  const tasks = params.goalManager.listTasks({ goalId: goal.id });
  if (!params.goalManager.areAllTasksTerminal(goal.id)) {
    return { status: "incomplete", goal, tasks };
  }

  const failedTasks = tasks.filter((task) => task.status === "failed");
  if (failedTasks.length > 0) {
    const blockedGoal =
      goal.status === "active" && params.goalManager.validateGoalTransition(goal.status, "blocked")
        ? params.goalManager.updateGoal(goal.id, { status: "blocked" })
        : goal;
    const message = `Goal "${blockedGoal.title}" is blocked. Failed tasks: ${summarizeTaskTitles(tasks, "failed") || "unknown"}.`;
    await params.sendToSession?.(blockedGoal.ownerSessionKey, message);
    return {
      status: "blocked",
      goal: blockedGoal,
      tasks,
      message,
    };
  }

  let completedGoal = goal;
  if (
    goal.status === "pending" &&
    params.goalManager.validateGoalTransition(goal.status, "active")
  ) {
    completedGoal = params.goalManager.updateGoal(goal.id, { status: "active" });
  }
  if (params.goalManager.validateGoalTransition(completedGoal.status, "complete")) {
    completedGoal = params.goalManager.closeGoal(goal.id, "complete");
  }
  const message = `Goal "${completedGoal.title}" is complete. Finished tasks: ${summarizeTaskTitles(tasks, "done") || "unknown"}.`;
  await params.sendToSession?.(completedGoal.ownerSessionKey, message);
  return {
    status: "completed",
    goal: completedGoal,
    tasks,
    message,
  };
}

export function checkGoalCompletionInBackground(params: {
  goalManager: GoalManager;
  goalId: string;
  sendToSession?: SendToSessionFn;
}): void {
  void checkGoalCompletion(params).catch(() => {});
}
