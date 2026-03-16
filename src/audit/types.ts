export type DecisionOutcome = "success" | "error" | "denied";
export type ApprovalPolicy = "none" | "preview" | "required";

export interface DecisionEntry {
  id: string;
  agentId: string;
  sessionKey: string;
  turnId: string;
  at: number;
  toolName: string;
  toolInput: string;
  toolOutput: string | null;
  rationale: string | null;
  goalId: string | null;
  taskId: string | null;
  reversible: boolean;
  approvalPolicy: ApprovalPolicy;
  outcome: DecisionOutcome;
}

export interface AuditFilter {
  agentId?: string;
  sessionKey?: string;
  goalId?: string;
  taskId?: string;
  toolName?: string;
  since?: number;
  limit?: number;
}

export interface AuditStats {
  total: number;
  errors: number;
  denied: number;
  toolUsage: Record<string, number>;
}
