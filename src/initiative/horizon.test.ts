import { describe, expect, it, vi } from "vitest";
import { GoalManager } from "../goals/manager.js";
import { GoalStore } from "../goals/store.js";
import {
  handleHorizonScannerCronEvent,
  HORIZON_SCANNER_JOB_NAME,
  HorizonScanner,
  registerHorizonScannerCron,
} from "./horizon.js";
import { NudgeEngine } from "./nudge.js";

describe("HorizonScanner", () => {
  it("returns zeros when there is no work to scan", async () => {
    const store = new GoalStore();
    store.open(":memory:");
    try {
      const result = await new HorizonScanner().scan({
        agentId: "main",
        goalManager: new GoalManager(store),
        nudgeEngine: new NudgeEngine(),
        nudgePolicy: {
          maxNudgesPerHour: 2,
          quietHoursStart: 0,
          quietHoursEnd: 0,
          deduplicateWindowMs: 7_200_000,
          activeChannelWindowHours: 4,
        },
        sendToSession: vi.fn(),
      });
      expect(result).toEqual({ scanned: 0, nudged: 0, skipped: 0 });
    } finally {
      store.close();
    }
  });

  it("registers only one horizon cron job across repeated calls", async () => {
    const jobs: Array<{ id: string; name?: string }> = [];
    const cron = {
      list: vi.fn(async () => jobs),
      add: vi.fn(async (job: { name?: string }) => {
        const created = { id: `job-${jobs.length + 1}`, name: job.name };
        jobs.push(created);
        return created;
      }),
    };

    const cfg = {
      agents: { defaults: {}, list: [{ id: "main" }] },
      initiative: { enabled: true, horizonScanIntervalMins: 15 },
    };

    const first = await registerHorizonScannerCron({
      cfg: cfg as never,
      cron: cron as never,
    });
    const second = await registerHorizonScannerCron({
      cfg: cfg as never,
      cron: cron as never,
    });

    expect(first.status).toBe("registered");
    expect(second.status).toBe("exists");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(HORIZON_SCANNER_JOB_NAME);
  });

  it("skips registration when initiative is disabled", async () => {
    const cron = {
      list: vi.fn(),
      add: vi.fn(),
    };

    const result = await registerHorizonScannerCron({
      cfg: { initiative: { enabled: false } } as never,
      cron: cron as never,
    });

    expect(result).toEqual({ status: "disabled" });
    expect(cron.add).not.toHaveBeenCalled();
  });

  it("runs the scanner for finished ok horizon events", async () => {
    const store = new GoalStore();
    store.open(":memory:");
    try {
      const manager = new GoalManager(store);
      const goal = manager.createGoal({
        agentId: "main",
        ownerSessionKey: "agent:main:main",
        title: "Ship initiative",
      });
      manager.createTask({
        goalId: goal.id,
        agentId: "main",
        title: "Start initiative scan",
      });
      const sendToSession = vi.fn(async () => {});

      const result = await handleHorizonScannerCronEvent({
        event: {
          jobId: HORIZON_SCANNER_JOB_NAME,
          action: "finished",
          status: "ok",
        },
        agentId: "main",
        goalManager: manager,
        nudgeEngine: new NudgeEngine(),
        nudgePolicy: {
          maxNudgesPerHour: 2,
          quietHoursStart: 0,
          quietHoursEnd: 0,
          deduplicateWindowMs: 7_200_000,
          activeChannelWindowHours: 4,
        },
        sendToSession,
      });

      expect(result.status).toBe("scanned");
      expect(sendToSession).toHaveBeenCalledOnce();
    } finally {
      store.close();
    }
  });

  it("returns cron_error and warns when horizon job finishes with non-ok status", async () => {
    const store = new GoalStore();
    store.open(":memory:");
    try {
      const manager = new GoalManager(store);
      const sendToSession = vi.fn(async () => {});
      const onWarning = vi.fn();

      const result = await handleHorizonScannerCronEvent({
        event: {
          jobId: HORIZON_SCANNER_JOB_NAME,
          action: "finished",
          status: "error",
        },
        agentId: "main",
        goalManager: manager,
        nudgeEngine: new NudgeEngine(),
        nudgePolicy: {
          maxNudgesPerHour: 2,
          quietHoursStart: 0,
          quietHoursEnd: 0,
          deduplicateWindowMs: 7_200_000,
          activeChannelWindowHours: 4,
        },
        sendToSession,
        onWarning,
      });

      expect(result.status).toBe("cron_error");
      expect(onWarning).toHaveBeenCalledOnce();
      expect(sendToSession).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it("ignores non-horizon events", async () => {
    const store = new GoalStore();
    store.open(":memory:");
    try {
      const manager = new GoalManager(store);
      const sendToSession = vi.fn(async () => {});

      const result = await handleHorizonScannerCronEvent({
        event: {
          jobId: "other-job",
          action: "finished",
          status: "ok",
        },
        agentId: "main",
        goalManager: manager,
        nudgeEngine: new NudgeEngine(),
        nudgePolicy: {
          maxNudgesPerHour: 2,
          quietHoursStart: 22,
          quietHoursEnd: 8,
          deduplicateWindowMs: 7_200_000,
          activeChannelWindowHours: 4,
        },
        sendToSession,
      });

      expect(result).toEqual({ status: "ignored" });
      expect(sendToSession).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });
});
