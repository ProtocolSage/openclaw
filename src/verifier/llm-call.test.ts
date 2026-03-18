import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createVerifierLlmCall,
  DeepCheckBudget,
  parseRoutineResponse,
  parseDeepResponse,
  type ModelCallFn,
} from "./llm-call.js";
import { VERIFIER_SCHEMA_VERSION, LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT } from "./types.js";
import type {
  VerifierModelConfig,
  VerifierPromptInput,
  RoutineVerdict,
  DeepVerdict,
} from "./types.js";

// ── Fixtures ──

function makeModelConfig(): VerifierModelConfig {
  return {
    routine: "codex/fast",
    routineParams: { temperature: 0 },
    deep: "codex/full",
    deepParams: { temperature: 0 },
    fallback: "grok/fallback",
    fallbackParams: { temperature: 0.1 },
  };
}

function makePromptInput(overrides?: Partial<VerifierPromptInput>): VerifierPromptInput {
  return {
    goal: { id: "goal-42", title: "Ship feature X", status: "active" },
    recentTasks: [{ title: "Write tests", status: "done", lastUpdatedAt: Date.now() }],
    auditWindow: [{ toolName: "file_read", outcome: "success", at: Date.now() }],
    recentFeedback: [],
    ...overrides,
  };
}

// ── parseRoutineResponse ──

describe("parseRoutineResponse", () => {
  it("parses valid JSON correctly", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "yes",
      confidence: 0.9,
      reason: "Actions match goal",
      severity: "low",
    });
    const result = parseRoutineResponse(raw);
    expect(result).not.toBeNull();
    const verdict = result as RoutineVerdict;
    expect(verdict.aligned).toBe("yes");
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.reason).toBe("Actions match goal");
    expect(verdict.severity).toBe("low");
    expect(verdict.schemaVersion).toBe(VERIFIER_SCHEMA_VERSION);
  });

  it("returns null for malformed JSON", () => {
    expect(parseRoutineResponse("not json at all")).toBeNull();
  });

  it("parses markdown-fenced JSON", () => {
    const json = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "no",
      confidence: 0.7,
      reason: "Drift detected",
      severity: "high",
    });
    const raw = `\`\`\`json\n${json}\n\`\`\``;
    const result = parseRoutineResponse(raw);
    expect(result).not.toBeNull();
    expect((result as RoutineVerdict).aligned).toBe("no");
  });

  it("clamps confidence above 1.0 to 1.0", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "yes",
      confidence: 1.5,
      reason: "Overcertain",
      severity: "low",
    });
    const result = parseRoutineResponse(raw);
    expect(result).not.toBeNull();
    expect((result as RoutineVerdict).confidence).toBe(1.0);
  });

  it("clamps negative confidence to 0.0", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "unclear",
      confidence: -0.3,
      reason: "Negative",
      severity: "medium",
    });
    const result = parseRoutineResponse(raw);
    expect(result).not.toBeNull();
    expect((result as RoutineVerdict).confidence).toBe(0.0);
  });

  it("returns null for schema version mismatch", () => {
    const raw = JSON.stringify({
      schemaVersion: 999,
      aligned: "yes",
      confidence: 0.9,
      reason: "Wrong version",
      severity: "low",
    });
    expect(parseRoutineResponse(raw)).toBeNull();
  });

  it("returns null for invalid aligned enum value", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "maybe",
      confidence: 0.5,
      reason: "Bad enum",
      severity: "low",
    });
    expect(parseRoutineResponse(raw)).toBeNull();
  });

  it("returns null for invalid severity enum value", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "yes",
      confidence: 0.5,
      reason: "Bad severity",
      severity: "critical",
    });
    expect(parseRoutineResponse(raw)).toBeNull();
  });

  it("accepts response without schemaVersion field", () => {
    const raw = JSON.stringify({
      aligned: "yes",
      confidence: 0.8,
      reason: "No version field",
      severity: "low",
    });
    const result = parseRoutineResponse(raw);
    expect(result).not.toBeNull();
    expect((result as RoutineVerdict).schemaVersion).toBe(VERIFIER_SCHEMA_VERSION);
  });
});

// ── parseDeepResponse ──

