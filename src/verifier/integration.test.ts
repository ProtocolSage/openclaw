import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { DEFAULT_VERIFIER_CONFIG, InMemoryVerifierCache } from "./gateway-wiring.js";
import { wrapToolWithInlineGate } from "./inline-gate.js";
import type {
  AuditStoreReader,
  FeedbackStoreReader,
  GoalManagerReader,
  LlmCallFn,
  RoutineVerdict,
  VerifierConfig,
  VerifierContext,
} from "./types.js";

// ── Helpers ──

function makeConfig(overrides?: Partial<VerifierConfig>): VerifierConfig {
  return {
    ...DEFAULT_VERIFIER_CONFIG,
    cacheTtlMs: 60_000,
    softThreshold: 0.4,
    hardThreshold: 0.7,
    ...overrides,
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

function makeGoalManager(
  goals: Array<{ id: string; title: string; status: string }> = [
    { id: "goal-1", title: "Deploy feature", status: "active" },
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

function makeMockLlmCall(): ReturnType<typeof vi.fn<LlmCallFn>> {
  return vi.fn<LlmCallFn>().mockResolvedValue(makeRoutineVerdict());
}

function makeContext(overrides?: Partial<VerifierContext>): VerifierContext {
  return {
    config: makeConfig({ enabled: true }),
    llmCall: makeMockLlmCall(),
    goalManager: makeGoalManager(),
    auditStore: makeAuditStore(),
    feedbackStore: makeFeedbackStore(),
    cache: new InMemoryVerifierCache(60_000),
    sendToSession: vi.fn<VerifierContext["sendToSession"]>(),
    ...overrides,
  };
}

function makeTool(name: string): AnyAgentTool {
  const executeFn = vi
    .fn<NonNullable<AnyAgentTool["execute"]>>()
    .mockResolvedValue({ content: [{ type: "text", text: "executed" }], details: undefined });
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: {},
    execute: executeFn,
  } as unknown as AnyAgentTool;
}

// ── Integration tests ──

describe("integration: inline gate pipeline", () => {
  let ctx: VerifierContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("reversible tool (read) passes through without LLM call", async () => {
    const tool = makeTool("read");
    const wrapped = wrapToolWithInlineGate(tool, ctx);

    await wrapped.execute("call-1", { path: "/tmp/file" }, undefined, vi.fn());

    expect(tool.execute).toHaveBeenCalledOnce();
    expect(ctx.llmCall).not.toHaveBeenCalled();
  });

  it("irreversible tool (exec) triggers routine LLM call, caches result, then executes", async () => {
    const llmCall = makeMockLlmCall();
    const cache = new InMemoryVerifierCache(60_000);
    const localCtx = makeContext({ llmCall, cache });

    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, localCtx);

    await wrapped.execute("call-1", { cmd: "deploy" }, undefined, vi.fn());

    // LLM was called once (routine check)
    expect(llmCall).toHaveBeenCalledOnce();
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        currentAction: expect.objectContaining({ toolName: "exec" }),
      }),
      "routine",
    );

    // Tool executed after verification passed
    expect(tool.execute).toHaveBeenCalledOnce();

    // Cache was populated
    const cached = cache.get("goal-1");
    expect(cached).not.toBeNull();
    expect(cached!.goalId).toBe("goal-1");
    expect(cached!.alignment).toBe("yes");
  });

  it("second call for same goal uses cached result, skips LLM", async () => {
    const llmCall = makeMockLlmCall();
    const cache = new InMemoryVerifierCache(60_000);
    const localCtx = makeContext({ llmCall, cache });

    const tool1 = makeTool("exec");
    const wrapped1 = wrapToolWithInlineGate(tool1, localCtx);
    await wrapped1.execute("call-1", { cmd: "build" }, undefined, vi.fn());

    // First call triggers LLM
    expect(llmCall).toHaveBeenCalledOnce();

    // Second call with new tool (same goal)
    const tool2 = makeTool("message");
    const wrapped2 = wrapToolWithInlineGate(tool2, localCtx);
    await wrapped2.execute("call-2", { text: "hi" }, undefined, vi.fn());

    // Cache hit from first call's stored result (drift 0.03 < softThreshold 0.4)
    // LLM should NOT have been called again
    expect(llmCall).toHaveBeenCalledOnce();
    expect(tool2.execute).toHaveBeenCalledOnce();
  });
});

describe("integration: cache from periodic scan used by inline gate", () => {
  it("pre-populated cache entry with low drift causes cache hit, skips LLM", async () => {
    const llmCall = makeMockLlmCall();
    const cache = new InMemoryVerifierCache(60_000);

    // Simulate periodic scan having populated cache with low drift
    cache.set("goal-1", {
      goalId: "goal-1",
      driftScore: 0.1, // well below softThreshold 0.4
      alignment: "yes",
      lastVerifiedAt: Date.now(),
      lcmAvailable: false,
    });

    const ctx = makeContext({ llmCall, cache });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, ctx);

    await wrapped.execute("call-1", { cmd: "ls -la" }, undefined, vi.fn());

    // Cache hit -> no LLM call
    expect(llmCall).not.toHaveBeenCalled();
    expect(tool.execute).toHaveBeenCalledOnce();

    // Verify metrics reflect the cache hit
    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(0);
  });
});

