import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CronEvent } from "../cron/service.js";
import { registerVerifierCron, handleVerifierCronEvent } from "./periodic-scan.js";
import type {
  AuditStoreReader,
  FeedbackStoreReader,
  GoalManagerReader,
  VerifierCache,
  VerifierCacheEntry,
  VerifierConfig,
  VerifierContext,
  VerifierPromptInput,
  RoutineVerdict,
  CacheMetrics,
} from "./types.js";
import { VERIFIER_PERIODIC_SCAN_JOB_NAME } from "./types.js";

// ── Helpers ──

function makeConfig(overrides?: Partial<VerifierConfig>): VerifierConfig {
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
      decayAlpha: 0.3,
    },
    escalation: {
      sonnetBudgetPerGoalPerHour: 3,
      cooldownMs: 60_000,
      baseEscalationThreshold: 0.6,
      lcmUnavailableConfidenceDiscount: 0.7,
    },
    tokenBudget: {
      toolInputTruncateChars: 120,
      auditWindowMaxEntries: 20,
      auditWindowMaxMinutes: 30,
    },
    models: {
      routine: "openai-codex/gpt-5.4",
      routineParams: {},
      deep: "openai-codex/gpt-5.4",
      deepParams: {},
      fallback: "xai/grok-4-1-fast-reasoning",
      fallbackParams: {},
    },
    ...overrides,
  };
}

function makeGoalManager(
  goals: Array<{
    id: string;
    title: string;
    status: string;
    deadlineMs?: number;
    priority?: string;
  }> = [],
): GoalManagerReader {
  return {
    getActiveGoals: vi.fn().mockResolvedValue(goals),
    getTasksForGoal: vi.fn().mockResolvedValue([]),
  };
}

function makeAuditStore(
  entries: Array<{
    toolName: string;
    outcome: string;
    at: number;
    toolInput?: string;
  }> = [],
): AuditStoreReader {
  return {
    getRecentEntries: vi.fn().mockResolvedValue(entries),
  };
}

function makeFeedbackStore(
  signals: Array<{ type: string; payload: unknown; at: number }> = [],
  overrideStats: { confirmed: number; overridden: number } = {
    confirmed: 0,
    overridden: 0,
  },
): FeedbackStoreReader {
  return {
    getRecentSignals: vi.fn().mockResolvedValue(signals),
    getOverrideStats: vi.fn().mockResolvedValue(overrideStats),
  };
}

function makeCache(): VerifierCache {
  const store = new Map<string, VerifierCacheEntry>();
  return {
    get: vi.fn((goalId: string) => store.get(goalId) ?? null),
    set: vi.fn((goalId: string, entry: VerifierCacheEntry) => {
      store.set(goalId, entry);
    }),
    invalidate: vi.fn((goalId: string) => {
      store.delete(goalId);
    }),
    getMetrics: vi.fn((): CacheMetrics => ({ hits: 0, misses: 0, onDemandChecks: 0 })),
    resetMetrics: vi.fn((): CacheMetrics => ({ hits: 0, misses: 0, onDemandChecks: 0 })),
    acquireLock: vi.fn(async () => () => {}),
  };
}

function makeRoutineVerdict(overrides?: Partial<RoutineVerdict>): RoutineVerdict {
  return {
    schemaVersion: 1,
    aligned: "yes",
    confidence: 0.9,
    reason: "On track",
    severity: "low",
    ...overrides,
  };
}

function makeCronEvent(overrides?: Partial<CronEvent>): CronEvent {
  return {
    jobId: VERIFIER_PERIODIC_SCAN_JOB_NAME,
    action: "finished",
    status: "ok",
    ...overrides,
  };
}

function makeContext(overrides?: Partial<VerifierContext>): VerifierContext {
  return {
    config: makeConfig(),
    llmCall: vi.fn().mockResolvedValue(makeRoutineVerdict()),
    goalManager: makeGoalManager(),
    auditStore: makeAuditStore(),
    feedbackStore: makeFeedbackStore(),
    cache: makeCache(),
    sendToSession: vi.fn(),
    ...overrides,
  };
}

