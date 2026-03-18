// src/verifier/trajectory.ts
//
// Assembles trajectory context from live stores and computes drift scores.

import type {
  AuditStoreReader,
  FeedbackStoreReader,
  GoalManagerReader,
  VerifierConfig,
  VerifierPromptInput,
} from "./types.js";

export interface TrajectoryDeps {
  goalManager: GoalManagerReader;
  auditStore: AuditStoreReader;
  feedbackStore: FeedbackStoreReader;
  config: VerifierConfig;
}

// Drift scoring constants
const DECAY_ALPHA = 0.5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const ERROR_WEIGHT = 0.3;
const DENIED_WEIGHT = 0.4;
const USER_CORRECTION_WEIGHT = 0.5;

/**
 * Assembles VerifierPromptInput from live stores for a specific goal.
 * Failure handling: missing audit -> empty array, missing feedback -> empty array.
 */
export async function assembleTrajectoryContext(
  deps: TrajectoryDeps,
  goalId: string,
): Promise<VerifierPromptInput> {
  const { goalManager, auditStore, feedbackStore, config } = deps;

  // 1. Find goal from active goals
  const activeGoals = await goalManager.getActiveGoals();
  const goal = activeGoals.find((g) => g.id === goalId);

  if (!goal) {
    return {
      goal: { id: goalId, title: "(unknown)", status: "unknown" },
      recentTasks: [],
      auditWindow: [],
      recentFeedback: [],
    };
  }

  // 2. Get recent tasks
  let recentTasks: VerifierPromptInput["recentTasks"] = [];
  try {
    recentTasks = await goalManager.getTasksForGoal(goalId);
  } catch {
    // graceful degradation
  }

  // 3. Get audit entries
  let auditWindow: VerifierPromptInput["auditWindow"] = [];
  try {
    const entries = await auditStore.getRecentEntries(goalId, {
      maxEntries: config.tokenBudget.auditWindowMaxEntries,
      maxMinutes: config.tokenBudget.auditWindowMaxMinutes,
    });
    auditWindow = entries.map((e) => ({
      toolName: e.toolName,
      outcome: e.outcome,
      at: e.at,
    }));
  } catch {
    // graceful degradation
  }

  // 4. Get feedback signals
  let recentFeedback: VerifierPromptInput["recentFeedback"] = [];
  try {
    const signals = await feedbackStore.getRecentSignals(goalId);
    recentFeedback = signals.map((s) => ({
      type: s.type,
      payloadSummary: JSON.stringify(s.payload).slice(0, 200),
    }));
  } catch {
    // graceful degradation
  }

  return {
    goal: {
      id: goal.id,
      title: goal.title,
      status: goal.status,
      deadlineMs: goal.deadlineMs,
      priority: goal.priority as VerifierPromptInput["goal"]["priority"],
    },
    recentTasks,
    auditWindow,
    recentFeedback,
  };
}

/**
 * Computes a drift score from audit entries and feedback signals.
 * Uses windowed exponential decay -- recent entries weighted heavier.
 * Returns 0.0-1.0 range.
 */
export function computeDriftScore(
  auditEntries: Array<{ toolName: string; outcome: string; at: number }>,
  feedbackSignals: Array<{ type: string; payload: unknown; at: number }>,
): number {
  if (auditEntries.length === 0 && feedbackSignals.length === 0) {
    return 0;
  }

  const now = Date.now();
  const totalEntries = auditEntries.length + feedbackSignals.length;
  let weightedSum = 0;

  // Score audit entries with exponential decay
  for (const entry of auditEntries) {
    const age = now - entry.at;
    const decay = Math.exp((-DECAY_ALPHA * age) / WINDOW_MS);

    let entryScore = 0;
    if (entry.outcome === "error") {
      entryScore = ERROR_WEIGHT;
    } else if (entry.outcome === "denied") {
      entryScore = DENIED_WEIGHT;
    }
    // success/other outcomes contribute 0

    weightedSum += entryScore * decay;
  }

  // Score feedback signals with exponential decay
  for (const signal of feedbackSignals) {
    const age = now - signal.at;
    const decay = Math.exp((-DECAY_ALPHA * age) / WINDOW_MS);

    let signalScore = 0;
    if (signal.type === "user_correction") {
      signalScore = USER_CORRECTION_WEIGHT;
    }

    weightedSum += signalScore * decay;
  }

  // Normalize by entry count so decay affects the magnitude
  const raw = weightedSum / totalEntries;
  return Math.min(1, Math.max(0, raw));
}
