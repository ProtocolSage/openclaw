// Config-layer types: all fields optional (user may omit any field).
// Runtime types with required fields live in src/verifier/types.ts.
// Gateway startup resolves these to required-field VerifierConfig via mergeConfig().

export interface VerifierConfigSection {
  enabled?: boolean;
  scanIntervalMins?: number;
  scanIntervalUnclearMins?: number;
  cacheTtlMs?: number;
  softThreshold?: number;
  hardThreshold?: number;
  calibration?: Partial<{
    minThreshold: number;
    maxThreshold: number;
    decayAlpha: number;
  }>;
  escalation?: Partial<{
    sonnetBudgetPerGoalPerHour: number;
    cooldownMs: number;
    baseEscalationThreshold: number;
    lcmUnavailableConfidenceDiscount: number;
  }>;
  tokenBudget?: Partial<{
    toolInputTruncateChars: number;
    auditWindowMaxEntries: number;
    auditWindowMaxMinutes: number;
  }>;
  models?: Partial<{
    routine: string;
    routineParams: Record<string, unknown>;
    deep: string;
    deepParams: Record<string, unknown>;
    fallback: string;
    fallbackParams: Record<string, unknown>;
  }>;
}