describe("parseDeepResponse", () => {
  it("parses valid deep response", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "proceed",
      confidence: 0.85,
      reason: "Trajectory is sound",
      suggestedCorrection: null,
    });
    const result = parseDeepResponse(raw, true);
    expect(result).not.toBeNull();
    const verdict = result as DeepVerdict;
    expect(verdict.verdict).toBe("proceed");
    expect(verdict.confidence).toBe(0.85);
    expect(verdict.suggestedCorrection).toBeNull();
  });

  it("applies LCM discount when lcmAvailable is false", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "proceed",
      confidence: 0.8,
      reason: "Without LCM",
      suggestedCorrection: null,
    });
    const result = parseDeepResponse(raw, false);
    expect(result).not.toBeNull();
    // 0.8 * 0.7 = 0.56
    expect((result as DeepVerdict).confidence).toBeCloseTo(
      0.8 * LCM_UNAVAILABLE_CONFIDENCE_DISCOUNT,
    );
  });

  it("returns null for invalid verdict enum", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "pause",
      confidence: 0.5,
      reason: "Bad verdict",
      suggestedCorrection: null,
    });
    expect(parseDeepResponse(raw, true)).toBeNull();
  });

  it("parses markdown-fenced deep response", () => {
    const json = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "modify",
      confidence: 0.6,
      reason: "Needs correction",
      suggestedCorrection: "Change approach to X",
    });
    const raw = `\`\`\`json\n${json}\n\`\`\``;
    const result = parseDeepResponse(raw, true);
    expect(result).not.toBeNull();
    expect((result as DeepVerdict).suggestedCorrection).toBe("Change approach to X");
  });

  it("coerces non-string suggestedCorrection to null", () => {
    const raw = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "proceed",
      confidence: 0.9,
      reason: "Fine",
      suggestedCorrection: 42,
    });
    const result = parseDeepResponse(raw, true);
    expect(result).not.toBeNull();
    expect((result as DeepVerdict).suggestedCorrection).toBeNull();
  });
});

// ── DeepCheckBudget ──

