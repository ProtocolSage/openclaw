import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  shouldEscalateToDeep,
  applyTieredResponse,
  updateCalibration,
  checkEscalationCooldown,
  EscalationCooldownTracker,
} from "./escalation.js";
import type { FeedbackStoreReader, VerifierConfig } from "./types.js";

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

function makeFeedbackStore(stats: { confirmed: number; overridden: number }): FeedbackStoreReader {
  return {
    getRecentSignals: vi.fn().mockResolvedValue([]),
    getOverrideStats: vi.fn().mockResolvedValue(stats),
  };
}

// ── shouldEscalateToDeep ──

describe("shouldEscalateToDeep", () => {
  it("returns true when confidence is below threshold", () => {
    const config = makeConfig();
    // baseEscalationThreshold = 0.6, riskAdjustment = 0
    // adjusted = 0.6, confidence = 0.4 < 0.6
    expect(shouldEscalateToDeep(0.4, 0, config)).toBe(true);
  });

  it("returns false when confidence is above threshold", () => {
    const config = makeConfig();
    // confidence = 0.8 > 0.6
    expect(shouldEscalateToDeep(0.8, 0, config)).toBe(false);
  });

  it("returns false when confidence equals threshold", () => {
    const config = makeConfig();
    // confidence = 0.6 === adjusted 0.6 -> not strictly less than
    expect(shouldEscalateToDeep(0.6, 0, config)).toBe(false);
  });

  it("risk adjustment lowers the effective threshold", () => {
    const config = makeConfig();
    // baseEscalationThreshold = 0.6, riskAdjustment = 0.2
    // adjusted = 0.4, confidence = 0.5 > 0.4 -> false
    expect(shouldEscalateToDeep(0.5, 0.2, config)).toBe(false);

    // confidence = 0.3 < 0.4 -> true
    expect(shouldEscalateToDeep(0.3, 0.2, config)).toBe(true);
  });

  it("negative risk adjustment raises the effective threshold", () => {
    const config = makeConfig();
    // adjusted = 0.6 - (-0.1) = 0.7
    // confidence = 0.65 < 0.7 -> true
    expect(shouldEscalateToDeep(0.65, -0.1, config)).toBe(true);
  });
});

// ── applyTieredResponse ──

describe("applyTieredResponse", () => {
  it("returns 'none' when drift is below soft threshold", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(0.2, config)).toBe("none");
  });

  it("returns 'nudge' when drift is between soft and hard threshold", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(0.5, config)).toBe("nudge");
  });

  it("returns 'block' when drift is above hard threshold", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(0.9, config)).toBe("block");
  });

  it("returns 'nudge' when drift is exactly at softThreshold", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(0.4, config)).toBe("nudge");
  });

  it("returns 'block' when drift is exactly at hardThreshold", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(0.7, config)).toBe("block");
  });

  it("returns 'none' when drift is zero", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(0, config)).toBe("none");
  });

  it("returns 'block' when drift is 1.0", () => {
    const config = makeConfig({ softThreshold: 0.4, hardThreshold: 0.7 });
    expect(applyTieredResponse(1.0, config)).toBe("block");
  });
});

// ── updateCalibration ──

