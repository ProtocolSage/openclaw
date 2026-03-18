import { describe, it, expect, vi } from "vitest";
import { DEFAULT_VERIFIER_CONFIG } from "./gateway-wiring.js";
import { classifyExecOutcome, wrapToolWithOutcomeAssertion } from "./outcome-assertion.js";
import type { VerifierConfig, VerifierContext } from "./types.js";

// ── classifyExecOutcome ──

describe("classifyExecOutcome", () => {
  it("classifies non-zero exit code as fail", () => {
    const result = classifyExecOutcome({
      status: "completed",
      exitCode: 1,
      aggregated: "some output",
    });
    expect(result.classification).toBe("fail");
    expect(result.evidence).toContain("exit code 1");
  });

  it("includes failure pattern label when matched", () => {
    const result = classifyExecOutcome({
      status: "failed",
      exitCode: 1,
      aggregated: "3 failed | 10 passed",
    });
    expect(result.classification).toBe("fail");
    expect(result.evidence).toContain("test failures detected");
  });

  it("classifies exit code 0 as pass", () => {
    const result = classifyExecOutcome({
      status: "completed",
      exitCode: 0,
      aggregated: "all good",
    });
    expect(result.classification).toBe("pass");
    expect(result.evidence).toContain("exit code 0");
  });

  it("detects failure patterns even with exit code 0", () => {
    const result = classifyExecOutcome({
      status: "completed",
      exitCode: 0,
      aggregated: "FAIL src/verifier/some.test.ts > something",
    });
    expect(result.classification).toBe("fail");
    expect(result.evidence).toContain("FAIL marker");
  });

  it("detects TypeScript errors", () => {
    const result = classifyExecOutcome({
      status: "completed",
      exitCode: 1,
      aggregated: "error TS2345: Argument of type 'string' is not assignable",
    });
    expect(result.classification).toBe("fail");
    expect(result.evidence).toContain("TypeScript compilation error");
  });

  it("detects ELIFECYCLE errors", () => {
    const result = classifyExecOutcome({
      status: "failed",
      exitCode: 1,
      aggregated: "ELIFECYCLE  Test failed.",
    });
    expect(result.classification).toBe("fail");
    expect(result.evidence).toContain("npm lifecycle error");
  });

  it("classifies running status as indeterminate", () => {
    const result = classifyExecOutcome({
      status: "running",
      exitCode: null,
    });
    expect(result.classification).toBe("indeterminate");
  });

  it("classifies approval-pending as indeterminate", () => {
    const result = classifyExecOutcome({
      status: "approval-pending",
      exitCode: null,
    });
    expect(result.classification).toBe("indeterminate");
  });

  it("classifies null exit code with completed status as pass", () => {
    const result = classifyExecOutcome({
      status: "completed",
      exitCode: null,
    });
    expect(result.classification).toBe("pass");
  });
});

// ── wrapToolWithOutcomeAssertion ──

