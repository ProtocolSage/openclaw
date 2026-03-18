import { describe, expect, it, vi } from "vitest";
import { assembleTrajectoryContext, computeDriftScore, type TrajectoryDeps } from "./trajectory.js";
import type {
  AuditStoreReader,
  FeedbackStoreReader,
  GoalManagerReader,
  VerifierConfig,
} from "./types.js";

// ── Helpers ──

function makeConfig(overrides?: Partial<VerifierConfig["tokenBudget"]>): VerifierConfig {
  return {
    enabled: true,
    scanIntervalMins: 5,
    scanIntervalUnclearMins: 2,
    cacheTtlMs: 60_000,
    softThreshold: 0.4,
    hardThreshold: 0.7,
    calibration: {
      minThreshold: 0.1,
      maxThreshold: 0.9,
      decayAlpha: 0.1,
    },
    escalation: {
      sonnetBudgetPerGoalPerHour: 3,
      cooldownMs: 30_000,
      baseEscalationThreshold: 0.6,
      lcmUnavailableConfidenceDiscount: 0.7,
    },
    tokenBudget: {
      toolInputTruncateChars: 120,
      auditWindowMaxEntries: 50,
      auditWindowMaxMinutes: 30,
      ...overrides,
    },
    models: {
      routine: "openai-codex/gpt-5.4",
      routineParams: {},
      deep: "openai-codex/gpt-5.4",
      deepParams: {},
      fallback: "xai/grok-4-1-fast-reasoning",
      fallbackParams: {},
    },
  };
}

function makeDeps(overrides?: Partial<TrajectoryDeps>): TrajectoryDeps {
  const goalManager: GoalManagerReader = {
    getActiveGoals: vi.fn<GoalManagerReader["getActiveGoals"]>().mockResolvedValue([
      {
        id: "goal-1",
        title: "Ship feature X",
        status: "active",
        deadlineMs: Date.now() + 86_400_000,
        priority: "high",
      },
    ]),
    getTasksForGoal: vi.fn<GoalManagerReader["getTasksForGoal"]>().mockResolvedValue([
      { title: "Write tests", status: "done", lastUpdatedAt: Date.now() - 5000 },
      { title: "Implement logic", status: "in_progress", lastUpdatedAt: Date.now() },
    ]),
  };

  const auditStore: AuditStoreReader = {
    getRecentEntries: vi.fn<AuditStoreReader["getRecentEntries"]>().mockResolvedValue([
      { toolName: "file_write", outcome: "success", at: Date.now() - 2000 },
      { toolName: "shell_exec", outcome: "error", at: Date.now() - 1000 },
    ]),
  };

  const feedbackStore: FeedbackStoreReader = {
    getRecentSignals: vi
      .fn<FeedbackStoreReader["getRecentSignals"]>()
      .mockResolvedValue([
        { type: "user_correction", payload: { note: "wrong file" }, at: Date.now() - 500 },
      ]),
    getOverrideStats: vi.fn<FeedbackStoreReader["getOverrideStats"]>().mockResolvedValue({
      confirmed: 5,
      overridden: 1,
    }),
  };

  return {
    goalManager,
    auditStore,
    feedbackStore,
    config: makeConfig(),
    ...overrides,
  };
}

// ── computeDriftScore ──

