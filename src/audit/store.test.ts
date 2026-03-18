import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditStore } from "./store.js";
import type { DecisionEntry } from "./types.js";

describe("AuditStore", () => {
  let store: AuditStore;
  let dbPath: string;

  beforeEach(() => {
    store = new AuditStore();
    dbPath = path.join(
      os.tmpdir(),
      `audit-store-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    store.open(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  function createEntry(id: string, patch: Partial<DecisionEntry> = {}): DecisionEntry {
    return {
      id,
      agentId: "agent-main",
      sessionKey: "agent:main:main",
      turnId: "turn-1",
      at: 1_700_000_000_000,
      toolName: "read",
      toolInput: '{"path":"src/index.ts"}',
      toolOutput: '{"ok":true}',
      rationale: null,
      goalId: null,
      taskId: null,
      reversible: true,
      approvalPolicy: "none",
      outcome: "success",
      ...patch,
    };
  }

  it("appends and reads entries", () => {
    store.append(createEntry("audit-1"));
    const entry = store.getById("audit-1");
    expect(entry?.toolName).toBe("read");
    expect(entry?.outcome).toBe("success");
  });

  it("queries filtered entries newest first", () => {
    store.append(createEntry("audit-1", { goalId: "goal-1", at: 1 }));
    store.append(createEntry("audit-2", { goalId: "goal-1", at: 2, toolName: "exec" }));
    store.append(createEntry("audit-3", { goalId: "goal-2", at: 3 }));
    const entries = store.query({ goalId: "goal-1" });
    expect(entries.map((entry) => entry.id)).toEqual(["audit-2", "audit-1"]);
  });

  it("computes stats by agent and time window", () => {
    store.append(createEntry("audit-1", { at: 10, outcome: "success", toolName: "read" }));
    store.append(createEntry("audit-2", { at: 11, outcome: "error", toolName: "exec" }));
    store.append(createEntry("audit-3", { at: 12, outcome: "denied", toolName: "exec" }));
    const stats = store.stats("agent-main", 11);
    expect(stats.total).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.denied).toBe(1);
    expect(stats.toolUsage).toEqual({ exec: 2 });
  });

  it("queries with since and limit filters", () => {
    store.append(createEntry("audit-1", { at: 100 }));
    store.append(createEntry("audit-2", { at: 200 }));
    store.append(createEntry("audit-3", { at: 300 }));
    const sinceFiltered = store.query({ since: 200 });
    expect(sinceFiltered.map((e) => e.id)).toEqual(["audit-3", "audit-2"]);
    const limited = store.query({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.id).toBe("audit-3");
  });

  it("does not expose update or delete mutators", () => {
    expect("update" in store).toBe(false);
    expect("delete" in store).toBe(false);
  });
});