// Minimal CronService stub type matching the class interface
type CronServiceStub = {
  list: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
};

function makeCronService(existingJobs: Array<{ id: string; name: string }> = []): CronServiceStub {
  return {
    list: vi.fn().mockResolvedValue(existingJobs),
    add: vi.fn().mockResolvedValue({ id: "new-job-id" }),
  };
}

// ── registerVerifierCron ──

describe("registerVerifierCron", () => {
  it("returns disabled when config.enabled is false", async () => {
    const cron = makeCronService();
    const config = makeConfig({ enabled: false });
    const result = await registerVerifierCron(
      cron as unknown as Parameters<typeof registerVerifierCron>[0],
      config,
    );
    expect(result).toEqual({ status: "disabled" });
    expect(cron.list).not.toHaveBeenCalled();
    expect(cron.add).not.toHaveBeenCalled();
  });

  it("returns exists when job is already registered", async () => {
    const cron = makeCronService([{ id: "existing-id", name: VERIFIER_PERIODIC_SCAN_JOB_NAME }]);
    const config = makeConfig();
    const result = await registerVerifierCron(
      cron as unknown as Parameters<typeof registerVerifierCron>[0],
      config,
    );
    expect(result).toEqual({ status: "exists", jobId: "existing-id" });
    expect(cron.add).not.toHaveBeenCalled();
  });

  it("registers a new cron job when none exists", async () => {
    const cron = makeCronService();
    const config = makeConfig({ scanIntervalMins: 10 });
    const result = await registerVerifierCron(
      cron as unknown as Parameters<typeof registerVerifierCron>[0],
      config,
    );
    expect(result).toEqual({ status: "registered", jobId: "new-job-id" });
    expect(cron.add).toHaveBeenCalledOnce();
    const addArg = cron.add.mock.calls[0][0] as Record<string, unknown>;
    expect(addArg.name).toBe(VERIFIER_PERIODIC_SCAN_JOB_NAME);
    expect(addArg.schedule).toEqual({ kind: "every", everyMs: 600_000 });
  });

  it("is idempotent -- second call returns exists", async () => {
    const cron = makeCronService();
    const config = makeConfig();

    // First call registers
    const first = await registerVerifierCron(
      cron as unknown as Parameters<typeof registerVerifierCron>[0],
      config,
    );
    expect(first.status).toBe("registered");

    // Simulate the job now existing
    cron.list.mockResolvedValue([{ id: "new-job-id", name: VERIFIER_PERIODIC_SCAN_JOB_NAME }]);

    const second = await registerVerifierCron(
      cron as unknown as Parameters<typeof registerVerifierCron>[0],
      config,
    );
    expect(second).toEqual({ status: "exists", jobId: "new-job-id" });
    // add called only once (first call)
    expect(cron.add).toHaveBeenCalledOnce();
  });

  it("clamps scanIntervalMins to at least 1 minute", async () => {
    const cron = makeCronService();
    const config = makeConfig({ scanIntervalMins: -5 });
    await registerVerifierCron(
      cron as unknown as Parameters<typeof registerVerifierCron>[0],
      config,
    );
    const addArg = cron.add.mock.calls[0][0] as Record<string, unknown>;
    expect(addArg.schedule).toEqual({ kind: "every", everyMs: 60_000 });
  });
});

// ── handleVerifierCronEvent ──

