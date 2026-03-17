import { describe, it, expect, vi } from "vitest";
import { DEFAULT_VERIFIER_CONFIG } from "./gateway-wiring.js";
import { composeRunVerifierContext } from "./services.js";
import type {
  AuditStoreReader,
  FeedbackStoreReader,
  GoalManagerReader,
  LlmCallFn,
  VerifierCache,
  VerifierServices,
} from "./types.js";

function makeServices(overrides?: Partial<VerifierServices>): VerifierServices {
  return {
    config: { ...DEFAULT_VERIFIER_CONFIG },
    llmCall: vi.fn() as unknown as LlmCallFn,
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      invalidate: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({ hits: 0, misses: 0, onDemandChecks: 0 }),
      resetMetrics: vi.fn().mockReturnValue({ hits: 0, misses: 0, onDemandChecks: 0 }),
      acquireLock: vi.fn().mockResolvedValue(() => {}),
    } as unknown as VerifierCache,
    ...overrides,
  };
}

function makeGoalManager(): GoalManagerReader {
  return {
    getActiveGoals: vi.fn().mockResolvedValue([]),
    getTasksForGoal: vi.fn().mockResolvedValue([]),
  };
}

function makeAuditStore(): AuditStoreReader {
  return { getRecentEntries: vi.fn().mockResolvedValue([]) };
}

function makeFeedbackStore(): FeedbackStoreReader {
  return {
    getRecentSignals: vi.fn().mockResolvedValue([]),
    getOverrideStats: vi.fn().mockResolvedValue({ confirmed: 0, overridden: 0 }),
  };
}

describe("composeRunVerifierContext", () => {
  it("composes a VerifierContext from services + run-local deps", () => {
    const services = makeServices();
    const goalManager = makeGoalManager();
    const auditStore = makeAuditStore();
    const feedbackStore = makeFeedbackStore();
    const sendToSession = vi.fn();

    const ctx = composeRunVerifierContext({
      services,
      goalManager,
      auditStore,
      feedbackStore,
      sendToSession,
    });

    expect(ctx).toBeDefined();
    expect(ctx!.config).toBe(services.config);
    expect(ctx!.llmCall).toBe(services.llmCall);
    expect(ctx!.cache).toBe(services.cache);
    expect(ctx!.goalManager).toBe(goalManager);
    expect(ctx!.auditStore).toBe(auditStore);
    expect(ctx!.feedbackStore).toBe(feedbackStore);
    expect(ctx!.sendToSession).toBe(sendToSession);
  });

  it("returns undefined when services is undefined", () => {
    const result = composeRunVerifierContext({
      services: undefined,
      goalManager: makeGoalManager(),
      auditStore: makeAuditStore(),
      feedbackStore: makeFeedbackStore(),
      sendToSession: vi.fn(),
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when config.enabled is false", () => {
    const services = makeServices({
      config: { ...DEFAULT_VERIFIER_CONFIG, enabled: false },
    });
    const result = composeRunVerifierContext({
      services,
      goalManager: makeGoalManager(),
      auditStore: makeAuditStore(),
      feedbackStore: makeFeedbackStore(),
      sendToSession: vi.fn(),
    });
    expect(result).toBeUndefined();
  });
});
