import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VERIFIER_CONFIG,
  InMemoryVerifierCache,
  initializeVerifier,
  mergeConfig,
} from "./gateway-wiring.js";
import type { VerifierDeps } from "./gateway-wiring.js";
import type { VerifierCacheEntry } from "./types.js";

// ── Helpers ──

function makeCacheEntry(overrides?: Partial<VerifierCacheEntry>): VerifierCacheEntry {
  return {
    goalId: "goal-1",
    driftScore: 0.1,
    alignment: "yes",
    lastVerifiedAt: Date.now(),
    lcmAvailable: false,
    ...overrides,
  };
}

function makeMinimalDeps(overrides?: Partial<VerifierDeps>): VerifierDeps {
  return {
    goalManager: {
      getActiveGoals: vi.fn().mockResolvedValue([]),
      getTasksForGoal: vi.fn().mockResolvedValue([]),
    },
    auditStore: {
      getRecentEntries: vi.fn().mockResolvedValue([]),
    },
    feedbackStore: {
      getRecentSignals: vi.fn().mockResolvedValue([]),
      getOverrideStats: vi.fn().mockResolvedValue({ confirmed: 0, overridden: 0 }),
    },
    sendToSession: vi.fn(),
    callModel: vi.fn().mockResolvedValue({
      content: '{"aligned":"yes","confidence":0.9,"reason":"ok","severity":"low"}',
    }),
    ...overrides,
  };
}

// ── InMemoryVerifierCache ──

describe("InMemoryVerifierCache", () => {
  let cache: InMemoryVerifierCache;

  beforeEach(() => {
    cache = new InMemoryVerifierCache(60_000);
  });

  it("get returns null for missing entry and increments misses", () => {
    const result = cache.get("nonexistent");

    expect(result).toBeNull();
    expect(cache.getMetrics().misses).toBe(1);
    expect(cache.getMetrics().hits).toBe(0);
  });

  it("get returns entry within TTL and increments hits", () => {
    const entry = makeCacheEntry();
    cache.set("goal-1", entry);

    const result = cache.get("goal-1");

    expect(result).toEqual(entry);
    expect(cache.getMetrics().hits).toBe(1);
    expect(cache.getMetrics().misses).toBe(0);
  });

  it("get returns null for expired entry and increments misses", () => {
    const entry = makeCacheEntry({
      lastVerifiedAt: Date.now() - 120_000, // 2 min ago, TTL is 60s
    });
    cache.set("goal-1", entry);

    const result = cache.get("goal-1");

    expect(result).toBeNull();
    expect(cache.getMetrics().misses).toBe(1);
    expect(cache.getMetrics().hits).toBe(0);
  });

  it("set + get roundtrip returns the stored entry", () => {
    const entry = makeCacheEntry({ goalId: "goal-42", driftScore: 0.55 });
    cache.set("goal-42", entry);

    const result = cache.get("goal-42");

    expect(result).toEqual(entry);
  });

  it("invalidate removes the entry", () => {
    cache.set("goal-1", makeCacheEntry());
    expect(cache.get("goal-1")).not.toBeNull();

    cache.invalidate("goal-1");

    // Miss incremented from this get, plus the hit from the first get
    const result = cache.get("goal-1");
    expect(result).toBeNull();
  });

  it("getMetrics returns correct counts", () => {
    cache.set("goal-1", makeCacheEntry());

    // 1 hit
    cache.get("goal-1");
    // 2 misses
    cache.get("missing-a");
    cache.get("missing-b");

    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(2);
    expect(metrics.onDemandChecks).toBe(0);
  });

  it("resetMetrics returns current metrics then resets to zero", () => {
    cache.set("goal-1", makeCacheEntry());
    cache.get("goal-1"); // hit
    cache.get("missing"); // miss

    const snapshot = cache.resetMetrics();

    expect(snapshot.hits).toBe(1);
    expect(snapshot.misses).toBe(1);

    const after = cache.getMetrics();
    expect(after.hits).toBe(0);
    expect(after.misses).toBe(0);
    expect(after.onDemandChecks).toBe(0);
  });

  it("acquireLock serializes: second acquire waits for first release", async () => {
    const order: string[] = [];

    const release1 = await cache.acquireLock("goal-1");
    order.push("lock1-acquired");

    // Start second lock acquisition (should wait)
    const lock2Promise = cache.acquireLock("goal-1").then((release2) => {
      order.push("lock2-acquired");
      release2();
      order.push("lock2-released");
    });

    // Yield microtask to confirm lock2 hasn't acquired yet
    await Promise.resolve();
    expect(order).toEqual(["lock1-acquired"]);

    // Release first lock
    release1();
    order.push("lock1-released");

    await lock2Promise;

    expect(order).toEqual(["lock1-acquired", "lock1-released", "lock2-acquired", "lock2-released"]);
  });
});

