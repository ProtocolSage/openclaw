// src/verifier/services.ts
//
// Composes a run-scoped VerifierContext from gateway-shared VerifierServices
// and per-run local stores. This ensures the inline gate checks the correct
// agent's goals and reads the correct session's audit/feedback data.

import type {
  AuditStoreReader,
  EscalationLevel,
  FeedbackStoreReader,
  GoalManagerReader,
  VerifierContext,
  VerifierServices,
} from "./types.js";

export interface ComposeRunContextDeps {
  services: VerifierServices | undefined;
  goalManager: GoalManagerReader;
  auditStore: AuditStoreReader;
  feedbackStore: FeedbackStoreReader;
  sendToSession: (message: string, level: EscalationLevel) => void;
}

/**
 * Composes a run-scoped VerifierContext from shared services + local stores.
 * Returns undefined if services are not provided or verifier is disabled.
 */
export function composeRunVerifierContext(
  deps: ComposeRunContextDeps,
): VerifierContext | undefined {
  if (!deps.services) {
    return undefined;
  }
  if (!deps.services.config.enabled) {
    return undefined;
  }
  return {
    config: deps.services.config,
    llmCall: deps.services.llmCall,
    cache: deps.services.cache,
    goalManager: deps.goalManager,
    auditStore: deps.auditStore,
    feedbackStore: deps.feedbackStore,
    sendToSession: deps.sendToSession,
  };
}
