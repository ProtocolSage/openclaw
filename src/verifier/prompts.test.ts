import { describe, it, expect } from "vitest";
import { truncateToolInput, buildRoutinePrompt, buildDeepPrompt } from "./prompts.js";
import { VERIFIER_SCHEMA_VERSION } from "./types.js";
import type { VerifierPromptInput } from "./types.js";

// ── Fixtures ──

function makeBaseInput(overrides?: Partial<VerifierPromptInput>): VerifierPromptInput {
  return {
    goal: {
      id: "goal-1",
      title: "Deploy new auth service",
      status: "in_progress",
      priority: "high",
    },
    recentTasks: [
      { title: "Write auth middleware", status: "done", lastUpdatedAt: Date.now() - 60_000 },
      { title: "Add rate limiter", status: "in_progress", lastUpdatedAt: Date.now() },
    ],
    auditWindow: [
      { toolName: "file_write", outcome: "success", at: Date.now() - 30_000 },
      { toolName: "shell_exec", outcome: "error", at: Date.now() - 10_000 },
    ],
    recentFeedback: [{ type: "approval", payloadSummary: "User approved auth approach" }],
    ...overrides,
  };
}

// ── truncateToolInput ──

describe("truncateToolInput", () => {
  it("passes through strings under the limit", () => {
    expect(truncateToolInput("short", 10)).toBe("short");
  });

  it("passes through strings exactly at the limit", () => {
    expect(truncateToolInput("12345", 5)).toBe("12345");
  });

  it("truncates strings over the limit with ellipsis", () => {
    const result = truncateToolInput("abcdefghij", 5);
    expect(result).toBe("abcd\u2026");
    expect(result.length).toBe(5);
  });

  it("handles single-char limit", () => {
    expect(truncateToolInput("abc", 1)).toBe("\u2026");
  });

  it("handles empty string", () => {
    expect(truncateToolInput("", 10)).toBe("");
  });
});

// ── buildRoutinePrompt ──

describe("buildRoutinePrompt", () => {
  it("returns array with system and user messages", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("system message mentions schemaVersion", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages[0].content).toContain(`${VERIFIER_SCHEMA_VERSION}`);
  });

  it("system message describes the RoutineVerdict schema fields", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    const sys = messages[0].content;
    expect(sys).toContain('"aligned"');
    expect(sys).toContain('"confidence"');
    expect(sys).toContain('"reason"');
    expect(sys).toContain('"severity"');
    expect(sys).toContain('"schemaVersion"');
  });

  it("user message includes goal title", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages[1].content).toContain("Deploy new auth service");
  });

  it("user message includes recent tasks", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages[1].content).toContain("Write auth middleware");
    expect(messages[1].content).toContain("Add rate limiter");
  });

  it("user message includes audit window entries", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages[1].content).toContain("file_write");
    expect(messages[1].content).toContain("shell_exec");
  });

  it("user message includes feedback signals", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages[1].content).toContain("User approved auth approach");
  });

  it("includes current action when present", () => {
    const input = makeBaseInput({
      currentAction: { toolName: "shell_exec", toolInputSummary: "rm -rf /tmp/build" },
    });
    const messages = buildRoutinePrompt(input);
    expect(messages[1].content).toContain("shell_exec");
    expect(messages[1].content).toContain("rm -rf /tmp/build");
  });

  it("handles empty tasks and audit window", () => {
    const input = makeBaseInput({ recentTasks: [], auditWindow: [], recentFeedback: [] });
    const messages = buildRoutinePrompt(input);
    expect(messages[1].content).toContain("Recent tasks: none");
    expect(messages[1].content).toContain("Audit window: empty");
    expect(messages[1].content).toContain("Recent feedback: none");
  });

  it("includes goal priority when set", () => {
    const messages = buildRoutinePrompt(makeBaseInput());
    expect(messages[1].content).toContain("Priority: high");
  });
});

// ── buildDeepPrompt ──

describe("buildDeepPrompt", () => {
  it("returns array with system and user messages", () => {
    const messages = buildDeepPrompt(makeBaseInput());
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("system message mentions schemaVersion", () => {
    const messages = buildDeepPrompt(makeBaseInput());
    expect(messages[0].content).toContain(`${VERIFIER_SCHEMA_VERSION}`);
  });

  it("system message describes the DeepVerdict schema fields", () => {
    const messages = buildDeepPrompt(makeBaseInput());
    const sys = messages[0].content;
    expect(sys).toContain('"verdict"');
    expect(sys).toContain('"confidence"');
    expect(sys).toContain('"reason"');
    expect(sys).toContain('"suggestedCorrection"');
    expect(sys).toContain('"schemaVersion"');
  });

  it("user message includes goal title", () => {
    const messages = buildDeepPrompt(makeBaseInput());
    expect(messages[1].content).toContain("Deploy new auth service");
  });

  it("includes LCM context when provided", () => {
    const input = makeBaseInput({
      lcmContext: {
        available: true,
        reasoningTraces: ["Step 1: analyzed auth requirements", "Step 2: chose JWT strategy"],
        correctionHistory: ["Corrected: switched from session-based to token-based"],
      },
    });
    const messages = buildDeepPrompt(input);
    const user = messages[1].content;
    expect(user).toContain("analyzed auth requirements");
    expect(user).toContain("chose JWT strategy");
    expect(user).toContain("switched from session-based to token-based");
    expect(user).toContain("Reasoning traces");
    expect(user).toContain("Correction history");
  });

  it("shows LCM unavailable when lcmContext is missing", () => {
    const messages = buildDeepPrompt(makeBaseInput());
    expect(messages[1].content).toContain("LCM context: unavailable");
  });

  it("shows LCM unavailable when lcmContext.available is false", () => {
    const input = makeBaseInput({
      lcmContext: {
        available: false,
        reasoningTraces: ["trace"],
        correctionHistory: [],
      },
    });
    const messages = buildDeepPrompt(input);
    expect(messages[1].content).toContain("LCM context: unavailable");
  });

  it("includes correction history in LCM context", () => {
    const input = makeBaseInput({
      lcmContext: {
        available: true,
        reasoningTraces: [],
        correctionHistory: ["Reverted file deletion", "Added missing validation"],
      },
    });
    const messages = buildDeepPrompt(input);
    expect(messages[1].content).toContain("Reverted file deletion");
    expect(messages[1].content).toContain("Added missing validation");
  });
});
