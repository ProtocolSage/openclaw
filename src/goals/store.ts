import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Goal, GoalFilter, Task, TaskAttempt, TaskFilter } from "./types.js";

const GOALS_DDL = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  ownerSessionKey TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 3,
  deadlineMs INTEGER,
  parentGoalId TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_agentId_status ON goals(agentId, status);
`;

const TASKS_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goalId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  assignedSessionKey TEXT,
  dependsOn TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  createdAt INTEGER NOT NULL,
  completedAt INTEGER,
  FOREIGN KEY (goalId) REFERENCES goals(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_goalId ON tasks(goalId);
CREATE INDEX IF NOT EXISTS idx_tasks_agentId_status ON tasks(agentId, status);
`;

const TASK_ATTEMPTS_DDL = `
CREATE TABLE IF NOT EXISTS task_attempts (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  runId TEXT NOT NULL,
  sessionKey TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  finishedAt INTEGER,
  outcome TEXT,
  notes TEXT,
  FOREIGN KEY (taskId) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_task_attempts_taskId ON task_attempts(taskId);
`;

function requireNodeSqlite(): typeof import("node:sqlite") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:sqlite");
}

/** Parse a JSON text column into a string array, safely. */
function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Map a raw SQLite row to a Goal object. */
function rowToGoal(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    agentId: row.agentId as string,
    ownerSessionKey: row.ownerSessionKey as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as Goal["status"],
    priority: row.priority as Goal["priority"],
    deadlineMs: row.deadlineMs != null ? (row.deadlineMs as number) : null,
    parentGoalId: row.parentGoalId != null ? (row.parentGoalId as string) : null,
    tags: parseJsonArray(row.tags),
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
  };
}

/** Map a raw SQLite row to a Task object. */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    goalId: row.goalId as string,
    agentId: row.agentId as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as Task["status"],
    assignedSessionKey: row.assignedSessionKey != null ? (row.assignedSessionKey as string) : null,
    dependsOn: parseJsonArray(row.dependsOn),
    result: row.result != null ? (row.result as string) : null,
    createdAt: row.createdAt as number,
    completedAt: row.completedAt != null ? (row.completedAt as number) : null,
  };
}

/** Map a raw SQLite row to a TaskAttempt object. */
function rowToAttempt(row: Record<string, unknown>): TaskAttempt {
  return {
    id: row.id as string,
    taskId: row.taskId as string,
    runId: row.runId as string,
    sessionKey: row.sessionKey as string,
    startedAt: row.startedAt as number,
    finishedAt: row.finishedAt != null ? (row.finishedAt as number) : null,
    outcome: row.outcome != null ? (row.outcome as TaskAttempt["outcome"]) : null,
    notes: row.notes != null ? (row.notes as string) : null,
  };
}

export class GoalStore {
  private db: DatabaseSync | null = null;

