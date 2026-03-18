const CLAIM_PATTERNS = [
  /\byou told me\b/i,
  /\bthe config is at\b/i,
  /\bthe function does\b/i,
  /\bthe code(base)?\b/i,
  /\bproject state\b/i,
] as const;

export function auditCitationMiss(params: {
  assistantText: unknown;
  toolNamesCalled?: ReadonlyArray<string | null | undefined> | null;
}): boolean {
  try {
    const assistantText =
      typeof params.assistantText === "string" ? params.assistantText.trim() : "";
    if (!assistantText) {
      return false;
    }

    const toolNamesCalled = new Set(
      Array.isArray(params.toolNamesCalled)
        ? params.toolNamesCalled
            .filter((toolName): toolName is string => typeof toolName === "string")
            .map((toolName) => toolName.trim().toLowerCase())
            .filter(Boolean)
        : [],
    );

    if (toolNamesCalled.has("memory_search")) {
      return false;
    }

    return CLAIM_PATTERNS.some((pattern) => pattern.test(assistantText));
  } catch {
    return false;
  }
}
