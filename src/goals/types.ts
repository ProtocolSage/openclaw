export type GoalStatus = "pending" | "active" | "blocked" | "complete" | "cancelled";
export type TaskStatus = "pending" | "in_progress" | "done" | "failed" | "delegated";
export type TaskOutcome = "success" | "failure" | "partial";

export interface Goal {
  id: string;
  agentId: string;
  ownerSessionKey: string;
  title: string;
  description: string;
  status: GoalStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  deadlineMs: number | null;
  parentGoalId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  goalId: string;
  agentId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedSessionKey: string | null;
  dependsOn: string[];
  result: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface TaskAttempt {
  id: string;
  taskId: string;
  runId: string;
  sessionKey: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: TaskOutcome | null;
  notes: string | null;
}

// --- Filter types ---

export interface GoalFilter {
  agentId?: string;
  status?: GoalStatus;
  priority?: number;
  tags?: string[];
  parentGoalId?: string | null;
}

export interface TaskFilter {
  goalId?: string;
  agentId?: string;
  status?: TaskStatus;
}

// --- Mutation param types ---

export interface CreateGoalParams {
  agentId: string;
  ownerSessionKey: string;
  title: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  deadlineMs?: number | null;
  parentGoalId?: string | null;
  tags?: string[];
}

export interface GoalPatch {
  title?: string;
  description?: string;
  status?: GoalStatus;
  priority?: 1 | 2 | 3 | 4 | 5;
  deadlineMs?: number | null;
  tags?: string[];
}

export interface CreateTaskParams {
  goalId: string;
  agentId: string;
  title: string;
  description?: string;
  dependsOn?: string[];
}

export interface TaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignedSessionKey?: string | null;
  dependsOn?: string[];
  result?: string | null;
  completedAt?: number | null;
}
