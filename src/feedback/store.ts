import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  CorrectionStatus,
  FeedbackSignal,
  FeedbackStats,
  ProposedCorrection,
  SignalFilter,
} from "./types.js";

const SIGNALS_DDL = `
CREATE TABLE IF NOT EXISTS feedback_signals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agentId TEXT NOT NULL,
  sessionKey TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_signals_agent_at ON feedback_signals(agentId, at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_signals_session_at ON feedback_signals(sessionKey, at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_signals_type_at ON feedback_signals(type, at DESC);
`;

const CORRECTIONS_DDL = `
CREATE TABLE IF NOT EXISTS feedback_corrections (
  id TEXT PRIMARY KEY,
  signalId TEXT NOT NULL,
  ruleText TEXT NOT NULL,
  sourceText TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  reviewedAt INTEGER,
  FOREIGN KEY (signalId) REFERENCES feedback_signals(id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_corrections_status ON feedback_corrections(status, createdAt DESC);
`;

function requireNodeSqlite(): typeof import("node:sqlite") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:sqlite");
}

function rowToFeedbackSignal(row: Record<string, unknown>): FeedbackSignal {
  return {
    id: row.id as string,
    type: row.type as FeedbackSignal["type"],
    agentId: row.agentId as string,
    sessionKey: row.sessionKey as string,
    at: row.at as number,
    payload: row.payload as string,
  };
}

function rowToProposedCorrection(row: Record<string, unknown>): ProposedCorrection {
  return {
    id: row.id as string,
    signalId: row.signalId as string,
    ruleText: row.ruleText as string,
    sourceText: row.sourceText as string,
    status: row.status as CorrectionStatus,
    createdAt: row.createdAt as number,
    reviewedAt: row.reviewedAt != null ? (row.reviewedAt as number) : null,
  };
}

export class FeedbackStore {
  private db: DatabaseSync | null = null;

  open(dbPath: string): void {
    const sqlite = requireNodeSqlite();
    this.db = new sqlite.DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(SIGNALS_DDL);
    this.db.exec(CORRECTIONS_DDL);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("FeedbackStore not opened");
    }
    return this.db;
  }

  appendSignal(signal: FeedbackSignal): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO feedback_signals (id, type, agentId, sessionKey, at, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(signal.id, signal.type, signal.agentId, signal.sessionKey, signal.at, signal.payload);
  }

  listSignals(filter: SignalFilter): FeedbackSignal[] {
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
    if (filter.type !== undefined) {
      clauses.push("type = ?");
      values.push(filter.type);
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
      .prepare(`SELECT * FROM feedback_signals ${where} ORDER BY at DESC${limitClause}`)
      .all(...values) as Record<string, unknown>[];
    return rows.map(rowToFeedbackSignal);
  }

  insertCorrection(correction: ProposedCorrection): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO feedback_corrections (
        id, signalId, ruleText, sourceText, status, createdAt, reviewedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      correction.id,
      correction.signalId,
      correction.ruleText,
      correction.sourceText,
      correction.status,
      correction.createdAt,
      correction.reviewedAt,
    );
  }

  getCorrection(id: string): ProposedCorrection | null {
    const db = this.requireDb();
    const row = db.prepare("SELECT * FROM feedback_corrections WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToProposedCorrection(row) : null;
  }

  listCorrections(status?: CorrectionStatus): ProposedCorrection[] {
    const db = this.requireDb();
    const rows = (
      status
        ? db
            .prepare("SELECT * FROM feedback_corrections WHERE status = ? ORDER BY createdAt DESC")
            .all(status)
        : db.prepare("SELECT * FROM feedback_corrections ORDER BY createdAt DESC").all()
    ) as Record<string, unknown>[];
    return rows.map(rowToProposedCorrection);
  }

  updateCorrectionStatus(id: string, status: CorrectionStatus): void {
    const db = this.requireDb();
    const current = this.getCorrection(id);
    if (!current) {
      throw new Error(`Correction not found: ${id}`);
    }
    if (current.status !== "proposed") {
      throw new Error(`Correction ${id} is already ${current.status}`);
    }
    if (status !== "approved" && status !== "rejected") {
      throw new Error(`Invalid correction status transition: proposed -> ${status}`);
    }
    db.prepare("UPDATE feedback_corrections SET status = ?, reviewedAt = ? WHERE id = ?").run(
      status,
      Date.now(),
      id,
    );
  }

  stats(agentId: string, since?: number): FeedbackStats {
    const db = this.requireDb();
    const clauses = ["agentId = ?"];
    const values: SQLInputValue[] = [agentId];
    if (since !== undefined) {
      clauses.push("at >= ?");
      values.push(since);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM feedback_signals ${where}`)
      .get(...values) as Record<string, unknown>;
    const typeRows = db
      .prepare(
        `SELECT type, COUNT(*) AS count
         FROM feedback_signals ${where}
         GROUP BY type
         ORDER BY count DESC, type ASC`,
      )
      .all(...values) as Record<string, unknown>[];
    return {
      total: Number(totalRow.total ?? 0),
      byType: Object.fromEntries(typeRows.map((row) => [String(row.type), Number(row.count)])),
    };
  }
}
