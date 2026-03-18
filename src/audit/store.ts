import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { AuditFilter, AuditStats, DecisionEntry, DecisionOutcome } from "./types.js";

const AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  sessionKey TEXT NOT NULL,
  turnId TEXT NOT NULL,
  at INTEGER NOT NULL,
  toolName TEXT NOT NULL,
  toolInput TEXT NOT NULL,
  toolOutput TEXT,
  rationale TEXT,
  goalId TEXT,
  taskId TEXT,
  reversible INTEGER NOT NULL,
  approvalPolicy TEXT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_agent_at ON audit_entries(agentId, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_session_at ON audit_entries(sessionKey, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_goal_at ON audit_entries(goalId, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_task_at ON audit_entries(taskId, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tool_at ON audit_entries(toolName, at DESC);
`;

function requireNodeSqlite(): typeof import("node:sqlite") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:sqlite");
}

function rowToDecisionEntry(row: Record<string, unknown>): DecisionEntry {
  return {
    id: row.id as string,
    agentId: row.agentId as string,
    sessionKey: row.sessionKey as string,
    turnId: row.turnId as string,
    at: row.at as number,
    toolName: row.toolName as string,
    toolInput: row.toolInput as string,
    toolOutput: row.toolOutput != null ? (row.toolOutput as string) : null,
    rationale: row.rationale != null ? (row.rationale as string) : null,
    goalId: row.goalId != null ? (row.goalId as string) : null,
    taskId: row.taskId != null ? (row.taskId as string) : null,
    reversible: Boolean(row.reversible),
    approvalPolicy: row.approvalPolicy as DecisionEntry["approvalPolicy"],
    outcome: row.outcome as DecisionOutcome,
  };
}

export class AuditStore {
  private db: DatabaseSync | null = null;

  open(dbPath: string): void {
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(AUDIT_DDL);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("AuditStore not opened");
    }
    return this.db;
  }

  append(entry: DecisionEntry): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO audit_entries (
        id, agentId, sessionKey, turnId, at, toolName, toolInput, toolOutput,
        rationale, goalId, taskId, reversible, approvalPolicy, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.agentId,
      entry.sessionKey,
      entry.turnId,
      entry.at,
      entry.toolName,
      entry.toolInput,
      entry.toolOutput,
      entry.rationale,
      entry.goalId,
      entry.taskId,
      entry.reversible ? 1 : 0,
      entry.approvalPolicy,
      entry.outcome,
    );
  }

  query(filter: AuditFilter): DecisionEntry[] {
    const db = this.requireDb();
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];

    if (filter.agentId !== undefined) {
      clauses.push("agentId = ?");
      values.push(filter.agentId);
    }
    if (filter.sessionKey !== undefined) {
      clauses.push("sessionKey = ?");
      values.push(filter.sessionKey);
    }
    if (filter.goalId !== undefined) {
      clauses.push("goalId = ?");
      values.push(filter.goalId);
    }
    if (filter.taskId !== undefined) {
      clauses.push("taskId = ?");
      values.push(filter.taskId);
    }
    if (filter.toolName !== undefined) {
      clauses.push("toolName = ?");
      values.push(filter.toolName);
    }
    if (filter.since !== undefined) {
      clauses.push("at >= ?");
      values.push(filter.since);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause =
      typeof filter.limit === "number" && Number.isFinite(filter.limit) && filter.limit > 0
        ? ` LIMIT ${Math.trunc(filter.limit)}`
        : "";
    const rows = db
      .prepare(`SELECT * FROM audit_entries ${where} ORDER BY at DESC${limitClause}`)
      .all(...values) as Record<string, unknown>[];
    return rows.map(rowToDecisionEntry);
  }

  getById(id: string): DecisionEntry | null {
    const db = this.requireDb();
    const row = db.prepare("SELECT * FROM audit_entries WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToDecisionEntry(row) : null;
  }

  stats(agentId: string, since?: number): AuditStats {
    const db = this.requireDb();
    const clauses = ["agentId = ?"];
    const values: SQLInputValue[] = [agentId];
    if (since !== undefined) {
      clauses.push("at >= ?");
      values.push(since);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const totals = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
           SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied
         FROM audit_entries ${where}`,
      )
      .get(...values) as Record<string, unknown>;
    const usageRows = db
      .prepare(
        `SELECT toolName, COUNT(*) AS count
         FROM audit_entries ${where}
         GROUP BY toolName
         ORDER BY count DESC, toolName ASC`,
      )
      .all(...values) as Record<string, unknown>[];
    const toolUsage = Object.fromEntries(
      usageRows.map((row) => [String(row.toolName), Number(row.count ?? 0)]),
    );
    return {
      total: Number(totals.total ?? 0),
      errors: Number(totals.errors ?? 0),
      denied: Number(totals.denied ?? 0),
      toolUsage,
    };
  }
}
