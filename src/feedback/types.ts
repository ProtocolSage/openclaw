export type SignalType =
  | "task_outcome"
  | "user_correction"
  | "user_explicit"
  | "goal_abandoned"
  // tool_rejected: defined for future use when audit denial bridge is implemented (Second Wave).
  | "tool_rejected"
  | "verification_result"
  | "verification_override";

export interface FeedbackSignal {
  id: string;
  type: SignalType;
  agentId: string;
  sessionKey: string;
  at: number;
  payload: string;
}

export type CorrectionStatus = "proposed" | "approved" | "rejected";

export interface ProposedCorrection {
  id: string;
  signalId: string;
  ruleText: string;
  sourceText: string;
  status: CorrectionStatus;
  createdAt: number;
  reviewedAt: number | null;
}

export interface SignalFilter {
  agentId?: string;
  sessionKey?: string;
  type?: SignalType;
  since?: number;
  limit?: number;
}

export interface FeedbackStats {
  total: number;
  byType: Record<string, number>;
}
