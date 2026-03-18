import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeedbackTool } from "../agents/tools/feedback-tool.js";
import {
  createProposedCorrection,
  detectCorrection,
  deriveCorrectionRuleText,
  extractProposedRule,
} from "./correction.js";
import {
  emitGoalAbandonedSignal,
  emitTaskCompleteSignal,
  emitTaskFailedSignal,
  emitUserCorrection,
  emitUserExplicitSignal,
} from "./signals.js";
import { FeedbackStore } from "./store.js";

describe("correction detection", () => {
  it("detects correction language", () => {
    expect(detectCorrection("no, actually that's wrong")).toBe(true);
    expect(detectCorrection("Actually, do it the other way")).toBe(true);
    expect(detectCorrection("instead, use the new API")).toBe(true);
    expect(detectCorrection("don't do that")).toBe(true);
    expect(detectCorrection("sounds good, thanks")).toBe(false);
    expect(detectCorrection("yes, perfect")).toBe(false);
    expect(detectCorrection("")).toBe(false);
  });

  it("deriveCorrectionRuleText strips prefix and returns rule text", () => {
    expect(deriveCorrectionRuleText("No, check the repo first.")).toBe("check the repo first.");
    expect(deriveCorrectionRuleText("Actually, use the new API")).toBe("use the new API");
  });

  it("deriveCorrectionRuleText returns null for empty-after-strip", () => {
    expect(deriveCorrectionRuleText("no")).toBeNull();
    expect(deriveCorrectionRuleText("no,")).toBeNull();
    expect(deriveCorrectionRuleText("  ")).toBeNull();
  });

  it("returns null when proposed-rule extraction throws", async () => {
    await expect(
      extractProposedRule({
        correctionText: "No, do it this way.",
        originalAssistantText: "I would do X.",
        llmCall: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toBeNull();
  });

  it("keeps signal emitters non-throwing when the store fails", () => {
    const failingStore = {
      appendSignal: vi.fn(() => {
        throw new Error("db down");
      }),
    } as unknown as FeedbackStore;
    expect(() =>
      emitTaskCompleteSignal({
        feedbackStore: failingStore,
        agentId: "main",
        sessionKey: "agent:main:main",
        taskId: "task-1",
        goalId: "goal-1",
        quality: "good",
      }),
    ).not.toThrow();
    expect(() =>
      emitTaskFailedSignal({
        feedbackStore: failingStore,
        agentId: "main",
        sessionKey: "agent:main:main",
        taskId: "task-1",
        goalId: "goal-1",
        reason: "failed",
        retried: false,
      }),
    ).not.toThrow();
    expect(() =>
      emitGoalAbandonedSignal({
        feedbackStore: failingStore,
        agentId: "main",
        sessionKey: "agent:main:main",
        goalId: "goal-1",
      }),
    ).not.toThrow();
    expect(() =>
      emitUserExplicitSignal({
        feedbackStore: failingStore,
        agentId: "main",
        sessionKey: "agent:main:main",
        signal: "negative",
        context: "bad response",
      }),
    ).not.toThrow();
    expect(() =>
      emitUserCorrection({
        feedbackStore: failingStore,
        agentId: "main",
        sessionKey: "agent:main:main",
        correctionText: "no, that is wrong",
        originalAssistantText: "wrong answer",
      }),
    ).not.toThrow();
  });
});

describe("feedback tool", () => {
  const tempRoot = path.join(
    os.tmpdir(),
    `feedback-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const agentDir = path.join(tempRoot, ".openclaw", "agents", "main", "agent");
  const dbPath = path.join(agentDir, "feedback.db");

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function createTool() {
    await fs.mkdir(agentDir, { recursive: true });
    const store = new FeedbackStore();
    store.open(dbPath);
    const tool = createFeedbackTool({
      feedbackStore: store,
      agentId: "main",
      sessionKey: "agent:main:main",
      agentDir,
    });
    return { store, tool };
  }

  it("writes the approved correction to memory with frontmatter", async () => {
    const { store, tool } = await createTool();
    store.appendSignal({
      id: "feedback-1",
      type: "user_correction",
      agentId: "main",
      sessionKey: "agent:main:main",
      at: Date.now(),
      payload: "{}",
    });
    const correction = createProposedCorrection({
      signalId: "feedback-1",
      ruleText: deriveCorrectionRuleText("No, check the code first.") ?? "Check the code first.",
      sourceText: "No, check the code first.",
    });
    store.insertCorrection(correction);

    const result = await tool.execute?.("call-1", {
      action: "approve_correction",
      id: correction.id,
    });
    const details = result?.details as Record<string, unknown>;
    const memoryPath = details.memoryPath as string;
    const raw = await fs.readFile(memoryPath, "utf-8");

    expect(details.status).toBe("ok");
    expect(raw).toContain(`name: feedback_${correction.id}`);
    expect(raw).toContain("description: Approved feedback correction");
    expect(raw).toContain("type: feedback");
    store.close();
  });

  it("returns an error when approving an already-approved correction", async () => {
    const { store, tool } = await createTool();
    store.appendSignal({
      id: "feedback-1",
      type: "user_correction",
      agentId: "main",
      sessionKey: "agent:main:main",
      at: Date.now(),
      payload: "{}",
    });
    store.insertCorrection({
      id: "correction-1",
      signalId: "feedback-1",
      ruleText: "Check the repo first.",
      sourceText: "No, check the repo first.",
      status: "approved",
      createdAt: Date.now(),
      reviewedAt: Date.now(),
    });

    const result = await tool.execute?.("call-1", {
      action: "approve_correction",
      id: "correction-1",
    });
    const details = result?.details as Record<string, unknown> | undefined;
    expect(details?.status).toBe("error");
    store.close();
  });

  it("returns an error when rejecting an already-rejected correction", async () => {
    const { store, tool } = await createTool();
    store.appendSignal({
      id: "feedback-1",
      type: "user_correction",
      agentId: "main",
      sessionKey: "agent:main:main",
      at: Date.now(),
      payload: "{}",
    });
    store.insertCorrection({
      id: "correction-rej",
      signalId: "feedback-1",
      ruleText: "Check the repo first.",
      sourceText: "No, check the repo first.",
      status: "rejected",
      createdAt: Date.now(),
      reviewedAt: Date.now(),
    });

    const result = await tool.execute?.("call-1", {
      action: "reject_correction",
      id: "correction-rej",
    });
    const details = result?.details as Record<string, unknown> | undefined;
    expect(details?.status).toBe("error");
    const errorMsg = typeof details?.error === "string" ? details.error : "";
    expect(errorMsg).toContain("already rejected");
    store.close();
  });

  it("records explicit feedback via the tool", async () => {
    const { store, tool } = await createTool();
    await tool.execute?.("call-1", {
      action: "signal",
      signal: "negative",
      context: "bad response",
    });
    const signals = store.listSignals({ type: "user_explicit" });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.payload).toContain("bad response");
    store.close();
  });
});
