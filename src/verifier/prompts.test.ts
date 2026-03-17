import { describe, expect, it } from "vitest";
import {
  DEFAULT_HAIKU_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_SONNET_SYSTEM_PROMPT_TEMPLATE,
  buildHaikuPrompt,
  buildSonnetPrompt,
  interpolatePromptTemplate,
  parseHaikuResponse,
  parseSonnetResponse,
  truncateToolInput,
} from "./prompts.js";
import { LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT, VERIFIER_SCHEMA_VERSION } from "./types.js";
import type { VerifierPromptInput } from "./types.js";

function makePromptInput(overrides?: Partial<VerifierPromptInput>): VerifierPromptInput {
  return {
    auditWindow: [
      { at: 1_710_000_000_000, outcome: "success", toolName: "file_write" },
      { at: 1_710_000_030_000, outcome: "error", toolName: "shell_exec" },
    ],
    currentAction: {
      toolInputSummary: "apply patch to verifier parser",
      toolName: "apply_patch",
    },
    goal: {
      deadlineMs: 1_710_100_000_000,
      id: "goal-1",
      priority: "high",
      status: "in_progress",
      title: "Keep the verifier aligned with the active goal",
    },
    lcmContext: {
      available: true,
      correctionHistory: ["User corrected the goal scope"],
      reasoningTraces: ["Agent considered blocking an unrelated migration"],
    },
    recentFeedback: [
      { payloadSummary: "User requested conservative blocking", type: "correction" },
    ],
    recentTasks: [
      { lastUpdatedAt: 1_710_000_100_000, status: "done", title: "Draft verifier spec" },
    ],
    ...overrides,
  };
}

describe("prompt defaults", () => {
  it("exposes spec-derived default templates", () => {
    expect(DEFAULT_HAIKU_SYSTEM_PROMPT_TEMPLATE).toContain("schemaVersion: {schemaVersion}");
    expect(DEFAULT_HAIKU_SYSTEM_PROMPT_TEMPLATE).toContain(
      "assess whether the agent's trajectory is aligned with the goal",
    );
    expect(DEFAULT_SONNET_SYSTEM_PROMPT_TEMPLATE).toContain(
      "Review the agent's full reasoning trace",
    );
    expect(DEFAULT_SONNET_SYSTEM_PROMPT_TEMPLATE).toContain("{responseSchema}");
  });

  it("interpolates known placeholders and leaves unknown placeholders intact", () => {
    const rendered = interpolatePromptTemplate("v{schemaVersion} {missing}", {
      schemaVersion: VERIFIER_SCHEMA_VERSION,
    });

    expect(rendered).toBe(`v${VERIFIER_SCHEMA_VERSION} {missing}`);
  });
});

describe("prompt builders", () => {
  it("builds the default haiku prompt", () => {
    const messages = buildHaikuPrompt(makePromptInput());

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain('"aligned": "yes" | "no" | "unclear"');
    expect(messages[1].content).toContain("Goal:");
    expect(messages[1].content).toContain("Current action:");
    expect(messages[1].content).not.toContain("LCM context:");
  });

  it("supports overriding the system templates", () => {
    const messages = buildSonnetPrompt(makePromptInput(), {
      templates: {
        sonnetSystem: "schema={schemaVersion}\n{responseSchema}\ncustom sonnet",
      },
    });

    expect(messages[0].content).toContain(`schema=${VERIFIER_SCHEMA_VERSION}`);
    expect(messages[0].content).toContain("custom sonnet");
    expect(messages[0].content).toContain('"verdict": "proceed" | "modify" | "block"');
  });

  it("includes LCM context in the sonnet prompt", () => {
    const messages = buildSonnetPrompt(makePromptInput());

    expect(messages[1].content).toContain("LCM context:");
    expect(messages[1].content).toContain("Agent considered blocking an unrelated migration");
    expect(messages[1].content).toContain("User corrected the goal scope");
  });
});

describe("response parsing", () => {
  it("parses a valid haiku response", () => {
    const result = parseHaikuResponse(
      JSON.stringify({
        aligned: "yes",
        confidence: 0.8,
        reason: "Recent actions match the goal.",
        schemaVersion: VERIFIER_SCHEMA_VERSION,
        severity: "low",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.aligned).toBe("yes");
    expect(result.value.confidence).toBe(0.8);
  });

  it("falls back on haiku parse failure", () => {
    const result = parseHaikuResponse("{not json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("invalid_json");
    expect(result.fallback.aligned).toBe("unclear");
    expect(result.fallback.confidence).toBe(0.3);
  });

  it("rejects haiku schema mismatches", () => {
    const result = parseHaikuResponse(
      JSON.stringify({
        aligned: "yes",
        confidence: 0.8,
        reason: "Mismatch",
        schemaVersion: 999,
        severity: "low",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("schema_version_mismatch");
    expect(result.fallback.schemaVersion).toBe(VERIFIER_SCHEMA_VERSION);
  });

  it("rejects invalid haiku enums", () => {
    const result = parseHaikuResponse(
      JSON.stringify({
        aligned: "maybe",
        confidence: 0.8,
        reason: "Bad enum",
        schemaVersion: VERIFIER_SCHEMA_VERSION,
        severity: "low",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("invalid_aligned");
  });

  it("clamps haiku confidence", () => {
    const result = parseHaikuResponse(
      JSON.stringify({
        aligned: "unclear",
        confidence: 1.5,
        reason: "Too high",
        schemaVersion: VERIFIER_SCHEMA_VERSION,
        severity: "medium",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.confidence).toBe(1);
  });

  it("parses sonnet responses and clamps with LCM discount", () => {
    const result = parseSonnetResponse(
      JSON.stringify({
        confidence: 1.5,
        reason: "Proceed carefully.",
        schemaVersion: VERIFIER_SCHEMA_VERSION,
        suggestedCorrection: "Keep the action scoped to the current goal.",
        verdict: "modify",
      }),
      { lcmAvailable: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.confidence).toBe(LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT);
    expect(result.value.verdict).toBe("modify");
  });

  it("rejects invalid sonnet enums and reports haiku fallback guidance", () => {
    const result = parseSonnetResponse(
      JSON.stringify({
        confidence: 0.7,
        reason: "Bad enum",
        schemaVersion: VERIFIER_SCHEMA_VERSION,
        suggestedCorrection: null,
        verdict: "pause",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("invalid_verdict");
    expect(result.fallbackToHaiku).toBe(true);
    expect(result.fallbackConfidenceMultiplier).toBe(0.7);
  });

  it("rejects sonnet schema mismatches", () => {
    const result = parseSonnetResponse(
      JSON.stringify({
        confidence: 0.7,
        reason: "Mismatch",
        schemaVersion: 2,
        suggestedCorrection: null,
        verdict: "block",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("schema_version_mismatch");
  });
});

describe("truncateToolInput", () => {
  it("keeps short inputs unchanged", () => {
    expect(truncateToolInput("short", 10)).toBe("short");
  });

  it("truncates long inputs with ASCII ellipsis", () => {
    expect(truncateToolInput("abcdefghij", 6)).toBe("abc...");
  });
});