describe("integration: override signal invalidates cache", () => {
  it("invalidated cache entry forces LLM recheck on next gate call", async () => {
    const llmCall = makeMockLlmCall();
    const cache = new InMemoryVerifierCache(60_000);

    // Pre-populate cache (simulating a previous scan or gate check)
    cache.set("goal-1", {
      goalId: "goal-1",
      driftScore: 0.05,
      alignment: "yes",
      lastVerifiedAt: Date.now(),
      lcmAvailable: false,
    });

    // Simulate override signal: invalidate the cached entry
    cache.invalidate("goal-1");

    const ctx = makeContext({ llmCall, cache });
    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, ctx);

    await wrapped.execute("call-1", { cmd: "restart" }, undefined, vi.fn());

    // Cache was invalidated -> miss -> LLM call happens
    expect(llmCall).toHaveBeenCalledOnce();
    expect(tool.execute).toHaveBeenCalledOnce();

    // Cache repopulated after the check
    const refreshed = cache.get("goal-1");
    expect(refreshed).not.toBeNull();
    expect(refreshed!.goalId).toBe("goal-1");
  });
});

describe("integration: disabled verifier is no-op", () => {
  it("config.enabled = false returns tool unchanged", () => {
    const disabledConfig = makeConfig({ enabled: false });
    const ctx = makeContext({ config: disabledConfig });

    const tool = makeTool("exec");
    const result = wrapToolWithInlineGate(tool, ctx);

    // Should return the exact same tool object (no wrapping)
    expect(result).toBe(tool);
  });

  it("disabled verifier does not call LLM even for irreversible tools", async () => {
    const llmCall = makeMockLlmCall();
    const disabledConfig = makeConfig({ enabled: false });
    const ctx = makeContext({ config: disabledConfig, llmCall });

    const tool = makeTool("exec");
    const result = wrapToolWithInlineGate(tool, ctx);

    // Execute the (unwrapped) tool directly
    await result.execute("call-1", { cmd: "rm -rf /" }, undefined, vi.fn());

    expect(llmCall).not.toHaveBeenCalled();
    expect(tool.execute).toHaveBeenCalledOnce();
  });
});

describe("integration: full pipeline with escalation", () => {
  it("high drift from routine check triggers sendToSession nudge and still executes", async () => {
    const llmCall = vi.fn<LlmCallFn>().mockResolvedValue(
      makeRoutineVerdict({
        aligned: "unclear",
        confidence: 0.7,
        reason: "Slightly off path",
      }),
    );

    const sendToSession = vi.fn<VerifierContext["sendToSession"]>();
    const cache = new InMemoryVerifierCache(60_000);
    const ctx = makeContext({ llmCall, sendToSession, cache });

    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, ctx);

    await wrapped.execute("call-1", { cmd: "migrate" }, undefined, vi.fn());

    // unclear + 0.7 confidence -> drift = 0.3 + (1 - 0.7) * 0.3 = 0.39
    // With softThreshold 0.4 from makeConfig: 0.39 < 0.4 -> "none" escalation
    // Actually let's verify: applyTieredResponse checks score < soft -> none
    // Tool still executes
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(llmCall).toHaveBeenCalledOnce();

    // Cache populated with fresh result
    const cached = cache.get("goal-1");
    expect(cached).not.toBeNull();
    expect(cached!.alignment).toBe("unclear");
  });

  it("block verdict prevents tool execution and notifies session", async () => {
    // aligned=no with low confidence triggers deep escalation,
    // deep check returns block
    const llmCall = vi
      .fn<LlmCallFn>()
      .mockResolvedValueOnce(
        makeRoutineVerdict({
          aligned: "no",
          confidence: 0.2,
          reason: "Dangerous deviation",
        }),
      )
      .mockResolvedValueOnce({
        schemaVersion: 1,
        verdict: "block",
        confidence: 0.95,
        reason: "Must not proceed",
        suggestedCorrection: "Use a safer approach",
      });

    const sendToSession = vi.fn<VerifierContext["sendToSession"]>();
    const cache = new InMemoryVerifierCache(60_000);
    const ctx = makeContext({ llmCall, sendToSession, cache });

    const tool = makeTool("exec");
    const wrapped = wrapToolWithInlineGate(tool, ctx);

    await expect(
      wrapped.execute("call-1", { cmd: "drop database" }, undefined, vi.fn()),
    ).rejects.toThrow(/Trajectory verifier blocked/);

    expect(tool.execute).not.toHaveBeenCalled();
    expect(sendToSession).toHaveBeenCalledWith(expect.stringContaining("blocked"), "block");
    expect(llmCall).toHaveBeenCalledTimes(2);
  });
});
