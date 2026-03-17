// src/verifier/types.ts
//
// Core type system for the trajectory verifier.
// Reader interfaces decouple from concrete store implementations.

// ── Schema versioning ──
export const VERIFIER_SCHEMA_VERSION = 1;

// ── Confidence adjustments ──
export const LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT = 0.7;

// ── Periodic scan job name ──
export const VERIFIER_PERIODIC_SCAN_JOB_NAME = "verifier-periodic-scan";

// ── Check levels ──
export type VerifierCheckLevel = "routine" | "deep";

// ── Alignment ──
export type Alignment = "yes" | "no" | "unclear";

// ── Escalation ──
export type EscalationLevel = "none" | "nudge" | "block";
export type Severity = "low" | "medium" | "high";

// ── Haiku-equivalent response (routine check) ──
export interface RoutineVerdict {
  schemaVersion: number;
  aligned: Alignment;
  confidence: number; // 0-1, clamped by parser
  reason: string;
  severity: Severity;
}

// ── Sonnet-equivalent response (deep check) ──
export type DeepAction = "proceed" | "modify" | "block";

export interface DeepVerdict {
  schemaVersion: number;
  verdict: DeepAction;
  confidence: number; // 0-1, clamped by parser
  reason: string;
  suggestedCorrection: string | null;
}

export type VerifierVerdict = RoutineVerdict | DeepVerdict;

// ── Drift scoring ──
export interface DriftScore {
  goalId: string;
  score: number; // 0-1
  alignment: Alignment;
  lastVerifiedAt: number; // epoch ms
  checkLevel: VerifierCheckLevel;
}

// ── Cache entry ──
export interface VerifierCacheEntry {
  goalId: string;
  driftScore: number;
  alignment: Alignment;
  lastVerifiedAt: number;
  lcmAvailable: boolean;
}

// ── Cache metrics (observability) ──
export interface CacheMetrics {
  hits: number;
  misses: number;
  onDemandChecks: number;
}

// ── Prompt input ──
export interface VerifierPromptInput {
  goal: {
    id: string;
    title: string;
    status: string;
    deadlineMs?: number;
    priority?: "low" | "medium" | "high" | "critical";
  };
  recentTasks: Array<{
    title: string;
    status: string;
    lastUpdatedAt: number;
  }>;
  auditWindow: Array<{
    toolName: string;
    outcome: string;
    at: number;
  }>;
  recentFeedback: Array<{
    type: string;
    payloadSummary: string;
  }>;
  // Inline gate only
  currentAction?: {
    toolName: string;
    toolInputSummary: string; // truncated to 120 chars
  };
  // Deep check only
  lcmContext?: {
    available: boolean;
    reasoningTraces: string[];
    correctionHistory: string[];
  };
}

// ── Reversibility ──
export type Reversibility = "reversible" | "irreversible";

// ── Tool metadata extension ──
export interface ToolReversibilityMeta {
  reversibility?: Reversibility;
  // Fallback chain: tool.reversibility ?? classifyTool(tool.name) ?? "irreversible"
}

// ── Verifier model config ──
export interface VerifierModelConfig {
  routine: string; // e.g. "openai-codex/gpt-5.4"
  routineParams: Record<string, unknown>;
  deep: string; // e.g. "openai-codex/gpt-5.4"
  deepParams: Record<string, unknown>;
  fallback: string; // e.g. "xai/grok-4-1-fast-reasoning"
  fallbackParams: Record<string, unknown>;
}

// ── Verifier config (from openclaw.json → verifier section) ──
export interface VerifierConfig {
  enabled: boolean;
  scanIntervalMins: number;
  scanIntervalUnclearMins: number;
  cacheTtlMs: number;
  softThreshold: number;
  hardThreshold: number;
  calibration: {
    minThreshold: number;
    maxThreshold: number;
    decayAlpha: number; // EMA decay for calibration convergence
  };
  escalation: {
    sonnetBudgetPerGoalPerHour: number;
    cooldownMs: number;
    baseEscalationThreshold: number;
    lcmUnavailableConfidenceDiscount: number;
  };
  tokenBudget: {
    toolInputTruncateChars: number;
    auditWindowMaxEntries: number;
    auditWindowMaxMinutes: number;
  };
  models: VerifierModelConfig;
}

// ── LLM call abstraction ──
export type LlmCallFn = (
  prompt: VerifierPromptInput,
  level: VerifierCheckLevel,
) => Promise<VerifierVerdict>;

// ── Verifier context (passed to all verifier functions) ──
export interface VerifierContext {
  config: VerifierConfig;
  llmCall: LlmCallFn;
  goalManager: GoalManagerReader;
  auditStore: AuditStoreReader;
  feedbackStore: FeedbackStoreReader;
  cache: VerifierCache;
  sendToSession: (message: string, level: EscalationLevel) => void;
}

// ── Gateway-scoped shared services (threaded to embedded runs) ──
// Runs compose a full VerifierContext from these + local stores.
export interface VerifierServices {
  config: VerifierConfig;
  llmCall: LlmCallFn;
  cache: VerifierCache;
}

// ── Read-only store interfaces (no new stores) ──
export interface GoalManagerReader {
  getActiveGoals(): Promise<
    Array<{
      id: string;
      title: string;
      status: string;
      deadlineMs?: number;
      priority?: string;
    }>
  >;
  getTasksForGoal(goalId: string): Promise<
    Array<{
      title: string;
      status: string;
      lastUpdatedAt: number;
    }>
  >;
}

export interface AuditStoreReader {
  getRecentEntries(
    goalId: string,
    opts: {
      maxEntries: number;
      maxMinutes: number;
    },
  ): Promise<
    Array<{
      toolName: string;
      outcome: string;
      at: number;
      toolInput?: string;
    }>
  >;
}

export interface FeedbackStoreReader {
  getRecentSignals(goalId: string): Promise<
    Array<{
      type: string;
      payload: unknown;
      at: number;
    }>
  >;
  getOverrideStats(goalId: string): Promise<{
    confirmed: number;
    overridden: number;
  }>;
}

// ── Cache interface ──
export interface VerifierCache {
  get(goalId: string): VerifierCacheEntry | null;
  set(goalId: string, entry: VerifierCacheEntry): void;
  invalidate(goalId: string): void;
  getMetrics(): CacheMetrics;
  resetMetrics(): CacheMetrics; // returns metrics then resets
  // Per-goal mutex for concurrent gate access
  acquireLock(goalId: string): Promise<() => void>; // returns release fn
}