function makeConfig(overrides?: Partial<VerifierConfig>): VerifierConfig {
  return {
    ...DEFAULT_VERIFIER_CONFIG,
    enabled: true,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<VerifierContext>): VerifierContext {
  return {
    config: makeConfig(),
    llmCall: vi.fn() as unknown as VerifierContext["llmCall"],
    goalManager: {
      getActiveGoals: vi.fn().mockResolvedValue([{ id: "g1", title: "Test", status: "active" }]),
      getTasksForGoal: vi.fn().mockResolvedValue([]),
    },
    auditStore: { getRecentEntries: vi.fn().mockResolvedValue([]) },
    feedbackStore: {
      getRecentSignals: vi.fn().mockResolvedValue([]),
      getOverrideStats: vi.fn().mockResolvedValue({ confirmed: 0, overridden: 0 }),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      invalidate: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({ hits: 0, misses: 0, onDemandChecks: 0 }),
      resetMetrics: vi.fn().mockReturnValue({ hits: 0, misses: 0, onDemandChecks: 0 }),
      acquireLock: vi.fn().mockResolvedValue(() => {}),
    },
    sendToSession: vi.fn(),
    ...overrides,
  };
}

function makeExecTool(
  result: { details?: unknown; content?: unknown[] } = {
    details: { status: "completed", exitCode: 0, aggregated: "" },
  },
) {
  return {
    name: "exec",
    label: "exec",
    description: "Execute a command",
    parameters: {},
    execute: vi.fn().mockResolvedValue(result),
  };
}

describe("wrapToolWithOutcomeAssertion", () => {
  it("returns tool unchanged when verifier is disabled", () => {
    const tool = makeExecTool();
    const context = makeContext({ config: makeConfig({ enabled: false }) });
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);
    expect(wrapped).toBe(tool);
  });

  it("returns non-exec tools unchanged", () => {
    const tool = { ...makeExecTool(), name: "read" };
    const context = makeContext();
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);
    expect(wrapped).toBe(tool);
  });

  it("wraps exec tools", () => {
    const tool = makeExecTool();
    const context = makeContext();
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);
    expect(wrapped).not.toBe(tool);
    expect(wrapped.execute).not.toBe(tool.execute);
  });

  it("sends ground-truth on failure", async () => {
    const tool = makeExecTool({
      details: { status: "failed", exitCode: 1, aggregated: "3 failed | 10 passed" },
    });
    const invalidateSpy = vi.fn();
    const context = makeContext({
      cache: {
        ...makeContext().cache,
        invalidate: invalidateSpy,
      },
    });
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);

    await wrapped.execute("call-1", { command: "pnpm test" }, undefined, undefined);

    expect(context.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("[verifier:outcome] FAILED"),
      "nudge",
    );
    expect(invalidateSpy).toHaveBeenCalledWith("g1");
  });

  it("does not send session message on pass", async () => {
    const tool = makeExecTool({
      details: { status: "completed", exitCode: 0, aggregated: "all tests passed" },
    });
    const invalidateSpy = vi.fn();
    const context = makeContext({
      cache: {
        ...makeContext().cache,
        invalidate: invalidateSpy,
      },
    });
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);

    await wrapped.execute("call-1", { command: "pnpm test" }, undefined, undefined);

    expect(context.sendToSession).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("does not double-wrap", () => {
    const tool = makeExecTool();
    const context = makeContext();
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);
    const doubleWrapped = wrapToolWithOutcomeAssertion(wrapped, context);
    expect(doubleWrapped).toBe(wrapped);
  });

  it("passes through result even on failure assertion", async () => {
    const originalResult = {
      details: { status: "failed", exitCode: 1, aggregated: "error" },
      content: [{ type: "text", text: "error" }],
    };
    const tool = makeExecTool(originalResult);
    const context = makeContext();
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);

    const result = await wrapped.execute("call-1", { command: "pnpm build" }, undefined, undefined);
    expect(result).toBe(originalResult);
  });

  it("handles missing details gracefully", async () => {
    const tool = makeExecTool({ content: [{ type: "text", text: "output" }] });
    const context = makeContext();
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);

    await wrapped.execute("call-1", {}, undefined, undefined);

    expect(context.sendToSession).not.toHaveBeenCalled();
  });

  it("catches thrown errors and classifies as failure", async () => {
    const tool = makeExecTool();
    tool.execute = vi.fn().mockRejectedValue(new Error("3 failed | 10 passed"));
    const invalidateSpy = vi.fn();
    const context = makeContext({
      cache: {
        ...makeContext().cache,
        invalidate: invalidateSpy,
      },
    });
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);

    await expect(
      wrapped.execute("call-1", { command: "pnpm test" }, undefined, undefined),
    ).rejects.toThrow("3 failed");

    expect(context.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("[verifier:outcome] FAILED"),
      "nudge",
    );
    expect(context.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("test failures detected"),
      "nudge",
    );
    expect(invalidateSpy).toHaveBeenCalledWith("g1");
  });

  it("includes command in ground-truth message", async () => {
    const tool = makeExecTool({
      details: { status: "failed", exitCode: 2, aggregated: "ELIFECYCLE" },
    });
    const context = makeContext();
    const wrapped = wrapToolWithOutcomeAssertion(tool, context);

    await wrapped.execute(
      "call-1",
      { command: "pnpm test -- src/verifier/" },
      undefined,
      undefined,
    );

    expect(context.sendToSession).toHaveBeenCalledWith(
      expect.stringContaining("pnpm test -- src/verifier/"),
      "nudge",
    );
  });
});