describe("handleVerifierCronEvent", () => {
  let context: VerifierContext;

  beforeEach(() => {
    context = makeContext();
  });

  it("returns ignored for wrong job name", async () => {
    const evt = makeCronEvent({ jobId: "other-job" });
    const result = await handleVerifierCronEvent(evt, context);
    expect(result).toEqual({ status: "ignored" });
  });

  it("returns ignored for non-finished action", async () => {
    const evt = makeCronEvent({ action: "started" });
    const result = await handleVerifierCronEvent(evt, context);
    expect(result).toEqual({ status: "ignored" });
  });

  it("returns disabled when config.enabled is false", async () => {
    context = makeContext({ config: makeConfig({ enabled: false }) });
    const evt = makeCronEvent();
    const result = await handleVerifierCronEvent(evt, context);
    expect(result).toEqual({ status: "disabled" });
  });

  it("returns cron_error when event status is not ok", async () => {
    const evt = makeCronEvent({ status: "error" });
    const result = await handleVerifierCronEvent(evt, context);
    expect(result).toEqual({ status: "cron_error" });
  });

  it("scans zero goals when no active goals exist", async () => {
    const evt = makeCronEvent();
    const result = await handleVerifierCronEvent(evt, context);
    expect(result).toEqual({ status: "scanned", scanned: 0, nudged: 0 });
  });

  it("scans a clean goal without nudging", async () => {
    const goalManager = makeGoalManager([{ id: "g1", title: "Ship v2", status: "active" }]);
    // All success audit entries -> drift = 0
    const auditStore = makeAuditStore([
      { toolName: "read_file", outcome: "success", at: Date.now() },
    ]);
    const feedbackStore = makeFeedbackStore();
    context = makeContext({
      goalManager,
      auditStore,
      feedbackStore,
      llmCall: vi.fn().mockResolvedValue(makeRoutineVerdict()),
    });

    const evt = makeCronEvent();
    const result = await handleVerifierCronEvent(evt, context);
    expect(result).toEqual({ status: "scanned", scanned: 1, nudged: 0 });
    expect(context.sendToSession).not.toHaveBeenCalled();
  });

  it("nudges when drift exceeds soft threshold", async () => {
    const goalManager = makeGoalManager([{ id: "g1", title: "Ship v2", status: "active" }]);
    // Multiple error outcomes push drift above softThreshold (0.4)
    const now = Date.now();
    const errorEntries = Array.from({ length: 5 }, (_, i) => ({
      toolName: "bash",
      outcome: "error",
      at: now - i * 1000,
    }));
    const auditStore = makeAuditStore(errorEntries);
    const feedbackStore = makeFeedbackStore([{ type: "user_correction", payload: {}, at: now }]);

    context = makeContext({
      goalManager,
      auditStore,
      feedbackStore,
      config: makeConfig({ softThreshold: 0.1, hardThreshold: 0.9 }),
      llmCall: vi
        .fn()
        .mockResolvedValue(makeRoutineVerdict({ aligned: "no", reason: "Off track" })),
    });

    const evt = makeCronEvent();
    const result = await handleVerifierCronEvent(evt, context);
    expect(result.status).toBe("scanned");
    if (result.status === "scanned") {
      expect(result.scanned).toBe(1);
      expect(result.nudged).toBe(1);
    }
    expect(context.sendToSession).toHaveBeenCalledOnce();
    const callArgs = (context.sendToSession as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(callArgs[0]).toContain("Ship v2");
    expect(callArgs[0]).toContain("Off track");
    expect(callArgs[1]).toBe("nudge");
  });

  it("sends block message when drift exceeds hard threshold", async () => {
    const goalManager = makeGoalManager([{ id: "g1", title: "Deploy prod", status: "active" }]);
    const now = Date.now();
    // Many denied entries push drift very high
    const deniedEntries = Array.from({ length: 10 }, (_, i) => ({
      toolName: "bash",
      outcome: "denied",
      at: now - i * 100,
    }));
    const auditStore = makeAuditStore(deniedEntries);
    const feedbackStore = makeFeedbackStore([
      { type: "user_correction", payload: {}, at: now },
      { type: "user_correction", payload: {}, at: now - 500 },
    ]);

    context = makeContext({
      goalManager,
      auditStore,
      feedbackStore,
      config: makeConfig({ softThreshold: 0.05, hardThreshold: 0.1 }),
      llmCall: vi.fn().mockResolvedValue(
        makeRoutineVerdict({
          aligned: "no",
          reason: "Severely misaligned",
          severity: "high",
        }),
      ),
    });

    const evt = makeCronEvent();
    const result = await handleVerifierCronEvent(evt, context);
    expect(result.status).toBe("scanned");
    if (result.status === "scanned") {
      expect(result.nudged).toBe(1);
    }
    const callArgs = (context.sendToSession as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(callArgs[0]).toContain("high trajectory drift");
    expect(callArgs[0]).toContain("Deploy prod");
    expect(callArgs[1]).toBe("block");
  });

  it("updates cache for each scanned goal", async () => {
    const goalManager = makeGoalManager([
      { id: "g1", title: "Goal A", status: "active" },
      { id: "g2", title: "Goal B", status: "active" },
    ]);
    context = makeContext({ goalManager });

    const evt = makeCronEvent();
    await handleVerifierCronEvent(evt, context);

    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(context.cache.set)).toHaveBeenCalledTimes(2);
    const setCalls = (context.cache.set as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, VerifierCacheEntry]
    >;
    expect(setCalls[0][0]).toBe("g1");
    expect(setCalls[0][1].goalId).toBe("g1");
    expect(setCalls[1][0]).toBe("g2");
    expect(setCalls[1][1].goalId).toBe("g2");
  });

  it("runs calibration for each goal via feedbackStore", async () => {
    const goalManager = makeGoalManager([{ id: "g1", title: "Goal A", status: "active" }]);
    const feedbackStore = makeFeedbackStore([], {
      confirmed: 5,
      overridden: 2,
    });
    context = makeContext({ goalManager, feedbackStore });

    const evt = makeCronEvent();
    await handleVerifierCronEvent(evt, context);

    // updateCalibration calls getOverrideStats
    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(feedbackStore.getOverrideStats)).toHaveBeenCalledWith("g1");
  });

  it("resets cache metrics after scan", async () => {
    const goalManager = makeGoalManager([{ id: "g1", title: "Goal A", status: "active" }]);
    context = makeContext({ goalManager });

    const evt = makeCronEvent();
    await handleVerifierCronEvent(evt, context);

    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(context.cache.resetMetrics)).toHaveBeenCalledOnce();
  });

  it("continues scanning remaining goals when one throws", async () => {
    const goalManager = makeGoalManager([
      { id: "g-fail", title: "Failing Goal", status: "active" },
      { id: "g-ok", title: "OK Goal", status: "active" },
    ]);

    let callCount = 0;
    const llmCall = vi.fn().mockImplementation(async (prompt: VerifierPromptInput) => {
      callCount++;
      if (prompt.goal.id === "g-fail") {
        throw new Error("LLM unavailable");
      }
      return makeRoutineVerdict();
    });

    context = makeContext({ goalManager, llmCall });

    const evt = makeCronEvent();
    const result = await handleVerifierCronEvent(evt, context);
    // Only the second goal succeeds
    expect(result).toEqual({ status: "scanned", scanned: 1, nudged: 0 });
    expect(callCount).toBe(2);
  });

  it("calls llmCall with routine level for each goal", async () => {
    const goalManager = makeGoalManager([{ id: "g1", title: "Goal A", status: "active" }]);
    const llmCall = vi.fn().mockResolvedValue(makeRoutineVerdict());
    context = makeContext({ goalManager, llmCall });

    const evt = makeCronEvent();
    await handleVerifierCronEvent(evt, context);

    expect(llmCall).toHaveBeenCalledOnce();
    const callArgs = llmCall.mock.calls[0] as [VerifierPromptInput, string];
    expect(callArgs[1]).toBe("routine");
  });
});
