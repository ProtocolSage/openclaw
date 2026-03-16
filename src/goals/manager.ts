import { generateSecureToken } from "../infra/secure-random.js";
import { GoalStore } from "./store.js";
import type {
  CreateGoalParams,
  CreateTaskParams,
  Goal,
  GoalPatch,
  GoalStatus,
  Task,
  TaskAttempt,
  TaskFilter,
  TaskOutcome,
  TaskPatch,
  TaskStatus,
} from "./types.js";

// --- Status transition maps ---

const VALID_GOAL_TRANSITIONS: Record<string, GoalStatus[]> = {
  pending: ["active", "cancelled"],
  active: ["blocked", "complete", "cancelled"],
  blocked: ["active", "cancelled"],
  // Terminal states: no transitions out
  complete: [],
  cancelled: [],
};

const VALID_TASK_TRANSITIONS: Record<string, TaskStatus[]> = {
  pending: ["in_progress", "delegated", "failed"],
  in_progress: ["done", "failed"],
  delegated: ["in_progress", "done", "failed"],
  // Terminal states
  done: [],
  failed: [],
};

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["done", "failed"]);

function generateGoalId(): string {
  return `goal-${Date.now().toString(36)}-${generateSecureToken(4)}`;
}

function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${generateSecureToken(4)}`;
}

function generateAttemptId(): string {
  return `attempt-${Date.now().toString(36)}-${generateSecureToken(4)}`;
}

export class GoalManager {
  constructor(private readonly store: GoalStore) {}

  // --- Validation ---

  validateGoalTransition(current: GoalStatus, next: GoalStatus): boolean {
    const allowed = VALID_GOAL_TRANSITIONS[current];
    return allowed ? allowed.includes(next) : false;
  }

  validateTaskTransition(current: TaskStatus, next: TaskStatus): boolean {
    const allowed = VALID_TASK_TRANSITIONS[current];
    return allowed ? allowed.includes(next) : false;
  }

  // --- Goal CRUD ---

  createGoal(params: CreateGoalParams): Goal {
    const now = Date.now();
    const goal: Goal = {
      id: generateGoalId(),
      agentId: params.agentId,
      ownerSessionKey: params.ownerSessionKey,
      title: params.title,
      description: params.description ?? "",
      status: "pending",
      priority: params.priority ?? 3,
      deadlineMs: params.deadlineMs ?? null,
      parentGoalId: params.parentGoalId ?? null,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertGoal(goal);
    return goal;
  }

  updateGoal(id: string, patch: GoalPatch): Goal {
    const existing = this.store.getGoal(id);
    if (!existing) {
      throw new Error(`Goal not found: ${id}`);
    }

    if (patch.status !== undefined && patch.status !== existing.status) {
      if (!this.validateGoalTransition(existing.status, patch.status)) {
        throw new Error(`Invalid goal transition: ${existing.status} -> ${patch.status}`);
      }
    }

    this.store.updateGoal(id, patch);
    const updated = this.store.getGoal(id);
    if (!updated) {
      throw new Error(`Goal not found after update: ${id}`);
    }
    return updated;
  }

  closeGoal(id: string, status: "complete" | "cancelled", note?: string): Goal {
    return this.updateGoal(id, {
      status,
      ...(note !== undefined ? { description: note } : {}),
    });
  }

  getGoal(id: string): Goal | null {
    return this.store.getGoal(id);
  }

  // --- Task CRUD ---

  createTask(params: CreateTaskParams): Task {
    const now = Date.now();
    const task: Task = {
      id: generateTaskId(),
      goalId: params.goalId,
      agentId: params.agentId,
      title: params.title,
      description: params.description ?? "",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: params.dependsOn ?? [],
      result: null,
      createdAt: now,
      completedAt: null,
    };
    this.store.insertTask(task);
    return task;
  }

  updateTask(id: string, patch: TaskPatch): Task {
    const existing = this.store.getTask(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    if (patch.status !== undefined && patch.status !== existing.status) {
      if (!this.validateTaskTransition(existing.status, patch.status)) {
        throw new Error(`Invalid task transition: ${existing.status} -> ${patch.status}`);
      }
    }

    this.store.updateTask(id, patch);
    const updated = this.store.getTask(id);
    if (!updated) {
      throw new Error(`Task not found after update: ${id}`);
    }
    return updated;
  }

  completeTask(id: string, outcome: TaskOutcome, result?: string): Task {
    return this.updateTask(id, {
      status: "done",
      result: result ?? null,
      completedAt: Date.now(),
    });
  }

  failTask(id: string, reason: string): Task {
    return this.updateTask(id, {
      status: "failed",
      result: reason,
      completedAt: Date.now(),
    });
  }

  // --- Task Attempts ---

  recordAttempt(taskId: string, attempt: Omit<TaskAttempt, "id" | "taskId">): TaskAttempt {
    const full: TaskAttempt = {
      id: generateAttemptId(),
      taskId,
      ...attempt,
    };
    this.store.appendAttempt(full);
    return full;
  }

  listAttempts(taskId: string): TaskAttempt[] {
    return this.store.listAttempts(taskId);
  }

  delegateTask(id: string, params: { assignedSessionKey: string; result?: string | null }): Task {
    return this.updateTask(id, {
      status: "delegated",
      assignedSessionKey: params.assignedSessionKey,
      ...(params.result !== undefined ? { result: params.result } : {}),
    });
  }

  // --- Queries ---

  getActiveGoals(agentId: string): Goal[] {
    return this.store.listGoals({ agentId, status: "active" });
  }

  listGoals(agentId: string, status?: GoalStatus): Goal[] {
    return this.store.listGoals({ agentId, ...(status ? { status } : {}) });
  }

  getTask(id: string): Task | null {
    return this.store.getTask(id);
  }

  listTasks(filter: TaskFilter): Task[] {
    return this.store.listTasks(filter);
  }

  /**
   * Return tasks where status='pending' AND every ID in dependsOn
   * has a task with status='done'. Empty dependsOn = always ready.
   */
  getReadyTasks(agentId: string): Task[] {
    const pending = this.store.listTasks({ agentId, status: "pending" });
    return pending.filter((task) => {
      if (task.dependsOn.length === 0) {
        return true;
      }
      return task.dependsOn.every((depId) => {
        const dep = this.store.getTask(depId);
        return dep !== null && dep.status === "done";
      });
    });
  }

  /**
   * Active goals with no update within the staleness window.
   */
  getStaleGoals(agentId: string, stalenessMs: number): Goal[] {
    const cutoff = Date.now() - stalenessMs;
    const active = this.store.listGoals({ agentId, status: "active" });
    return active.filter((g) => g.updatedAt < cutoff);
  }

  /**
   * Active goals with a deadline within the given window from now.
   */
  getImminentDeadlines(agentId: string, windowMs: number): Goal[] {
    const now = Date.now();
    const horizon = now + windowMs;
    const active = this.store.listGoals({ agentId, status: "active" });
    return active.filter(
      (g) => g.deadlineMs !== null && g.deadlineMs >= now && g.deadlineMs <= horizon,
    );
  }

  /**
   * True when every task for this goal is in a terminal state (done, failed).
   * Returns true if goal has no tasks.
   */
  areAllTasksTerminal(goalId: string): boolean {
    const tasks = this.store.listTasks({ goalId });
    if (tasks.length === 0) {
      return true;
    }
    return tasks.every((t) => TERMINAL_TASK_STATUSES.has(t.status));
  }
}