  open(dbPath: string): void {
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(GOALS_DDL);
    this.db.exec(TASKS_DDL);
    this.db.exec(TASK_ATTEMPTS_DDL);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("GoalStore not opened");
    }
    return this.db;
  }

  // --- Goals ---

  insertGoal(goal: Goal): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO goals (id, agentId, ownerSessionKey, title, description, status, priority, deadlineMs, parentGoalId, tags, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      goal.id,
      goal.agentId,
      goal.ownerSessionKey,
      goal.title,
      goal.description,
      goal.status,
      goal.priority,
      goal.deadlineMs,
      goal.parentGoalId,
      JSON.stringify(goal.tags),
      goal.createdAt,
      goal.updatedAt,
    );
  }

  updateGoal(id: string, patch: Partial<Goal>): void {
    const db = this.requireDb();
    const setClauses: string[] = [];
    const values: SQLInputValue[] = [];

    if (patch.title !== undefined) {
      setClauses.push("title = ?");
      values.push(patch.title);
    }
    if (patch.description !== undefined) {
      setClauses.push("description = ?");
      values.push(patch.description);
    }
    if (patch.status !== undefined) {
      setClauses.push("status = ?");
      values.push(patch.status);
    }
    if (patch.priority !== undefined) {
      setClauses.push("priority = ?");
      values.push(patch.priority);
    }
    if (patch.deadlineMs !== undefined) {
      setClauses.push("deadlineMs = ?");
      values.push(patch.deadlineMs);
    }
    if (patch.tags !== undefined) {
      setClauses.push("tags = ?");
      values.push(JSON.stringify(patch.tags));
    }

    if (setClauses.length === 0) {
      return;
    }

    setClauses.push("updatedAt = ?");
    values.push(Date.now());
    values.push(id);

    db.prepare(`UPDATE goals SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  }

  getGoal(id: string): Goal | null {
    const db = this.requireDb();
    const row = db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToGoal(row) : null;
  }

  listGoals(filter: GoalFilter): Goal[] {
    const db = this.requireDb();
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];

    if (filter.agentId !== undefined) {
      clauses.push("agentId = ?");
      values.push(filter.agentId);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    if (filter.priority !== undefined) {
      clauses.push("priority = ?");
      values.push(filter.priority);
    }
    if (filter.parentGoalId !== undefined) {
      if (filter.parentGoalId === null) {
        clauses.push("parentGoalId IS NULL");
      } else {
        clauses.push("parentGoalId = ?");
        values.push(filter.parentGoalId);
      }
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM goals ${where} ORDER BY createdAt DESC`)
      .all(...values) as Record<string, unknown>[];

    let goals = rows.map(rowToGoal);

    // Tag filtering is done in-app since tags is a JSON array column
    if (filter.tags && filter.tags.length > 0) {
      const filterTags = new Set(filter.tags);
      goals = goals.filter((g) => g.tags.some((t) => filterTags.has(t)));
    }

    return goals;
  }

  // --- Tasks ---

  insertTask(task: Task): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO tasks (id, goalId, agentId, title, description, status, assignedSessionKey, dependsOn, result, createdAt, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      task.id,
      task.goalId,
      task.agentId,
      task.title,
      task.description,
      task.status,
      task.assignedSessionKey,
      JSON.stringify(task.dependsOn),
      task.result,
      task.createdAt,
      task.completedAt,
    );
  }

  updateTask(id: string, patch: Partial<Task>): void {
    const db = this.requireDb();
    const setClauses: string[] = [];
    const values: SQLInputValue[] = [];

    if (patch.title !== undefined) {
      setClauses.push("title = ?");
      values.push(patch.title);
    }
    if (patch.description !== undefined) {
      setClauses.push("description = ?");
      values.push(patch.description);
    }
    if (patch.status !== undefined) {
      setClauses.push("status = ?");
      values.push(patch.status);
    }
    if (patch.assignedSessionKey !== undefined) {
      setClauses.push("assignedSessionKey = ?");
      values.push(patch.assignedSessionKey);
    }
    if (patch.dependsOn !== undefined) {
      setClauses.push("dependsOn = ?");
      values.push(JSON.stringify(patch.dependsOn));
    }
    if (patch.result !== undefined) {
      setClauses.push("result = ?");
      values.push(patch.result);
    }
    if (patch.completedAt !== undefined) {
      setClauses.push("completedAt = ?");
      values.push(patch.completedAt);
    }

    if (setClauses.length === 0) {
      return;
    }
    values.push(id);

    db.prepare(`UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  }

  getTask(id: string): Task | null {
    const db = this.requireDb();
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToTask(row) : null;
  }

  listTasks(filter: TaskFilter): Task[] {
    const db = this.requireDb();
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];

    if (filter.goalId !== undefined) {
      clauses.push("goalId = ?");
      values.push(filter.goalId);
    }
    if (filter.agentId !== undefined) {
      clauses.push("agentId = ?");
      values.push(filter.agentId);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY createdAt ASC`)
      .all(...values) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  // --- Task Attempts ---

  appendAttempt(attempt: TaskAttempt): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO task_attempts (id, taskId, runId, sessionKey, startedAt, finishedAt, outcome, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attempt.id,
      attempt.taskId,
      attempt.runId,
      attempt.sessionKey,
      attempt.startedAt,
      attempt.finishedAt,
      attempt.outcome,
      attempt.notes,
    );
  }

  listAttempts(taskId: string): TaskAttempt[] {
    const db = this.requireDb();
    const rows = db
      .prepare("SELECT * FROM task_attempts WHERE taskId = ? ORDER BY startedAt ASC")
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToAttempt);
  }
}
