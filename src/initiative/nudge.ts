import type { NudgePolicy } from "./types.js";

function isQuietHours(now: number, policy: NudgePolicy): boolean {
  const hour = new Date(now).getHours();
  const start = policy.quietHoursStart;
  const end = policy.quietHoursEnd;
  if (start === end) {
    return false;
  }
  if (start < end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

function pruneRecent(values: number[], now: number, windowMs: number): number[] {
  return values.filter((value) => now - value < windowMs);
}

export class NudgeEngine {
  private readonly nudgeLog = new Map<string, number[]>();

  shouldNudge(goalId: string, now: number, policy: NudgePolicy): boolean {
    if (isQuietHours(now, policy)) {
      return false;
    }

    const lastHourCutoff = now - 60 * 60 * 1000;
    const nudgesLastHour = [...this.nudgeLog.values()]
      .flat()
      .filter((value) => value > lastHourCutoff);
    if (nudgesLastHour.length >= policy.maxNudgesPerHour) {
      return false;
    }

    const recentGoalNudges = pruneRecent(
      this.nudgeLog.get(goalId) ?? [],
      now,
      policy.deduplicateWindowMs,
    );
    return recentGoalNudges.length === 0;
  }

  recordNudge(goalId: string, now: number): void {
    const next = pruneRecent(this.nudgeLog.get(goalId) ?? [], now, 24 * 60 * 60 * 1000);
    next.push(now);
    this.nudgeLog.set(goalId, next);
  }
}