// ── mergeConfig ──

describe("mergeConfig", () => {
  it("returns defaults when no user config provided", () => {
    const result = mergeConfig(DEFAULT_VERIFIER_CONFIG);

    expect(result).toEqual(DEFAULT_VERIFIER_CONFIG);
  });

  it("returns defaults when user config is undefined", () => {
    const result = mergeConfig(DEFAULT_VERIFIER_CONFIG, undefined);

    expect(result).toEqual(DEFAULT_VERIFIER_CONFIG);
  });

  it("shallow merges top-level fields", () => {
    const result = mergeConfig(DEFAULT_VERIFIER_CONFIG, {
      enabled: false,
      scanIntervalMins: 10,
    });

    expect(result.enabled).toBe(false);
    expect(result.scanIntervalMins).toBe(10);
    // Other top-level fields unchanged
    expect(result.cacheTtlMs).toBe(DEFAULT_VERIFIER_CONFIG.cacheTtlMs);
    expect(result.softThreshold).toBe(DEFAULT_VERIFIER_CONFIG.softThreshold);
  });

  it("deep merges nested objects (calibration, escalation, tokenBudget, models)", () => {
    const result = mergeConfig(DEFAULT_VERIFIER_CONFIG, {
      calibration: { decayAlpha: 0.5, minThreshold: 0.25, maxThreshold: 0.85 },
      escalation: {
        sonnetBudgetPerGoalPerHour: 5,
        cooldownMs: 60_000,
        baseEscalationThreshold: 0.6,
        lcmUnavailableConfidenceDiscount: 0.7,
      },
    });

    expect(result.calibration.decayAlpha).toBe(0.5);
    expect(result.escalation.sonnetBudgetPerGoalPerHour).toBe(5);
    // Other nested fields retain defaults
    expect(result.tokenBudget).toEqual(DEFAULT_VERIFIER_CONFIG.tokenBudget);
    expect(result.models).toEqual(DEFAULT_VERIFIER_CONFIG.models);
  });

  it("partial nested overrides preserve unset defaults", () => {
    const result = mergeConfig(DEFAULT_VERIFIER_CONFIG, {
      models: {
        routine: "custom/model",
        routineParams: { fastMode: false },
        deep: DEFAULT_VERIFIER_CONFIG.models.deep,
        deepParams: DEFAULT_VERIFIER_CONFIG.models.deepParams,
        fallback: DEFAULT_VERIFIER_CONFIG.models.fallback,
        fallbackParams: DEFAULT_VERIFIER_CONFIG.models.fallbackParams,
      },
    });

    expect(result.models.routine).toBe("custom/model");
    expect(result.models.deep).toBe(DEFAULT_VERIFIER_CONFIG.models.deep);
    expect(result.models.fallback).toBe(DEFAULT_VERIFIER_CONFIG.models.fallback);
  });
});

// ── initializeVerifier ──

describe("initializeVerifier", () => {
  it("returns VerifierWiring with context, wrapTool, shutdown", () => {
    const deps = makeMinimalDeps();
    const wiring = initializeVerifier(deps);

    expect(wiring).toHaveProperty("context");
    expect(wiring).toHaveProperty("wrapTool");
    expect(wiring).toHaveProperty("shutdown");
    expect(typeof wiring.wrapTool).toBe("function");
    expect(typeof wiring.shutdown).toBe("function");
  });

  it("context has all expected fields", () => {
    const deps = makeMinimalDeps();
    const { context } = initializeVerifier(deps);

    expect(context.config).toBeDefined();
    expect(context.llmCall).toBeDefined();
    expect(context.cache).toBeDefined();
    expect(context.goalManager).toBeDefined();
    expect(context.auditStore).toBeDefined();
    expect(context.feedbackStore).toBeDefined();
    expect(context.sendToSession).toBeDefined();
    expect(typeof context.llmCall).toBe("function");
    expect(typeof context.sendToSession).toBe("function");
  });

  it("config merges user overrides with defaults", () => {
    const deps = makeMinimalDeps({
      userConfig: {
        scanIntervalMins: 15,
        softThreshold: 0.5,
      },
    });
    const { context } = initializeVerifier(deps);

    expect(context.config.scanIntervalMins).toBe(15);
    expect(context.config.softThreshold).toBe(0.5);
    // Defaults preserved for unset fields
    expect(context.config.enabled).toBe(DEFAULT_VERIFIER_CONFIG.enabled);
    expect(context.config.hardThreshold).toBe(DEFAULT_VERIFIER_CONFIG.hardThreshold);
    expect(context.config.models).toEqual(DEFAULT_VERIFIER_CONFIG.models);
  });

  it("shutdown is callable without error", () => {
    const deps = makeMinimalDeps();
    const wiring = initializeVerifier(deps);

    expect(() => wiring.shutdown()).not.toThrow();
  });
});
