import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/types.js";
import type { CronEvent } from "../cron/service.js";
import type { CronService } from "../cron/service.js";
import type { GoalManager } from "../goals/manager.js";
import type { Goal, Task } from "../goals/types.js";
import { NudgeEngine } from "./nudge.js";
import type { HorizonScanResult, NudgePolicy } from "./types.js";

const STALE_GOAL_MS = 48 * 60 * 60 * 1000;
const IMMINENT_DEADLINE_MS = 24 * 60 * 60 * 1000;

export const HORIZON_SCANNER_JOB_NAME = "initiative-horizon-scan";

function formatDeadline(deadlineMs: number | null): string {
  if (!deadlineMs) {
    return "soon";
  }
  return new Date(deadlineMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildStaleMessage(goal: Goal, tasks: Task[]): string {
  const remaining = tasks.filter((task) => task.status !== "done").length;
  return `Goal "${goal.title}" has had no activity for 48h. ${remaining} tasks remain. Should I continue?`;
}

function buildDeadlineMessage(goal: Goal, tasks: Task[]): string {
  const done = tasks.filter((task) => task.status === "done").length;
  return `Goal "${goal.title}" is due ${formatDeadline(goal.deadlineMs)}. ${done}/${tasks.length} tasks complete.`;
}

function buildReadyMessage(goal: Goal, tasks: Task[]): string {
  return `Tasks ready to start for "${goal.title}": ${tasks.map((task) => task.title).join(", ")}`;
}

export class HorizonScanner {
  async scan(params: {
    agentId: string;
    goalManager: GoalManager;
    nudgeEngine: NudgeEngine;
    nudgePolicy: NudgePolicy;
    sendToSession: (sessionKey: string, message: string) => Promise<void>;
  }): Promise<HorizonScanResult> {
    const staleGoals = params.goalManager.getStaleGoals(params.agentId, STALE_GOAL_MS);
    const imminentGoals = params.goalManager.getImminentDeadlines(
      params.agentId,
      IMMINENT_DEADLINE_MS,
    );
    const readyTasks = params.goalManager.getReadyTasks(params.agentId);

    const readyByGoal = new Map<string, Task[]>();
    for (const task of readyTasks) {
      const bucket = readyByGoal.get(task.goalId) ?? [];
      bucket.push(task);
      readyByGoal.set(task.goalId, bucket);
    }

    let scanned = 0;
    let nudged = 0;
    let skipped = 0;
    const now = Date.now();
    const nudgedGoalIds = new Set<string>();

    const nudgeGoal = async (goal: Goal, message: string) => {
      scanned += 1;
      if (!params.nudgeEngine.shouldNudge(goal.id, now, params.nudgePolicy)) {
        skipped += 1;
        return;
      }
      await params.sendToSession(goal.ownerSessionKey, message);
      params.nudgeEngine.recordNudge(goal.id, now);
      nudged += 1;
      nudgedGoalIds.add(goal.id);
    };

    for (const goal of staleGoals) {
      await nudgeGoal(
        goal,
        buildStaleMessage(goal, params.goalManager.listTasks({ goalId: goal.id })),
      );
    }

    for (const goal of imminentGoals) {
      if (nudgedGoalIds.has(goal.id)) {
        skipped += 1;
        continue;
      }
      await nudgeGoal(
        goal,
        buildDeadlineMessage(goal, params.goalManager.listTasks({ goalId: goal.id })),
      );
    }

    for (const [goalId, tasks] of readyByGoal) {
      if (nudgedGoalIds.has(goalId)) {
        skipped += 1;
        continue;
      }
      const goal = params.goalManager.getGoal(goalId);
      if (!goal) {
        continue;
      }
      await nudgeGoal(goal, buildReadyMessage(goal, tasks));
    }

    return { scanned, nudged, skipped };
  }
}

export async function handleHorizonScannerCronEvent(params: {
  event: CronEvent;
  agentId: string;
  goalManager: GoalManager;
  nudgeEngine: NudgeEngine;
  nudgePolicy: NudgePolicy;
  sendToSession: (sessionKey: string, message: string) => Promise<void>;
  scanner?: HorizonScanner;
  onWarning?: (message: string) => void;
}): Promise<{ status: "ignored" | "scanned" | "cron_error"; result?: HorizonScanResult }> {
  if (params.event.jobId !== HORIZON_SCANNER_JOB_NAME || params.event.action !== "finished") {
    return { status: "ignored" };
  }
  if (params.event.status !== "ok") {
    params.onWarning?.(`Horizon scanner cron job finished with status="${params.event.status}"`);
    return { status: "cron_error" };
  }

  const scanner = params.scanner ?? new HorizonScanner();
  const result = await scanner.scan({
    agentId: params.agentId,
    goalManager: params.goalManager,
    nudgeEngine: params.nudgeEngine,
    nudgePolicy: params.nudgePolicy,
    sendToSession: params.sendToSession,
  });
  return { status: "scanned", result };
}

export async function registerHorizonScannerCron(params: {
  cfg: OpenClawConfig;
  cron: CronService;
}): Promise<{ status: "registered" | "exists" | "disabled"; jobId?: string }> {
  if (params.cfg.initiative?.enabled === false) {
    return { status: "disabled" };
  }

  const jobs = await params.cron.list({ includeDisabled: true });
  const existing = jobs.find((job) => job.name === HORIZON_SCANNER_JOB_NAME);
  if (existing) {
    return { status: "exists", jobId: existing.id };
  }

  const created = await params.cron.add({
    name: HORIZON_SCANNER_JOB_NAME,
    agentId: resolveDefaultAgentId(params.cfg),
    schedule: {
      kind: "every",
      everyMs: Math.max(1, params.cfg.initiative?.horizonScanIntervalMins ?? 15) * 60_000,
    },
    wakeMode: "next-heartbeat",
    payload: {
      kind: "systemEvent",
      text: "Initiative horizon scan: review active goals, deadlines, and ready tasks.",
    },
    sessionTarget: "main",
    enabled: true,
  });
  return { status: "registered", jobId: created.id };
}