describe("computeDriftScore", () => {
  it("returns 0 for empty entries", () => {
    expect(computeDriftScore([], [])).toBe(0);
  });

  it("returns low drift (~0) for all success outcomes", () => {
    const now = Date.now();
    const entries = Array.from({ length: 10 }, (_, i) => ({
      toolName: "file_read",
      outcome: "success",
      at: now - i * 1000,
    }));
    const score = computeDriftScore(entries, []);
    expect(score).toBeCloseTo(0, 1);
  });

  it("returns higher drift for recent errors", () => {
    const now = Date.now();
    const entries = [
      { toolName: "shell_exec", outcome: "error", at: now - 100 },
      { toolName: "shell_exec", outcome: "error", at: now - 200 },
      { toolName: "file_read", outcome: "success", at: now - 300 },
    ];
    const score = computeDriftScore(entries, []);
    expect(score).toBeGreaterThan(0.1);
  });

  it("returns lower drift for old errors due to decay", () => {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;

    // Recent errors
    const recentEntries = [{ toolName: "shell_exec", outcome: "error", at: now - 100 }];
    const recentScore = computeDriftScore(recentEntries, []);

    // Old errors (well past the decay window)
    const oldEntries = [{ toolName: "shell_exec", outcome: "error", at: now - windowMs * 5 }];
    const oldScore = computeDriftScore(oldEntries, []);

    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it("increases drift for user_correction feedback", () => {
    const now = Date.now();
    const entries = [{ toolName: "file_read", outcome: "success", at: now - 100 }];
    const scoreWithout = computeDriftScore(entries, []);

    const feedback = [{ type: "user_correction", payload: { note: "wrong" }, at: now - 50 }];
    const scoreWith = computeDriftScore(entries, feedback);

    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it("clamps result to [0, 1]", () => {
    const now = Date.now();
    // All denied + user_corrections at max weight
    const entries = Array.from({ length: 100 }, (_, i) => ({
      toolName: "dangerous_tool",
      outcome: "denied",
      at: now - i,
    }));
    const feedback = Array.from({ length: 100 }, (_, i) => ({
      type: "user_correction",
      payload: null,
      at: now - i,
    }));
    const score = computeDriftScore(entries, feedback);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("weights denied outcomes higher than errors", () => {
    const now = Date.now();
    const errorEntries = [{ toolName: "tool", outcome: "error", at: now - 100 }];
    const deniedEntries = [{ toolName: "tool", outcome: "denied", at: now - 100 }];
    const errorScore = computeDriftScore(errorEntries, []);
    const deniedScore = computeDriftScore(deniedEntries, []);
    expect(deniedScore).toBeGreaterThan(errorScore);
  });
});

// ── assembleTrajectoryContext ──

describe("assembleTrajectoryContext", () => {
  it("maps store data correctly", async () => {
    const deps = makeDeps();
    const result = await assembleTrajectoryContext(deps, "goal-1");

    expect(result.goal.id).toBe("goal-1");
    expect(result.goal.title).toBe("Ship feature X");
    expect(result.goal.status).toBe("active");
    expect(result.goal.priority).toBe("high");
    expect(result.recentTasks).toHaveLength(2);
    expect(result.auditWindow).toHaveLength(2);
    expect(result.auditWindow[0]?.toolName).toBe("file_write");
    expect(result.recentFeedback).toHaveLength(1);
    expect(result.recentFeedback[0]?.type).toBe("user_correction");
    // payloadSummary should be a JSON string, truncated to 200 chars
    expect(result.recentFeedback[0]?.payloadSummary).toBe(JSON.stringify({ note: "wrong file" }));
  });

  it("handles goal not found gracefully", async () => {
    const deps = makeDeps();
    const result = await assembleTrajectoryContext(deps, "nonexistent-goal");

    expect(result.goal.id).toBe("nonexistent-goal");
    expect(result.goal.title).toBe("(unknown)");
    expect(result.goal.status).toBe("unknown");
    expect(result.recentTasks).toEqual([]);
    expect(result.auditWindow).toEqual([]);
    expect(result.recentFeedback).toEqual([]);
  });

  it("returns empty auditWindow when audit store throws", async () => {
    const auditStore: AuditStoreReader = {
      getRecentEntries: vi
        .fn<AuditStoreReader["getRecentEntries"]>()
        .mockRejectedValue(new Error("store unavailable")),
    };
    const deps = makeDeps({ auditStore });
    const result = await assembleTrajectoryContext(deps, "goal-1");

    expect(result.goal.id).toBe("goal-1");
    expect(result.auditWindow).toEqual([]);
    // feedback should still work
    expect(result.recentFeedback).toHaveLength(1);
  });

  it("returns empty recentFeedback when feedback store throws", async () => {
    const feedbackStore: FeedbackStoreReader = {
      getRecentSignals: vi
        .fn<FeedbackStoreReader["getRecentSignals"]>()
        .mockRejectedValue(new Error("store unavailable")),
      getOverrideStats: vi.fn<FeedbackStoreReader["getOverrideStats"]>().mockResolvedValue({
        confirmed: 0,
        overridden: 0,
      }),
    };
    const deps = makeDeps({ feedbackStore });
    const result = await assembleTrajectoryContext(deps, "goal-1");

    expect(result.goal.id).toBe("goal-1");
    expect(result.recentFeedback).toEqual([]);
    // audit should still work
    expect(result.auditWindow).toHaveLength(2);
  });

  it("passes tokenBudget constraints to audit store", async () => {
    const config = makeConfig({ auditWindowMaxEntries: 10, auditWindowMaxMinutes: 5 });
    const auditStore: AuditStoreReader = {
      getRecentEntries: vi.fn<AuditStoreReader["getRecentEntries"]>().mockResolvedValue([]),
    };
    const deps = makeDeps({ config, auditStore });
    await assembleTrajectoryContext(deps, "goal-1");

    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(auditStore.getRecentEntries)).toHaveBeenCalledWith("goal-1", {
      maxEntries: 10,
      maxMinutes: 5,
    });
  });

  it("truncates feedback payloadSummary to 200 chars", async () => {
    const longPayload = { data: "x".repeat(300) };
    const feedbackStore: FeedbackStoreReader = {
      getRecentSignals: vi
        .fn<FeedbackStoreReader["getRecentSignals"]>()
        .mockResolvedValue([{ type: "user_correction", payload: longPayload, at: Date.now() }]),
      getOverrideStats: vi.fn<FeedbackStoreReader["getOverrideStats"]>().mockResolvedValue({
        confirmed: 0,
        overridden: 0,
      }),
    };
    const deps = makeDeps({ feedbackStore });
    const result = await assembleTrajectoryContext(deps, "goal-1");

    expect(result.recentFeedback[0]?.payloadSummary.length).toBeLessThanOrEqual(200);
  });
});
