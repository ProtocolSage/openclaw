import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { computeDriftFromVerdict, wrapToolWithInlineGate } from "./inline-gate.js";
import type {
  AuditStoreReader,
  CacheMetrics,
  DeepVerdict,
  FeedbackStoreReader,
  GoalManagerReader,
  LlmCallFn,
  RoutineVerdict,
  VerifierCache,
  VerifierCacheEntry,
  VerifierConfig,
  VerifierContext,
} from "./types.js";

// ── Helpers ──

function makeConfig(overrides?: Partial<VerifierConfig>): VerifierConfig {
  return {
    enabled: true,
    scanIntervalMins: 5,
    scanIntervalUnclearMins: 2,
    cacheTtlMs: 60_000,
    softThreshold: 0.3,
    hardThreshold: 0.7,
    calibration: {
      minThreshold: 0.1,
      maxThreshold: 0.9,
      decayAlpha: 0.2,
    },
    escalation: {
      sonnetBudgetPerGoalPerHour: 10,
      cooldownMs: 30_000,
      baseEscalationThreshold: 0.6,
      lcmUnavailableConfidenceDiscount: 0.7,
    },
    tokenBudget: {
      toolInputTruncateChars: 120,
      auditWindowMaxEntries: 20,
      auditWindowMaxMinutes: 15,
    },
    models: {
      routine: "test/routine",
      routineParams: {},
      deep: "test/deep",
      deepParams: {},
      fallback: "test/fallback",
      fallbackParams: {},
    },
    ...overrides,
  };
}

function makeGoalManager(
  goals: Array<{ id: string; title: string; status: string }> = [
    { id: "goal-1", title: "Test Goal", status: "active" },
  ],
): GoalManagerReader {
  return {
    getActiveGoals: vi.fn<GoalManagerReader["getActiveGoals"]>().mockResolvedValue(goals),
    getTasksForGoal: vi.fn<GoalManagerReader["getTasksForGoal"]>().mockResolvedValue([]),
  };
}

function makeAuditStore(): AuditStoreReader {
  return {
    getRecentEntries: vi.fn<AuditStoreReader["getRecentEntries"]>().mockResolvedValue([]),
  };
}

function makeFeedbackStore(): FeedbackStoreReader {
  return {
    getRecentSignals: vi.fn<FeedbackStoreReader["getRecentSignals"]>().mockResolvedValue([]),
    getOverrideStats: vi
      .fn<FeedbackStoreReader["getOverrideStats"]>()
      .mockResolvedValue({ confirmed: 0, overridden: 0 }),
  };
}

