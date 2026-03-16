import { generateSecureToken } from "../infra/secure-random.js";
import type { ProposedCorrection } from "./types.js";

const CORRECTION_PATTERNS = [
  /^no[,.\s]/i,
  /that'?s (?:wrong|incorrect|not right)/i,
  /^actually[,\s]/i,
  /not that[,\s]/i,
  /^instead[,\s]/i,
  /don'?t do that/i,
];

export function detectCorrection(userMessage: string): boolean {
  const message = userMessage.trim();
  if (!message) {
    return false;
  }
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function deriveCorrectionRuleText(correctionText: string): string | null {
  const normalized = correctionText
    .trim()
    .replace(/^no[,.\s]*/i, "")
    .replace(/^actually[,.\s]*/i, "")
    .replace(/^instead[,.\s]*/i, "")
    .replace(/^not that[,.\s]*/i, "")
    .replace(/^that's wrong[,.\s]*/i, "")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

export async function extractProposedRule(params: {
  correctionText: string;
  originalAssistantText: string;
  llmCall: (prompt: string) => Promise<string>;
}): Promise<string | null> {
  try {
    const prompt = [
      "Extract a single concise correction rule from this user correction.",
      "Return only the rule text.",
      `Assistant: ${params.originalAssistantText}`,
      `Correction: ${params.correctionText}`,
    ].join("\n");
    const raw = await params.llmCall(prompt);
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function createProposedCorrection(params: {
  signalId: string;
  ruleText: string;
  sourceText: string;
}): ProposedCorrection {
  return {
    id: `correction-${Date.now().toString(36)}-${generateSecureToken(4)}`,
    signalId: params.signalId,
    ruleText: params.ruleText,
    sourceText: params.sourceText,
    status: "proposed",
    createdAt: Date.now(),
    reviewedAt: null,
  };
}
