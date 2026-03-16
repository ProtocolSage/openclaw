import { generateSecureToken } from "../infra/secure-random.js";
import type { FeedbackStore } from "./store.js";
import type { FeedbackSignal } from "./types.js";

function createSignal(params: {
  type: FeedbackSignal["type"];
  agentId: string;
  sessionKey: string;
  payload: Record<string, unknown>;
}): FeedbackSignal {
  return {
    id: `feedback-${Date.now().toString(36)}-${generateSecureToken(4)}`,
    type: params.type,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    at: Date.now(),
    payload: JSON.stringify(params.payload),
  };
}

function appendSignalSafely(
  store: FeedbackStore | undefined,
  signal: FeedbackSignal,
): string | null {
  if (!store) {
    return null;
  }
  try {
    store.appendSignal(signal);
    return signal.id;
  } catch {
    return null;
  }
}

export function emitTaskCompleteSignal(params: {
  feedbackStore?: FeedbackStore;
  agentId: string;
  sessionKey: string;
  taskId: string;
  goalId: string;
  quality: "good" | "partial" | "poor";
  result?: string | null;
}): string | null {
  return appendSignalSafely(
    params.feedbackStore,
    createSignal({
      type: "task_outcome",
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      payload: {
        taskId: params.taskId,
        goalId: params.goalId,
        status: "complete",
        quality: params.quality,
        result: params.result ?? null,
      },
    }),
  );
}

export function emitTaskFailedSignal(params: {
  feedbackStore?: FeedbackStore;
  agentId: string;
  sessionKey: string;
  taskId: string;
  goalId: string;
  reason: string;
  retried: boolean;
}): string | null {
  return appendSignalSafely(
    params.feedbackStore,
    createSignal({
      type: "task_outcome",
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      payload: {
        taskId: params.taskId,
        goalId: params.goalId,
        status: "failed",
        reason: params.reason,
        retried: params.retried,
      },
    }),
  );
}

export function emitGoalAbandonedSignal(params: {
  feedbackStore?: FeedbackStore;
  agentId: string;
  sessionKey: string;
  goalId: string;
  reason?: string | null;
}): string | null {
  return appendSignalSafely(
    params.feedbackStore,
    createSignal({
      type: "goal_abandoned",
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      payload: {
        goalId: params.goalId,
        reason: params.reason ?? null,
      },
    }),
  );
}

export function emitUserExplicitSignal(params: {
  feedbackStore?: FeedbackStore;
  agentId: string;
  sessionKey: string;
  signal: "positive" | "negative";
  context: string;
}): string | null {
  return appendSignalSafely(
    params.feedbackStore,
    createSignal({
      type: "user_explicit",
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      payload: {
        signal: params.signal,
        context: params.context,
      },
    }),
  );
}

export function emitUserCorrection(params: {
  feedbackStore?: FeedbackStore;
  agentId: string;
  sessionKey: string;
  correctionText: string;
  originalAssistantText: string;
  turnId?: string;
}): string | null {
  return appendSignalSafely(
    params.feedbackStore,
    createSignal({
      type: "user_correction",
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      payload: {
        correctionText: params.correctionText,
        originalAssistantText: params.originalAssistantText,
        turnId: params.turnId ?? null,
      },
    }),
  );
}
