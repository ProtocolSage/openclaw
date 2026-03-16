import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { WatchRecord } from "./types.js";

type DatabaseSync = import("node:sqlite").DatabaseSync;

const WATCHES_DDL = `
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  path TEXT,
  url TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watches_kind ON watches(kind);
`;

function requireNodeSqlite(): typeof import("node:sqlite") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:sqlite");
}

function rowToWatch(row: Record<string, unknown>): WatchRecord {
  if (row.kind === "http") {
    return {
      id: row.id as string,
      kind: "http",
      url: row.url as string,
      createdAt: row.createdAt as number,
    };
  }
  return {
    id: row.id as string,
    kind: "file",
    path: row.path as string,
    createdAt: row.createdAt as number,
  };
}

export class EnvironmentWatcher {
  constructor(private readonly dbPath: string = path.join(resolveStateDir(), "watches.db")) {}

  private withDb<T>(fn: (db: DatabaseSync) => T): T {
    const sqlite = requireNodeSqlite();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = new sqlite.DatabaseSync(this.dbPath);
    try {
      db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
      db.exec(WATCHES_DDL);
      return fn(db);
    } finally {
      db.close();
    }
  }

  addFileWatch(filePath: string): WatchRecord {
    return this.withDb((db) => {
      const watch: WatchRecord = {
        id: `watch-${crypto.randomUUID()}`,
        kind: "file",
        path: filePath,
        createdAt: Date.now(),
      };
      db.prepare("INSERT INTO watches (id, kind, path, url, createdAt) VALUES (?, ?, ?, ?, ?)").run(
        watch.id,
        watch.kind,
        watch.path,
        null,
        watch.createdAt,
      );
      return watch;
    });
  }

  addHttpWatch(url: string): WatchRecord {
    return this.withDb((db) => {
      const watch: WatchRecord = {
        id: `watch-${crypto.randomUUID()}`,
        kind: "http",
        url,
        createdAt: Date.now(),
      };
      db.prepare("INSERT INTO watches (id, kind, path, url, createdAt) VALUES (?, ?, ?, ?, ?)").run(
        watch.id,
        watch.kind,
        null,
        watch.url,
        watch.createdAt,
      );
      return watch;
    });
  }

  list(): WatchRecord[] {
    return this.withDb((db) =>
      (
        db.prepare("SELECT * FROM watches ORDER BY createdAt DESC").all() as Record<
          string,
          unknown
        >[]
      ).map(rowToWatch),
    );
  }

  remove(id: string): boolean {
    return this.withDb((db) => {
      const result = db.prepare("DELETE FROM watches WHERE id = ?").run(id);
      return Number(result.changes ?? 0) > 0;
    });
  }
}

export function createDefaultEnvironmentWatcher(): EnvironmentWatcher {
  return new EnvironmentWatcher();
}
