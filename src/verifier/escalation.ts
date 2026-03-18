// src/verifier/escalation.ts
//
// Escalation logic for the trajectory verifier.
// Tiered response, calibration via EMA, and per-goal cooldown tracking.

import type { EscalationLevel, FeedbackStoreReader, VerifierConfig } from "./types.js";

/**
 * Determines if a routine check should escalate to a deep check.
 * Returns true when confidence is below the adjusted escalation threshold.
 */
export function shouldEscalateToDeep(
  confidence: number,
  riskAdjustment: number,
  config: VerifierConfig,
): boolean {
  const adjustedThreshold = config.escalation.baseEscalationThreshold - riskAdjustment;
  return confidence < adjustedThreshold;
}

/**
 * Applies tiered response based on drift score vs soft/hard thresholds.
 * - drift < softThreshold  -> "none"  (pass through)
 * - softThreshold <= drift < hardThreshold -> "nudge" (warn user)
 * - drift >= hardThreshold -> "block" (prevent action)
 */
export function applyTieredResponse(driftScore: number, config: VerifierConfig): EscalationLevel {
  if (driftScore >= config.hardThreshold) {
    return "block";
  }
  if (driftScore >= config.softThreshold) {
    return "nudge";
  }
  return "none";
}

/**
 * Updates calibration thresholds based on override feedback.
 * Uses EMA (Exponential Moving Average) with configurable decayAlpha.
 * Clamps result to [minThreshold, maxThreshold].
 *
 * When overrideRate > 0.5 the thresholds are too aggressive -- loosen toward max.
 * When overrideRate < 0.5 the thresholds may be too lenient -- tighten toward min.
 * When overrideRate === 0.5, thresholds drift toward the midpoint.
 */
export async function updateCalibration(
  feedbackStore: FeedbackStoreReader,
  goalId: string,
  currentThresholds: { soft: number; hard: number },
  config: VerifierConfig,
): Promise<{ soft: number; hard: number }> {
  const stats = await feedbackStore.getOverrideStats(goalId);
  const total = stats.confirmed + stats.overridden;

  // No data -- return current thresholds unchanged
  if (total === 0) {
    return { ...currentThresholds };
  }

  const overrideRate = stats.overridden / total;
  const alpha = config.calibration.decayAlpha;
  const minT = config.calibration.minThreshold;
  const maxT = config.calibration.maxThreshold;

  // Target: high override rate -> loosen (toward max), low -> tighten (toward min)
  // Linear interpolation: target = minT + overrideRate * (maxT - minT)
  const targetSoft = minT + overrideRate * (maxT - minT);
  const targetHard = minT + overrideRate * (maxT - minT);

  // EMA: newThreshold = alpha * target + (1 - alpha) * current
  const newSoft = alpha * targetSoft + (1 - alpha) * currentThresholds.soft;
  const newHard = alpha * targetHard + (1 - alpha) * currentThresholds.hard;

  return {
    soft: clamp(newSoft, minT, maxT),
    hard: clamp(newHard, minT, maxT),
  };
}

/** Clamp a value to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Checks per-goal escalation cooldown to prevent duplicate nudges/blocks.
 * Returns true if enough time has passed since last escalation.
 */
export function checkEscalationCooldown(
  lastEscalationAt: number | null,
  cooldownMs: number,
): boolean {
  if (lastEscalationAt === null) {
    return true;
  }
  return Date.now() - lastEscalationAt >= cooldownMs;
}

/**
 * Per-goal cooldown tracker.
 * Prevents repeated escalation events for the same goal within a cooldown window.
 * Follows the pruneRecent pattern from `src/initiative/nudge.ts`.
 */
export class EscalationCooldownTracker {
  private lastEscalation: Map<string, number> = new Map();

  canEscalate(goalId: string, cooldownMs: number): boolean {
    const last = this.lastEscalation.get(goalId) ?? null;
    return checkEscalationCooldown(last, cooldownMs);
  }

  recordEscalation(goalId: string): void {
    this.lastEscalation.set(goalId, Date.now());
  }
}
