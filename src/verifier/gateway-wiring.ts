// src/verifier/gateway-wiring.ts
//
// Wires the verifier into the OpenClaw gateway.
// Called from server.impl.ts alongside existing onInitiativeCronEvent.
// Creates singletons (cache, budget) and connects to existing stores.

import type { VerifierConfigSection } from "../config/types.verifier.js";
import type { CronService } from "../cron/service.js";
import { wrapToolWithInlineGate } from "./inline-gate.js";
import { createVerifierLlmCall, DeepCheckBudget } from "./llm-call.js";
import { registerVerifierCron } from "./periodic-scan.js";
import type {
  AuditStoreReader,
  CacheMetrics,
  EscalationLevel,
  FeedbackStoreReader,
  GoalManagerReader,
  VerifierCache,
  VerifierCacheEntry,
  VerifierConfig,
  VerifierContext,
} from "./types.js";

// ── In-memory cache implementation ──

export class InMemoryVerifierCache implements VerifierCache {
  private entries: Map<string, VerifierCacheEntry> = new Map();
  private metrics: CacheMetrics = { hits: 0, misses: 0, onDemandChecks: 0 };
  private locks: Map<string, Promise<void>> = new Map();

  constructor(private ttlMs: number) {}

  get(goalId: string): VerifierCacheEntry | null {
    const entry = this.entries.get(goalId);
    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.lastVerifiedAt > this.ttlMs) {
      this.entries.delete(goalId);
      this.metrics.misses++;
      return null;
    }

    this.metrics.hits++;
    return entry;
  }

  set(goalId: string, entry: VerifierCacheEntry): void {
    this.entries.set(goalId, entry);
  }

  invalidate(goalId: string): void {
    this.entries.delete(goalId);
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): CacheMetrics {
    const snapshot = { ...this.metrics };
    this.metrics = { hits: 0, misses: 0, onDemandChecks: 0 };
    return snapshot;
  }

  // Per-goal mutex via promise chain
  async acquireLock(goalId: string): Promise<() => void> {
    const existing = this.locks.get(goalId) ?? Promise.resolve();

    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.locks.set(
      goalId,
      existing.then(() => next),
    );
    await existing;

    return release!;
  }
}

// ── Default config ──

export const DEFAULT_VERIFIER_CONFIG: VerifierConfig = {
  enabled: true,
  scanIntervalMins: 5,
  scanIntervalUnclearMins: 2,
  cacheTtlMs: 150_000, // 2.5 min
  softThreshold: 0.4,
  hardThreshold: 0.7,
  calibration: {
    minThreshold: 0.25,
    maxThreshold: 0.85,
    decayAlpha: 0.3,
  },
  escalation: {
    sonnetBudgetPerGoalPerHour: 3,
    cooldownMs: 60_000,
    baseEscalationThreshold: 0.6,
    lcmUnavailableConfidenceDiscount: 0.7,
  },
  tokenBudget: {
    toolInputTruncateChars: 120,
    auditWindowMaxEntries: 30,
    auditWindowMaxMinutes: 15,
  },
  models: {
    routine: "openai-codex/gpt-5.4",
    routineParams: { fastMode: true },
    deep: "openai-codex/gpt-5.4",
    deepParams: { fastMode: false },
    fallback: "xai/grok-4-1-fast-reasoning",
    fallbackParams: {},
  },
};

// ── Merge user config with defaults ──

export function mergeConfig(
  defaults: VerifierConfig,
  userConfig?: VerifierConfigSection,
): VerifierConfig {
  if (!userConfig) {
    return defaults;
  }

  return {
    ...defaults,
    ...userConfig,
    calibration: { ...defaults.calibration, ...userConfig.calibration },
    escalation: { ...defaults.escalation, ...userConfig.escalation },
    tokenBudget: { ...defaults.tokenBudget, ...userConfig.tokenBudget },
    models: { ...defaults.models, ...userConfig.models },
  };
}

// ── Gateway initialization ──

export interface VerifierDeps {
  goalManager: GoalManagerReader;
  auditStore: AuditStoreReader;
  feedbackStore: FeedbackStoreReader;
  /** Optional: cron registration is skipped when not provided (caller registers separately). */
  cronService?: CronService;
  sendToSession: (message: string, level: EscalationLevel) => void;
  callModel: (
    modelRef: string,
    messages: Array<{ role: string; content: string }>,
    params?: Record<string, unknown>,
  ) => Promise<{ content: string }>;
  userConfig?: VerifierConfigSection;
}

export interface VerifierWiring {
  context: VerifierContext;
  wrapTool: typeof wrapToolWithInlineGate;
  shutdown: () => void;
}

export function initializeVerifier(deps: VerifierDeps): VerifierWiring {
  const config = mergeConfig(DEFAULT_VERIFIER_CONFIG, deps.userConfig);

  // Create singletons
  const cache = new InMemoryVerifierCache(config.cacheTtlMs);
  const deepCheckBudget = new DeepCheckBudget(config.escalation.sonnetBudgetPerGoalPerHour);

  // Build llmCall with routing
  const llmCall = createVerifierLlmCall({
    modelConfig: config.models,
    callModel: deps.callModel,
    deepCheckBudget,
  });

  // Assemble context
  const context: VerifierContext = {
    config,
    llmCall,
    goalManager: deps.goalManager,
    auditStore: deps.auditStore,
    feedbackStore: deps.feedbackStore,
    cache,
    sendToSession: deps.sendToSession,
  };

  // Register cron (fire-and-forget; registration is idempotent)
  if (deps.cronService) {
    void registerVerifierCron(deps.cronService, config);
  }

  return {
    context,
    wrapTool: wrapToolWithInlineGate,
    shutdown: () => {
      // Cache is in-memory — nothing to close.
      // Cron persists across restarts via CronService.
    },
  };
}
