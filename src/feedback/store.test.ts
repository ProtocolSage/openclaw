import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeedbackStore } from "./store.js";
import type { FeedbackSignal, ProposedCorrection } from "./types.js";

describe("FeedbackStore", () => {
  let store: FeedbackStore;
  let dbPath: string;

  beforeEach(() => {
    store = new FeedbackStore();
    dbPath = path.join(
      os.tmpdir(),
      `feedback-store-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    store.open(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  function createSignal(id: string, patch: Partial<FeedbackSignal> = {}): FeedbackSignal {
    return {
      id,
      type: "user_explicit",
      agentId: "main",
      sessionKey: "agent:main:main",
      at: 1_700_000_000_000,
      payload: '{"signal":"negative"}',
      ...patch,
    };
  }

  function createCorrection(
    id: string,
    patch: Partial<ProposedCorrection> = {},
  ): ProposedCorrection {
    return {
      id,
      signalId: "feedback-1",
      ruleText: "Verify before answering.",
      sourceText: "No, actually check the repo first.",
      status: "proposed",
      createdAt: 1_700_000_000_000,
      reviewedAt: null,
      ...patch,
    };
  }

  it("appends and filters signals", () => {
    store.appendSignal(createSignal("s1", { type: "task_outcome", at: 1 }));
    store.appendSignal(createSignal("s2", { type: "user_explicit", at: 2 }));
    const signals = store.listSignals({ type: "user_explicit" });
    expect(signals.map((signal) => signal.id)).toEqual(["s2"]);
  });

  it("round-trips corrections and supports status transitions", () => {
    store.appendSignal(createSignal("feedback-1"));
    store.insertCorrection(createCorrection("c1"));
    store.updateCorrectionStatus("c1", "approved");
    const correction = store.getCorrection("c1");
    expect(correction?.status).toBe("approved");
    expect(correction?.reviewedAt).not.toBeNull();
  });

  it("rejects non-proposed correction transitions", () => {
    store.appendSignal(createSignal("feedback-1"));
    store.insertCorrection(createCorrection("c1", { status: "approved", reviewedAt: 10 }));
    expect(() => store.updateCorrectionStatus("c1", "rejected")).toThrow(/already approved/);
  });

  it("computes stats by type", () => {
    store.appendSignal(createSignal("s1", { type: "task_outcome", at: 1 }));
    store.appendSignal(createSignal("s2", { type: "task_outcome", at: 2 }));
    store.appendSignal(createSignal("s3", { type: "user_explicit", at: 3 }));
    const stats = store.stats("main");
    expect(stats.total).toBe(3);
    expect(stats.byType).toEqual({
      task_outcome: 2,
      user_explicit: 1,
    });
  });

  it("filters signals by since and limit", () => {
    store.appendSignal(createSignal("s1", { at: 100 }));
    store.appendSignal(createSignal("s2", { at: 200 }));
    store.appendSignal(createSignal("s3", { at: 300 }));
    const sinceFiltered = store.listSignals({ since: 200 });
    expect(sinceFiltered.map((s) => s.id)).toEqual(["s3", "s2"]);
    const limited = store.listSignals({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.id).toBe("s3");
  });

  it("preserves all appended signals without silent overwrite", () => {
    store.appendSignal(createSignal("s1", { at: 1, payload: '{"v":1}' }));
    store.appendSignal(createSignal("s2", { at: 2, payload: '{"v":2}' }));
    const all = store.listSignals({});
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === "s1")?.payload).toBe('{"v":1}');
    expect(all.find((s) => s.id === "s2")?.payload).toBe('{"v":2}');
  });
});
