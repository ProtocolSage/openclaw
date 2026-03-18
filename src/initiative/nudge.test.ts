import { describe, expect, it } from "vitest";
import { NudgeEngine } from "./nudge.js";

describe("NudgeEngine", () => {
  it("returns false at 23:00 during 22-8 quiet hours", () => {
    const engine = new NudgeEngine();
    const now = new Date("2026-03-16T23:00:00").getTime();

    expect(
      engine.shouldNudge("goal-1", now, {
        maxNudgesPerHour: 2,
        quietHoursStart: 22,
        quietHoursEnd: 8,
        deduplicateWindowMs: 7_200_000,
        activeChannelWindowHours: 4,
      }),
    ).toBe(false);
  });

  it("returns false for the same goal within the deduplicate window", () => {
    const engine = new NudgeEngine();
    const now = new Date("2026-03-16T13:00:00").getTime();
    const policy = {
      maxNudgesPerHour: 2,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      deduplicateWindowMs: 7_200_000,
      activeChannelWindowHours: 4,
    };

    engine.recordNudge("goal-1", now);
    expect(engine.shouldNudge("goal-1", now + 1_000, policy)).toBe(false);
  });

  it("returns false when the hourly cap is already reached", () => {
    const engine = new NudgeEngine();
    const now = new Date("2026-03-16T13:00:00").getTime();
    const policy = {
      maxNudgesPerHour: 2,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      deduplicateWindowMs: 7_200_000,
      activeChannelWindowHours: 4,
    };

    engine.recordNudge("goal-1", now - 1_000);
    engine.recordNudge("goal-2", now - 2_000);
    expect(engine.shouldNudge("goal-3", now, policy)).toBe(false);
  });
});