describe("DeepCheckBudget", () => {
  it("allows checks up to the budget limit", () => {
    const budget = new DeepCheckBudget(3);
    expect(budget.canCheck("g1")).toBe(true);
    budget.record("g1");
    budget.record("g1");
    budget.record("g1");
    expect(budget.canCheck("g1")).toBe(false);
  });

  it("tracks goals independently", () => {
    const budget = new DeepCheckBudget(1);
    budget.record("g1");
    expect(budget.canCheck("g1")).toBe(false);
    expect(budget.canCheck("g2")).toBe(true);
  });

  it("resets after rolling window expires", () => {
    const budget = new DeepCheckBudget(1);
    budget.record("g1");
    expect(budget.canCheck("g1")).toBe(false);

    // Advance time past the 1-hour window
    const realNow = Date.now;
    Date.now = () => realNow() + 3_600_001;
    try {
      expect(budget.canCheck("g1")).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

// ── createVerifierLlmCall (integration via mock callModel) ──

describe("createVerifierLlmCall", () => {
  let mockCallModel: ReturnType<typeof vi.fn<ModelCallFn>>;

  beforeEach(() => {
    mockCallModel = vi.fn<ModelCallFn>();
  });

  function makeLlmCall(budgetLimit = 3) {
    return createVerifierLlmCall({
      modelConfig: makeModelConfig(),
      callModel: mockCallModel,
      deepCheckBudget: new DeepCheckBudget(budgetLimit),
    });
  }

  it("returns parsed routine verdict for valid model response", async () => {
    const validResponse = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "yes",
      confidence: 0.95,
      reason: "All good",
      severity: "low",
    });
    mockCallModel.mockResolvedValueOnce({ content: validResponse });

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "routine");
    expect(result).toMatchObject({
      aligned: "yes",
      confidence: 0.95,
      severity: "low",
    });
  });

  it("returns parse failure for malformed routine response", async () => {
    mockCallModel.mockResolvedValueOnce({ content: "garbage" });
    mockCallModel.mockResolvedValueOnce({ content: "more garbage" });

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "routine");
    // Both primary and fallback return garbage -> routineParseFailure
    expect(result).toMatchObject({
      aligned: "unclear",
      confidence: 0.3,
      reason: "Verification response could not be parsed",
    });
  });

  it("falls back to secondary model on primary error", async () => {
    const validResponse = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      aligned: "no",
      confidence: 0.7,
      reason: "Drift detected via fallback",
      severity: "high",
    });
    mockCallModel.mockRejectedValueOnce(new Error("primary down"));
    mockCallModel.mockResolvedValueOnce({ content: validResponse });

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "routine");
    expect(result).toMatchObject({
      aligned: "no",
      confidence: 0.7,
    });
    // Verify fallback model was called
    expect(mockCallModel).toHaveBeenCalledTimes(2);
    expect(mockCallModel.mock.calls[1][0]).toBe("grok/fallback");
  });

  it("returns safe default when both primary and fallback fail", async () => {
    mockCallModel.mockRejectedValueOnce(new Error("primary down"));
    mockCallModel.mockRejectedValueOnce(new Error("fallback down"));

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "routine");
    expect(result).toMatchObject({
      aligned: "unclear",
      confidence: 0.3,
      severity: "medium",
    });
  });

  it("returns deep verdict with LCM discount when lcm unavailable", async () => {
    const validResponse = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "proceed",
      confidence: 0.8,
      reason: "OK trajectory",
      suggestedCorrection: null,
    });
    mockCallModel.mockResolvedValueOnce({ content: validResponse });

    const input = makePromptInput({
      lcmContext: { available: false, reasoningTraces: [], correctionHistory: [] },
    });
    const llmCall = makeLlmCall();
    const result = await llmCall(input, "deep");
    // 0.8 * 0.7 = 0.56
    expect((result as DeepVerdict).confidence).toBeCloseTo(0.56);
  });

  it("blocks when deep check budget is exhausted", async () => {
    const validResponse = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "proceed",
      confidence: 0.9,
      reason: "Fine",
      suggestedCorrection: null,
    });
    mockCallModel.mockResolvedValue({ content: validResponse });

    const llmCall = makeLlmCall(3);
    const input = makePromptInput();

    // Consume the budget (3 calls)
    await llmCall(input, "deep");
    await llmCall(input, "deep");
    await llmCall(input, "deep");

    // 4th call should be budget-exhausted
    const result = await llmCall(input, "deep");
    expect(result).toMatchObject({
      verdict: "block",
      confidence: 0.35,
    });
    expect((result as DeepVerdict).reason).toContain("budget exhausted");
  });

  it("deep check budget resets after rolling window", async () => {
    const validResponse = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "proceed",
      confidence: 0.9,
      reason: "Fine",
      suggestedCorrection: null,
    });
    mockCallModel.mockResolvedValue({ content: validResponse });

    const llmCall = makeLlmCall(1);
    const input = makePromptInput();

    // Use up the budget
    await llmCall(input, "deep");

    // Advance time past 1 hour
    const realNow = Date.now;
    Date.now = () => realNow() + 3_600_001;
    try {
      const result = await llmCall(input, "deep");
      expect((result as DeepVerdict).verdict).toBe("proceed");
    } finally {
      Date.now = realNow;
    }
  });

  it("returns deep parse failure when both models return garbage", async () => {
    mockCallModel.mockResolvedValueOnce({ content: "{bad" });
    mockCallModel.mockResolvedValueOnce({ content: "also bad" });

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "deep");
    expect(result).toMatchObject({
      verdict: "block",
      confidence: 0.2,
    });
  });

  it("deep fallback chain works: primary error then fallback succeeds", async () => {
    const validResponse = JSON.stringify({
      schemaVersion: VERIFIER_SCHEMA_VERSION,
      verdict: "modify",
      confidence: 0.6,
      reason: "Course correction needed",
      suggestedCorrection: "Try approach B",
    });
    mockCallModel.mockRejectedValueOnce(new Error("deep model down"));
    mockCallModel.mockResolvedValueOnce({ content: validResponse });

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "deep");
    expect(result).toMatchObject({
      verdict: "modify",
      suggestedCorrection: "Try approach B",
    });
    expect(mockCallModel).toHaveBeenCalledTimes(2);
  });

  it("deep fallback chain: both fail returns safe default", async () => {
    mockCallModel.mockRejectedValueOnce(new Error("deep model down"));
    mockCallModel.mockRejectedValueOnce(new Error("fallback down"));

    const llmCall = makeLlmCall();
    const result = await llmCall(makePromptInput(), "deep");
    expect(result).toMatchObject({
      verdict: "block",
      confidence: 0.2,
      suggestedCorrection: null,
    });
  });
});
