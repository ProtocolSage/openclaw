// src/verifier/store-adapters.test.ts
//
// TDD tests for gateway store adapters using real SQLite stores.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditStore } from "../audit/store.js";
import { FeedbackStore } from "../feedback/store.js";
import { createGatewayAuditReader, createGatewayFeedbackReader } from "./store-adapters.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-store-adapters-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── AuditStoreReader ────────────────────────────────────────────────────────

describe("createGatewayAuditReader", () => {
  it("returns empty array when DB file does not exist", async () => {
    const reader = createGatewayAuditReader(path.join(tmpDir, "nonexistent.db"));
    const entries = await reader.getRecentEntries("goal-1", { maxEntries: 10, maxMinutes: 60 });
    expect(entries).toEqual([]);
  });

  it("returns entries filtered by goalId", async () => {
    const dbPath = path.join(tmpDir, "audit.db");
    const store = new AuditStore();
    store.open(dbPath);
    // Seed entries for two goals
    store.append({
      id: "entry-1",
      agentId: "agent-a",
      sessionKey: "sess-1",
      turnId: "turn-1",
      at: Date.now() - 1000,
      toolName: "bash",
      toolInput: JSON.stringify({ command: "ls" }),
      toolOutput: null,
      rationale: null,
      goalId: "goal-1",
      taskId: null,
      reversible: true,
      approvalPolicy: "none",
      outcome: "success",
    });
    store.append({
      id: "entry-2",
      agentId: "agent-a",
      sessionKey: "sess-1",
      turnId: "turn-2",
      at: Date.now() - 500,
      toolName: "read_file",
      toolInput: JSON.stringify({ path: "/tmp/foo" }),
      toolOutput: null,
      rationale: null,
      goalId: "goal-2",
      taskId: null,
      reversible: true,
      approvalPolicy: "none",
      outcome: "success",
    });
    store.close();

    const reader = createGatewayAuditReader(dbPath);
    const entries = await reader.getRecentEntries("goal-1", { maxEntries: 10, maxMinutes: 60 });

    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("bash");
    expect(entries[0].outcome).toBe("success");
    expect(typeof entries[0].at).toBe("number");
  });

  it("respects maxEntries limit", async () => {
    const dbPath = path.join(tmpDir, "audit-limit.db");
    const store = new AuditStore();
    store.open(dbPath);
    for (let i = 0; i < 5; i++) {
      store.append({
        id: `entry-${i}`,
        agentId: "agent-a",
        sessionKey: "sess-1",
        turnId: `turn-${i}`,
        at: Date.now() - (5 - i) * 1000,
        toolName: "bash",
        toolInput: JSON.stringify({ command: `cmd-${i}` }),
        toolOutput: null,
        rationale: null,
        goalId: "goal-1",
        taskId: null,
        reversible: true,
        approvalPolicy: "none",
        outcome: "success",
      });
    }
    store.close();

    const reader = createGatewayAuditReader(dbPath);
    const entries = await reader.getRecentEntries("goal-1", { maxEntries: 3, maxMinutes: 60 });

    expect(entries).toHaveLength(3);
  });

  it("respects maxMinutes window by excluding old entries", async () => {
    const dbPath = path.join(tmpDir, "audit-time.db");
    const store = new AuditStore();
    store.open(dbPath);
    const now = Date.now();
    // Recent entry (1 minute ago)
    store.append({
      id: "recent",
      agentId: "agent-a",
      sessionKey: "sess-1",
      turnId: "turn-recent",
      at: now - 60_000,
      toolName: "bash",
      toolInput: "{}",
      toolOutput: null,
      rationale: null,
      goalId: "goal-1",
      taskId: null,
      reversible: true,
      approvalPolicy: "none",
      outcome: "success",
    });
    // Old entry (3 hours ago)
    store.append({
      id: "old",
      agentId: "agent-a",
      sessionKey: "sess-1",
      turnId: "turn-old",
      at: now - 3 * 60 * 60_000,
      toolName: "delete_file",
      toolInput: "{}",
      toolOutput: null,
      rationale: null,
      goalId: "goal-1",
      taskId: null,
      reversible: false,
      approvalPolicy: "none",
      outcome: "success",
    });
    store.close();

    const reader = createGatewayAuditReader(dbPath);
    // maxMinutes=90 => only entries within 90 minutes
    const entries = await reader.getRecentEntries("goal-1", { maxEntries: 10, maxMinutes: 90 });

    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("bash");
  });

  it("includes toolInput in returned entries", async () => {
    const dbPath = path.join(tmpDir, "audit-input.db");
    const store = new AuditStore();
    store.open(dbPath);
    store.append({
      id: "entry-input",
      agentId: "agent-a",
      sessionKey: "sess-1",
      turnId: "turn-1",
      at: Date.now() - 100,
      toolName: "bash",
      toolInput: JSON.stringify({ command: "echo hello" }),
      toolOutput: null,
      rationale: null,
      goalId: "goal-x",
      taskId: null,
      reversible: true,
      approvalPolicy: "none",
      outcome: "success",
    });
    store.close();

    const reader = createGatewayAuditReader(dbPath);
    const entries = await reader.getRecentEntries("goal-x", { maxEntries: 10, maxMinutes: 60 });

    expect(entries).toHaveLength(1);
    expect(entries[0].toolInput).toContain("echo hello");
  });

  it("returns empty array when no entries match the goalId", async () => {
    const dbPath = path.join(tmpDir, "audit-nomatch.db");
    const store = new AuditStore();
    store.open(dbPath);
    store.append({
      id: "entry-other",
      agentId: "agent-a",
      sessionKey: "sess-1",
      turnId: "turn-1",
      at: Date.now() - 100,
      toolName: "bash",
      toolInput: "{}",
      toolOutput: null,
      rationale: null,
      goalId: "other-goal",
      taskId: null,
      reversible: true,
      approvalPolicy: "none",
      outcome: "success",
    });
    store.close();

    const reader = createGatewayAuditReader(dbPath);
    const entries = await reader.getRecentEntries("goal-1", { maxEntries: 10, maxMinutes: 60 });

    expect(entries).toEqual([]);
  });
});