describe("updateCalibration", () => {
  it("returns unchanged thresholds when no feedback data exists", async () => {
    const store = makeFeedbackStore({ confirmed: 0, overridden: 0 });
    const config = makeConfig();
    const current = { soft: 0.4, hard: 0.7 };

    const result = await updateCalibration(store, "goal-1", current, config);

    expect(result).toEqual({ soft: 0.4, hard: 0.7 });
  });

  it("loosens thresholds (toward max) with 100% override rate", async () => {
    const store = makeFeedbackStore({ confirmed: 0, overridden: 10 });
    const config = makeConfig();
    const current = { soft: 0.4, hard: 0.7 };

    const result = await updateCalibration(store, "goal-1", current, config);

    // overrideRate = 1.0 -> target = 0.1 + 1.0 * (0.9 - 0.1) = 0.9
    // alpha = 0.3
    // newSoft = 0.3 * 0.9 + 0.7 * 0.4 = 0.27 + 0.28 = 0.55
    // newHard = 0.3 * 0.9 + 0.7 * 0.7 = 0.27 + 0.49 = 0.76
    expect(result.soft).toBeCloseTo(0.55, 5);
    expect(result.hard).toBeCloseTo(0.76, 5);
    expect(result.soft).toBeGreaterThan(current.soft);
    expect(result.hard).toBeGreaterThan(current.hard);
  });

  it("tightens thresholds (toward min) with 0% override rate", async () => {
    const store = makeFeedbackStore({ confirmed: 10, overridden: 0 });
    const config = makeConfig();
    const current = { soft: 0.4, hard: 0.7 };

    const result = await updateCalibration(store, "goal-1", current, config);

    // overrideRate = 0.0 -> target = 0.1 + 0.0 * 0.8 = 0.1
    // newSoft = 0.3 * 0.1 + 0.7 * 0.4 = 0.03 + 0.28 = 0.31
    // newHard = 0.3 * 0.1 + 0.7 * 0.7 = 0.03 + 0.49 = 0.52
    expect(result.soft).toBeCloseTo(0.31, 5);
    expect(result.hard).toBeCloseTo(0.52, 5);
    expect(result.soft).toBeLessThan(current.soft);
    expect(result.hard).toBeLessThan(current.hard);
  });

  it("converges after repeated cycles of consistent feedback", async () => {
    const config = makeConfig();
    // 100% override rate each cycle
    const store = makeFeedbackStore({ confirmed: 0, overridden: 10 });
    let thresholds = { soft: 0.4, hard: 0.7 };

    for (let i = 0; i < 5; i++) {
      thresholds = await updateCalibration(store, "goal-1", thresholds, config);
    }

    // After 5 cycles with 100% override, both should converge toward 0.9
    // Each cycle: new = 0.3 * 0.9 + 0.7 * prev
    // Geometric convergence: after 5 cycles, soft should be close to 0.9
    expect(thresholds.soft).toBeGreaterThan(0.75);
    expect(thresholds.hard).toBeGreaterThan(0.85);

    // Verify convergence: two more cycles shouldn't change much
    const before = { ...thresholds };
    thresholds = await updateCalibration(store, "goal-1", thresholds, config);
    thresholds = await updateCalibration(store, "goal-1", thresholds, config);
    expect(Math.abs(thresholds.soft - before.soft)).toBeLessThan(0.05);
    expect(Math.abs(thresholds.hard - before.hard)).toBeLessThan(0.05);
  });

  it("clamps thresholds at minThreshold", async () => {
    // 0% override rate, already near min
    const store = makeFeedbackStore({ confirmed: 100, overridden: 0 });
    const config = makeConfig({
      calibration: {
        minThreshold: 0.2,
        maxThreshold: 0.9,
        decayAlpha: 0.9, // aggressive alpha to push toward min quickly
      },
    });
    const current = { soft: 0.2, hard: 0.25 };

    const result = await updateCalibration(store, "goal-1", current, config);

    // target = 0.2 (minThreshold since overrideRate = 0)
    // newSoft = 0.9 * 0.2 + 0.1 * 0.2 = 0.2 -> at min
    // newHard = 0.9 * 0.2 + 0.1 * 0.25 = 0.205 -> above min
    expect(result.soft).toBeGreaterThanOrEqual(0.2);
    expect(result.hard).toBeGreaterThanOrEqual(0.2);
  });

  it("clamps thresholds at maxThreshold", async () => {
    // 100% override rate, already near max
    const store = makeFeedbackStore({ confirmed: 0, overridden: 100 });
    const config = makeConfig({
      calibration: {
        minThreshold: 0.1,
        maxThreshold: 0.8,
        decayAlpha: 0.9, // aggressive alpha
      },
    });
    const current = { soft: 0.85, hard: 0.9 };

    const result = await updateCalibration(store, "goal-1", current, config);

    // target = 0.1 + 1.0 * (0.8 - 0.1) = 0.8
    // newSoft = 0.9 * 0.8 + 0.1 * 0.85 = 0.72 + 0.085 = 0.805 -> clamped to 0.8
    // newHard = 0.9 * 0.8 + 0.1 * 0.9 = 0.72 + 0.09 = 0.81 -> clamped to 0.8
    expect(result.soft).toBeLessThanOrEqual(0.8);
    expect(result.hard).toBeLessThanOrEqual(0.8);
  });
});

// ── checkEscalationCooldown ──

describe("checkEscalationCooldown", () => {
  it("returns true when lastEscalationAt is null (never escalated)", () => {
    expect(checkEscalationCooldown(null, 60_000)).toBe(true);
  });

  it("returns false when escalation is within cooldown window", () => {
    const now = Date.now();
    // Last escalated 10 seconds ago, cooldown is 60 seconds
    vi.setSystemTime(now);
    expect(checkEscalationCooldown(now - 10_000, 60_000)).toBe(false);
  });

  it("returns true when escalation is past cooldown window", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    // Last escalated 120 seconds ago, cooldown is 60 seconds
    expect(checkEscalationCooldown(now - 120_000, 60_000)).toBe(true);
  });

  it("returns true when escalation is exactly at cooldown boundary", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    // Last escalated exactly 60 seconds ago, cooldown is 60 seconds
    expect(checkEscalationCooldown(now - 60_000, 60_000)).toBe(true);
  });
});

// ── EscalationCooldownTracker ──

describe("EscalationCooldownTracker", () => {
  let tracker: EscalationCooldownTracker;

  beforeEach(() => {
    tracker = new EscalationCooldownTracker();
    vi.useRealTimers();
  });

  it("allows escalation for a new (unseen) goal", () => {
    expect(tracker.canEscalate("goal-new", 60_000)).toBe(true);
  });

  it("blocks escalation within cooldown after recording", () => {
    const baseTime = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    tracker.recordEscalation("goal-1");

    // 10 seconds later -- still in cooldown
    vi.setSystemTime(baseTime + 10_000);
    expect(tracker.canEscalate("goal-1", 60_000)).toBe(false);
  });

  it("allows escalation after cooldown expires", () => {
    const baseTime = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    tracker.recordEscalation("goal-1");

    // 61 seconds later -- past cooldown
    vi.setSystemTime(baseTime + 61_000);
    expect(tracker.canEscalate("goal-1", 60_000)).toBe(true);
  });

  it("tracks goals independently", () => {
    const baseTime = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    tracker.recordEscalation("goal-1");

    // goal-2 has never been escalated
    vi.setSystemTime(baseTime + 5_000);
    expect(tracker.canEscalate("goal-1", 60_000)).toBe(false);
    expect(tracker.canEscalate("goal-2", 60_000)).toBe(true);
  });

  it("allows re-escalation after recording and cooldown cycle", () => {
    const baseTime = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    tracker.recordEscalation("goal-1");

    // Past cooldown
    vi.setSystemTime(baseTime + 70_000);
    expect(tracker.canEscalate("goal-1", 60_000)).toBe(true);

    // Record again
    tracker.recordEscalation("goal-1");

    // 30s after second record -- still in cooldown
    vi.setSystemTime(baseTime + 100_000);
    expect(tracker.canEscalate("goal-1", 60_000)).toBe(false);

    // 61s after second record -- past cooldown
    vi.setSystemTime(baseTime + 131_000);
    expect(tracker.canEscalate("goal-1", 60_000)).toBe(true);
  });
});