function makeCache(initial?: VerifierCacheEntry | null): VerifierCache {
  const store = new Map<string, VerifierCacheEntry>();
  if (initial) {
    store.set(initial.goalId, initial);
  }
  const metrics: CacheMetrics = { hits: 0, misses: 0, onDemandChecks: 0 };
  return {
    get: vi.fn<VerifierCache["get"]>((goalId) => store.get(goalId) ?? null),
    set: vi.fn<VerifierCache["set"]>((goalId, entry) => {
      store.set(goalId, entry);
    }),
    invalidate: vi.fn<VerifierCache["invalidate"]>((goalId) => {
      store.delete(goalId);
    }),
    getMetrics: vi.fn<VerifierCache["getMetrics"]>(() => ({ ...metrics })),
    resetMetrics: vi.fn<VerifierCache["resetMetrics"]>(() => {
      const snapshot = { ...metrics };
      metrics.hits = 0;
      metrics.misses = 0;
      metrics.onDemandChecks = 0;
      return snapshot;
    }),
    acquireLock: vi.fn<VerifierCache["acquireLock"]>().mockResolvedValue(vi.fn()),
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

function makeDeepVerdict(overrides?: Partial<DeepVerdict>): DeepVerdict {
  return {
    schemaVersion: 1,
    verdict: "proceed",
    confidence: 0.9,
    reason: "Looks good",
    suggestedCorrection: null,
    ...overrides,
  };
}

function makeTool(name: string): AnyAgentTool {
  const executeFn = vi
    .fn<NonNullable<AnyAgentTool["execute"]>>()
    .mockResolvedValue({ content: [{ type: "text", text: "ok" }], details: undefined });
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: {},
    execute: executeFn,
  } as unknown as AnyAgentTool;
}

function makeContext(overrides?: Partial<VerifierContext>): VerifierContext {
  return {
    config: makeConfig(),
    llmCall: vi.fn<LlmCallFn>().mockResolvedValue(makeRoutineVerdict()),
    goalManager: makeGoalManager(),
    auditStore: makeAuditStore(),
    feedbackStore: makeFeedbackStore(),
    cache: makeCache(),
    sendToSession: vi.fn<VerifierContext["sendToSession"]>(),
    ...overrides,
  };
}

// ── Tests ──

describe("computeDriftFromVerdict", () => {
  it("returns low drift for aligned=yes, high confidence", () => {
    const score = computeDriftFromVerdict(makeRoutineVerdict({ aligned: "yes", confidence: 1.0 }));
    expect(score).toBe(0);
  });

  it("returns mid drift for aligned=unclear", () => {
    const score = computeDriftFromVerdict(
      makeRoutineVerdict({ aligned: "unclear", confidence: 0.5 }),
    );
    expect(score).toBeGreaterThanOrEqual(0.3);
    expect(score).toBeLessThanOrEqual(0.6);
  });

  it("returns high drift for aligned=no", () => {
    const score = computeDriftFromVerdict(makeRoutineVerdict({ aligned: "no", confidence: 0.5 }));
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("returns max drift for aligned=no, zero confidence", () => {
    const score = computeDriftFromVerdict(makeRoutineVerdict({ aligned: "no", confidence: 0 }));
    expect(score).toBe(1.0);
  });
});

describe("wrapToolWithInlineGate", () => {
  let ctx: VerifierContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("passes reversible tools through without LLM call", async () => {
    const tool = makeTool("read");
    const wrapped = wrapToolWithInlineGate(tool, ctx);

    await wrapped.execute("call-1", {}, undefined, vi.fn());

    expect(tool.execute).toHaveBeenCalledOnce();
    expect(ctx.llmCall).not.toHaveBeenCalled();
  });

  it("returns original tool when verifier is disabled", () => {
    const disabledCtx = makeContext({ config: makeConfig({ enabled: false }) });
    const tool = makeTool("exec");
    const result = wrapToolWithInlineGate(tool, disabledCtx);

    // Should return the original tool unchanged
    expect(result).toBe(tool);
  });

  it("returns original tool when execute is undefined", () => {
    const tool = { name: "exec", description: "test", parameters: {} } as unknown as AnyAgentTool;
    const result = wrapToolWithInlineGate(tool, ctx);
    expect(result).toBe(tool);
  });

  it("prevents double-wrapping (returns same tool on second wrap)", async () => {
    const tool = makeTool("exec");
    const wrapped1 = wrapToolWithInlineGate(tool, ctx);
    const wrapped2 = wrapToolWithInlineGate(wrapped1, ctx);

    // Second wrap should return the already-wrapped tool
    expect(wrapped2).toBe(wrapped1);

    // Original tool is also tracked; wrapping it again returns itself
    const wrapped3 = wrapToolWithInlineGate(tool, ctx);
    expect(wrapped3).toBe(tool);
  });

  it("passes through when no active goals exist", async () => {
    const noGoalCtx = makeContext({ goalManager: makeGoalManager([]) });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, noGoalCtx);

    await wrapped.execute("call-1", { cmd: "ls" }, undefined, vi.fn());

    expect(tool.execute).toHaveBeenCalledOnce();
    expect(noGoalCtx.llmCall).not.toHaveBeenCalled();
  });

  it("passes through when cache hit is below soft threshold", async () => {
    const cache = makeCache({
      goalId: "goal-1",
      driftScore: 0.1, // below soft threshold 0.3
      alignment: "yes",
      lastVerifiedAt: Date.now(),
      lcmAvailable: false,
    });
    const cachedCtx = makeContext({ cache });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, cachedCtx);

    await wrapped.execute("call-1", { cmd: "deploy" }, undefined, vi.fn());

    expect(tool.execute).toHaveBeenCalledOnce();
    expect(cachedCtx.llmCall).not.toHaveBeenCalled();
  });

  it("runs routine LLM check on cache miss, passes on aligned=yes", async () => {
    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.95 }));
    const routineCtx = makeContext({ llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, routineCtx);

    await wrapped.execute("call-1", { cmd: "build" }, undefined, vi.fn());

    expect(llmCall).toHaveBeenCalledOnce();
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        currentAction: expect.objectContaining({ toolName: "exec" }),
      }),
      "routine",
    );
    expect(tool.execute).toHaveBeenCalledOnce();
    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(routineCtx.cache.set)).toHaveBeenCalledWith(
      "goal-1",
      expect.objectContaining({ goalId: "goal-1" }),
    );
  });

  it("triggers routine check when cache entry has drift at soft threshold", async () => {
    const cache = makeCache({
      goalId: "goal-1",
      driftScore: 0.3, // exactly at soft threshold
      alignment: "unclear",
      lastVerifiedAt: Date.now(),
      lcmAvailable: false,
    });
    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.9 }));
    const ctx2 = makeContext({ cache, llmCall });
    const tool = makeTool("message");
    const wrapped = wrapToolWithInlineGate(tool, ctx2);

    await wrapped.execute("call-1", { text: "hi" }, undefined, vi.fn());

    // Should have rechecked because drift >= softThreshold
    expect(llmCall).toHaveBeenCalledOnce();
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("escalates to deep check when routine is uncertain with low confidence", async () => {
    const routineVerdict = makeRoutineVerdict({
      aligned: "unclear",
      confidence: 0.3, // below baseEscalationThreshold (0.6)
    });
    const deepVerdict = makeDeepVerdict({ verdict: "proceed", confidence: 0.85 });

    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValueOnce(routineVerdict)
      .mockResolvedValueOnce(deepVerdict);

    const deepCtx = makeContext({ llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, deepCtx);

    await wrapped.execute("call-1", { cmd: "rm -rf" }, undefined, vi.fn());

    expect(llmCall).toHaveBeenCalledTimes(2);
    expect(llmCall).toHaveBeenNthCalledWith(1, expect.anything(), "routine");
    expect(llmCall).toHaveBeenNthCalledWith(2, expect.anything(), "deep");
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("blocks execution when deep check returns block verdict", async () => {
    const routineVerdict = makeRoutineVerdict({
      aligned: "no",
      confidence: 0.2,
      reason: "Off-track action",
    });
    const deepVerdict = makeDeepVerdict({
      verdict: "block",
      reason: "Dangerous deviation",
    });

    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValueOnce(routineVerdict)
      .mockResolvedValueOnce(deepVerdict);

    const blockCtx = makeContext({ llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, blockCtx);

    await expect(
      wrapped.execute("call-1", { cmd: "drop table" }, undefined, vi.fn()),
    ).rejects.toThrow(/Trajectory verifier blocked tool "exec"/);

    expect(tool.execute).not.toHaveBeenCalled();
    expect(blockCtx.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("blocked"),
      "block",
    );
  });

  it("sends nudge but still executes when drift is between thresholds", async () => {
    // Routine returns aligned=unclear with high-enough confidence to skip deep
    // but drift falls in nudge range
    const routineVerdict = makeRoutineVerdict({
      aligned: "unclear",
      confidence: 0.7, // above baseEscalationThreshold, so no deep check
      reason: "Slightly off path",
    });

    const llmCall = vi.fn<LlmCallFn>().mockResolvedValue(routineVerdict);
    const nudgeCtx = makeContext({ llmCall });
    const tool = makeTool("process");
    const wrapped = wrapToolWithInlineGate(tool, nudgeCtx);

    await wrapped.execute("call-1", { input: "data" }, undefined, vi.fn());

    // unclear + 0.7 confidence -> drift = 0.3 + (1-0.7)*0.3 = 0.39
    // 0.39 >= softThreshold (0.3) and < hardThreshold (0.7) -> nudge
    expect(llmCall).toHaveBeenCalledOnce(); // no deep escalation
    expect(nudgeCtx.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("drift detected"),
      "nudge",
    );
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("blocks when routine returns no-aligned and drift exceeds hard threshold", async () => {
    // aligned=no, confidence=0.8 -> drift = 0.6 + 0.2*0.4 = 0.68
    // With high confidence (0.8 >= 0.6 threshold), no deep escalation
    // 0.68 < hardThreshold (0.7) -> nudge, not block
    // Use lower confidence so drift exceeds hard threshold
    const routineVerdict = makeRoutineVerdict({
      aligned: "no",
      confidence: 0.9, // above escalation threshold
      reason: "Wrong direction",
    });
    // aligned=no, confidence=0.9 -> drift = 0.6 + 0.1*0.4 = 0.64
    // Still below 0.7. Use hard threshold of 0.6 instead
    const config = makeConfig({ hardThreshold: 0.6 });
    const llmCall = vi.fn<LlmCallFn>().mockResolvedValue(routineVerdict);
    const blockCtx = makeContext({ config, llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, blockCtx);

    await expect(wrapped.execute("call-1", { cmd: "destroy" }, undefined, vi.fn())).rejects.toThrow(
      /Trajectory verifier blocked/,
    );

    expect(tool.execute).not.toHaveBeenCalled();
    expect(blockCtx.sendToSession).toHaveBeenCalledWith(expect.anything(), "block");
  });

  it("deep check returning modify triggers nudge", async () => {
    const routineVerdict = makeRoutineVerdict({
      aligned: "unclear",
      confidence: 0.2,
      reason: "Needs adjustment",
    });
    const deepVerdict = makeDeepVerdict({
      verdict: "modify",
      suggestedCorrection: "Use safer command",
    });

    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValueOnce(routineVerdict)
      .mockResolvedValueOnce(deepVerdict);

    const modifyCtx = makeContext({ llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, modifyCtx);

    await wrapped.execute("call-1", { cmd: "risky" }, undefined, vi.fn());

    expect(modifyCtx.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("drift detected"),
      "nudge",
    );
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("treats undeclared/unknown tool names as irreversible (runs verification)", async () => {
    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.95 }));
    const unknownCtx = makeContext({ llmCall });
    const tool = makeTool("some_unknown_plugin_tool");
    const wrapped = wrapToolWithInlineGate(tool, unknownCtx);

    await wrapped.execute("call-1", {}, undefined, vi.fn());

    // Unknown tools are irreversible -> should run LLM check
    expect(llmCall).toHaveBeenCalledOnce();
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("serializes concurrent calls for the same goal via acquireLock", async () => {
    const callOrder: string[] = [];
    let lockResolve: (() => void) | null = null;

    const cache = makeCache();
    // Override acquireLock to simulate contention
    const acquireLock = vi.fn<VerifierCache["acquireLock"]>().mockImplementation(async () => {
      if (lockResolve) {
        // Second call waits
        await new Promise<void>((resolve) => {
          lockResolve = resolve;
        });
      }
      callOrder.push("lock-acquired");
      return () => {
        callOrder.push("lock-released");
        if (lockResolve) {
          const r = lockResolve;
          lockResolve = null;
          r();
        }
      };
    });
    cache.acquireLock = acquireLock;

    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.95 }));
    const lockCtx = makeContext({ cache, llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, lockCtx);

    // Both calls should go through acquireLock
    await wrapped.execute("call-1", {}, undefined, vi.fn());

    expect(acquireLock).toHaveBeenCalledWith("goal-1");
  });

  it("releases lock even when LLM call throws", async () => {
    const releaseFn = vi.fn();
    const cache = makeCache();
    cache.acquireLock = vi.fn<VerifierCache["acquireLock"]>().mockResolvedValue(releaseFn);

    const llmCall = vi.fn<LlmCallFn>().mockRejectedValue(new Error("LLM unavailable"));
    const errorCtx = makeContext({ cache, llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, errorCtx);

    await expect(wrapped.execute("call-1", {}, undefined, vi.fn())).rejects.toThrow(
      "LLM unavailable",
    );

    expect(releaseFn).toHaveBeenCalledOnce();
  });

  it("updates cache after successful routine check", async () => {
    const cache = makeCache();
    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.9 }));
    const cacheCtx = makeContext({ cache, llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, cacheCtx);

    await wrapped.execute("call-1", {}, undefined, vi.fn());

    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(cache.set)).toHaveBeenCalledWith(
      "goal-1",
      expect.objectContaining({
        goalId: "goal-1",
        alignment: "yes",
        lcmAvailable: false,
      }),
    );
  });

  it("cache.invalidate clears cached entry, forcing recheck", async () => {
    const cache = makeCache({
      goalId: "goal-1",
      driftScore: 0.1,
      alignment: "yes",
      lastVerifiedAt: Date.now(),
      lcmAvailable: false,
    });

    // First, invalidate the cache
    cache.invalidate("goal-1");

    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.95 }));
    const invalidateCtx = makeContext({ cache, llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, invalidateCtx);

    await wrapped.execute("call-1", {}, undefined, vi.fn());

    // After invalidation, cache.get returns null -> routine check runs
    expect(llmCall).toHaveBeenCalledOnce();
  });

  it("truncates long tool input in prompt", async () => {
    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValue(makeRoutineVerdict({ aligned: "yes", confidence: 0.95 }));
    const truncCtx = makeContext({ llmCall });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, truncCtx);

    const longInput = { cmd: "x".repeat(300) };
    await wrapped.execute("call-1", longInput, undefined, vi.fn());

    const promptArg = llmCall.mock.calls[0][0];
    expect(promptArg.currentAction).toBeDefined();
    // 120 chars max (119 chars + ellipsis)
    expect(promptArg.currentAction!.toolInputSummary.length).toBeLessThanOrEqual(120);
  });
});