// ── FeedbackStoreReader ─────────────────────────────────────────────────────

describe("createGatewayFeedbackReader", () => {
  it("returns empty array when DB file does not exist", async () => {
    const reader = createGatewayFeedbackReader(path.join(tmpDir, "nonexistent.db"));
    const signals = await reader.getRecentSignals("goal-1");
    expect(signals).toEqual([]);
  });

  it("returns override stats as zeros when DB file does not exist", async () => {
    const reader = createGatewayFeedbackReader(path.join(tmpDir, "nonexistent.db"));
    const stats = await reader.getOverrideStats("goal-1");
    expect(stats).toEqual({ confirmed: 0, overridden: 0 });
  });

  it("returns seeded signals from DB", async () => {
    const dbPath = path.join(tmpDir, "feedback.db");
    const store = new FeedbackStore();
    store.open(dbPath);
    store.appendSignal({
      id: "sig-1",
      type: "task_outcome",
      agentId: "agent-a",
      sessionKey: "sess-1",
      at: Date.now() - 1000,
      payload: JSON.stringify({ result: "done" }),
    });
    store.appendSignal({
      id: "sig-2",
      type: "user_correction",
      agentId: "agent-a",
      sessionKey: "sess-1",
      at: Date.now() - 500,
      payload: JSON.stringify({ note: "wrong approach" }),
    });
    store.close();

    const reader = createGatewayFeedbackReader(dbPath);
    const signals = await reader.getRecentSignals("goal-1");

    expect(signals).toHaveLength(2);
    const types = signals.map((s) => s.type);
    expect(types).toContain("task_outcome");
    expect(types).toContain("user_correction");
    // payload should be parsed
    const outcome = signals.find((s) => s.type === "task_outcome");
    expect(outcome?.payload).toEqual({ result: "done" });
  });

  it("parses JSON payloads correctly", async () => {
    const dbPath = path.join(tmpDir, "feedback-payload.db");
    const store = new FeedbackStore();
    store.open(dbPath);
    store.appendSignal({
      id: "sig-json",
      type: "user_explicit",
      agentId: "agent-a",
      sessionKey: "sess-1",
      at: Date.now() - 100,
      payload: JSON.stringify({ score: 5, comment: "good" }),
    });
    store.close();

    const reader = createGatewayFeedbackReader(dbPath);
    const signals = await reader.getRecentSignals("goal-1");

    expect(signals).toHaveLength(1);
    expect(signals[0].payload).toEqual({ score: 5, comment: "good" });
    expect(typeof signals[0].at).toBe("number");
  });

  it("counts verification_result and verification_override signals", async () => {
    const dbPath = path.join(tmpDir, "feedback-stats.db");
    const store = new FeedbackStore();
    store.open(dbPath);
    // 3 verification results (confirmed)
    for (let i = 0; i < 3; i++) {
      store.appendSignal({
        id: `result-${i}`,
        type: "verification_result",
        agentId: "agent-a",
        sessionKey: "sess-1",
        at: Date.now() - (3 - i) * 1000,
        payload: JSON.stringify({ aligned: "yes" }),
      });
    }
    // 2 verification overrides
    for (let i = 0; i < 2; i++) {
      store.appendSignal({
        id: `override-${i}`,
        type: "verification_override",
        agentId: "agent-a",
        sessionKey: "sess-1",
        at: Date.now() - (2 - i) * 1000,
        payload: JSON.stringify({ reason: "user override" }),
      });
    }
    // Unrelated signal type
    store.appendSignal({
      id: "unrelated",
      type: "task_outcome",
      agentId: "agent-a",
      sessionKey: "sess-1",
      at: Date.now() - 100,
      payload: JSON.stringify({}),
    });
    store.close();

    const reader = createGatewayFeedbackReader(dbPath);
    const stats = await reader.getOverrideStats("goal-1");

    expect(stats.confirmed).toBe(3);
    expect(stats.overridden).toBe(2);
  });

  it("returns empty signals array when DB has no rows", async () => {
    const dbPath = path.join(tmpDir, "feedback-empty.db");
    const store = new FeedbackStore();
    store.open(dbPath);
    store.close();

    const reader = createGatewayFeedbackReader(dbPath);
    const signals = await reader.getRecentSignals("goal-1");

    expect(signals).toEqual([]);
  });

  it("returns zero stats when DB has no override/result signals", async () => {
    const dbPath = path.join(tmpDir, "feedback-zero-stats.db");
    const store = new FeedbackStore();
    store.open(dbPath);
    store.appendSignal({
      id: "unrelated-only",
      type: "task_outcome",
      agentId: "agent-a",
      sessionKey: "sess-1",
      at: Date.now() - 100,
      payload: "{}",
    });
    store.close();

    const reader = createGatewayFeedbackReader(dbPath);
    const stats = await reader.getOverrideStats("goal-1");

    expect(stats).toEqual({ confirmed: 0, overridden: 0 });
  });
});
