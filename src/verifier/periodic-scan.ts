// src/verifier/periodic-scan.ts
//
// Periodic cron-driven trajectory scan for active goals.
// Registers an idempotent cron job and handles scan events.

import type { CronEvent, CronService } from "../cron/service.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { applyTieredResponse, updateCalibration } from "./escalation.js";
import { assembleTrajectoryContext, computeDriftScore } from "./trajectory.js";
import type { EscalationLevel, RoutineVerdict, VerifierConfig, VerifierContext } from "./types.js";
import { VERIFIER_PERIODIC_SCAN_JOB_NAME } from "./types.js";

const log = createSubsystemLogger("verifier");

// ── Cron registration ──

/**
 * Idempotent cron registration for the periodic verifier scan.
 * Returns "disabled" when verifier is off, "exists" when already registered,
 * or "registered" after creating the job.
 */
export async function registerVerifierCron(
  cronService: CronService,
  config: VerifierConfig,
): Promise<{ status: "registered" | "exists" | "disabled"; jobId?: string }> {
  if (!config.enabled) {
    return { status: "disabled" };
  }

  const jobs = await cronService.list({ includeDisabled: true });
  const existing = jobs.find((job) => job.name === VERIFIER_PERIODIC_SCAN_JOB_NAME);
  if (existing) {
    return { status: "exists", jobId: existing.id };
  }

  const created = await cronService.add({
    name: VERIFIER_PERIODIC_SCAN_JOB_NAME,
    agentId: "default",
    schedule: {
      kind: "every",
      everyMs: Math.max(1, config.scanIntervalMins) * 60_000,
    },
    wakeMode: "next-heartbeat",
    payload: {
      kind: "systemEvent",
      text: "Verifier periodic scan: review trajectory alignment for active goals.",
    },
    sessionTarget: "main",
    enabled: true,
  });
  return { status: "registered", jobId: created.id };
}

// ── Scan result ──

export type PeriodicScanResult =
  | { status: "ignored" }
  | { status: "disabled" }
  | { status: "cron_error" }
  | { status: "scanned"; scanned: number; nudged: number; failed: number };

// ── Cron event handler ──

/**
 * Handles cron events for the periodic verifier scan.
 * Iterates active goals, computes drift, applies tiered response,
 * updates cache, and runs calibration per goal.
 */
export async function handleVerifierCronEvent(
  evt: CronEvent,
  context: VerifierContext,
): Promise<PeriodicScanResult> {
  if (evt.jobId !== VERIFIER_PERIODIC_SCAN_JOB_NAME || evt.action !== "finished") {
    return { status: "ignored" };
  }
  if (!context.config.enabled) {
    return { status: "disabled" };
  }
  if (evt.status !== "ok") {
    log.warn(`Verifier cron job finished with status="${evt.status}"`);
    return { status: "cron_error" };
  }

  const goals = await context.goalManager.getActiveGoals();
  let scanned = 0;
  let nudged = 0;
  let failed = 0;

  for (const goal of goals) {
    try {
      const promptInput = await assembleTrajectoryContext(
        {
          goalManager: context.goalManager,
          auditStore: context.auditStore,
          feedbackStore: context.feedbackStore,
          config: context.config,
        },
        goal.id,
      );

      const result = (await context.llmCall(promptInput, "routine")) as RoutineVerdict;

      // Compute drift from audit + feedback
      const auditEntries = await context.auditStore.getRecentEntries(goal.id, {
        maxEntries: context.config.tokenBudget.auditWindowMaxEntries,
        maxMinutes: context.config.tokenBudget.auditWindowMaxMinutes,
      });
      const feedbackSignals = await context.feedbackStore.getRecentSignals(goal.id);
      const driftScore = computeDriftScore(auditEntries, feedbackSignals);

      // Update cache
      context.cache.set(goal.id, {
        goalId: goal.id,
        driftScore,
        alignment: result.aligned,
        lastVerifiedAt: Date.now(),
        lcmAvailable: promptInput.lcmContext?.available ?? false,
      });

      // Apply tiered response and send session messages when warranted
      const escalation: EscalationLevel = applyTieredResponse(driftScore, context.config);
      if (escalation === "nudge") {
        context.sendToSession(
          `Periodic scan: trajectory drift detected for "${goal.title}" -- ${result.reason}`,
          "nudge",
        );
        nudged++;
      } else if (escalation === "block") {
        context.sendToSession(
          `Periodic scan: high trajectory drift for "${goal.title}" -- ${result.reason}`,
          "block",
        );
        nudged++;
      }

      // Run calibration with current thresholds
      const currentThresholds = {
        soft: context.config.softThreshold,
        hard: context.config.hardThreshold,
      };
      await updateCalibration(context.feedbackStore, goal.id, currentThresholds, context.config);

      scanned++;
    } catch (err) {
      failed++;
      log.error(`Periodic scan failed for goal "${goal.id}": ${String(err)}`);
    }
  }

  // Reset metrics after full scan cycle
  context.cache.resetMetrics();

  return { status: "scanned", scanned, nudged, failed };
}
