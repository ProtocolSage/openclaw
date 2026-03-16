import type { GoalManager } from "./manager.js";
import type { Goal } from "./types.js";

const DEFAULT_GOAL_SUMMARY_LIMIT = 3;
const DEFAULT_IMMINENT_DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

function compareGoalsForPrompt(a: Goal, b: Goal): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  if (a.deadlineMs !== null && b.deadlineMs !== null && a.deadlineMs !== b.deadlineMs) {
    return a.deadlineMs - b.deadlineMs;
  }
  if (a.deadlineMs !== null) {
    return -1;
  }
  if (b.deadlineMs !== null) {
    return 1;
  }
  return b.updatedAt - a.updatedAt;
}

function formatDeadline(deadlineMs: number | null, now: number): string | undefined {
  if (deadlineMs === null) {
    return undefined;
  }
  const deltaMs = deadlineMs - now;
  if (deltaMs <= 0) {
    return "overdue";
  }
  const hours = Math.ceil(deltaMs / (60 * 60 * 1000));
  if (hours < 24) {
    return `due in ${hours}h`;
  }
  const days = Math.ceil(deltaMs / (24 * 60 * 60 * 1000));
  return `due in ${days}d`;
}

export function buildActiveGoalsPromptSummary(params: {
  goalManager: GoalManager;
  agentId: string;
  limit?: number;
  now?: number;
  imminentDeadlineWindowMs?: number;
}): string | undefined {
  const limit = params.limit ?? DEFAULT_GOAL_SUMMARY_LIMIT;
  const now = params.now ?? Date.now();
  const activeGoals = params.goalManager.getActiveGoals(params.agentId);

  if (activeGoals.length === 0) {
    return undefined;
  }

  const imminentGoalIds = new Set(
    params.goalManager
      .getImminentDeadlines(
        params.agentId,
        params.imminentDeadlineWindowMs ?? DEFAULT_IMMINENT_DEADLINE_WINDOW_MS,
      )
      .map((goal) => goal.id),
  );
  const readyTasks = params.goalManager.getReadyTasks(params.agentId);
  const readyTaskCountByGoal = new Map<string, number>();
  for (const task of readyTasks) {
    readyTaskCountByGoal.set(task.goalId, (readyTaskCountByGoal.get(task.goalId) ?? 0) + 1);
  }

  const lines = [
    "## Active Goals",
    ...activeGoals
      .toSorted(compareGoalsForPrompt)
      .slice(0, limit)
      .map((goal) => {
        const parts = [`p${goal.priority}`];
        const readyCount = readyTaskCountByGoal.get(goal.id) ?? 0;
        if (readyCount > 0) {
          parts.push(`ready tasks: ${readyCount}`);
        }
        const deadlineLabel = formatDeadline(goal.deadlineMs, now);
        if (deadlineLabel) {
          parts.push(deadlineLabel);
        }
        if (imminentGoalIds.has(goal.id)) {
          parts.push("deadline soon");
        }
        return `- ${goal.title} (${parts.join(", ")})`;
      }),
    "Use the goals/tasks tools when you need more detail or need to update state.",
  ];

  if (activeGoals.length > limit) {
    lines.push(`There are ${activeGoals.length - limit} more active goals not shown here.`);
  }

  return lines.join("\n");
}
