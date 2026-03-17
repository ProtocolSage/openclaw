import { describe, it, expect, vi, beforeEach } from "vitest";
import { createVerifierCallModel } from "./model-transport.js";

// Mock streamSimple and resolveModel at module level
vi.mock("@mariozechner/pi-ai", () => ({
  streamSimple: vi.fn(),
}));

vi.mock("../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: vi.fn(),
}));

import { streamSimple } from "@mariozechner/pi-ai";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";

const mockStreamSimple = vi.mocked(streamSimple);
const mockResolveModel = vi.mocked(resolveModel);

describe("createVerifierCallModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses modelRef as provider/modelId and calls streamSimple", async () => {
    const fakeModel = { provider: "openai-codex", id: "gpt-5.4", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: {} as never,
      modelRegistry: {} as never,
    });

    const chunks = ["Hello", " ", "world"];
    mockStreamSimple.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) {
          yield { type: "text", text: chunk };
        }
      },
    } as never);

    const callModel = createVerifierCallModel({ agentDir: "/tmp/test-agent" });
    const result = await callModel("openai-codex/gpt-5.4", [{ role: "user", content: "test" }]);

    expect(result.content).toBe("Hello world");
    expect(mockResolveModel).toHaveBeenCalledWith(
      "openai-codex",
      "gpt-5.4",
      "/tmp/test-agent",
      undefined,
    );
  });

  it("throws when model cannot be resolved", async () => {
    mockResolveModel.mockReturnValue({
      model: undefined,
      error: "Unknown model",
      authStorage: {} as never,
      modelRegistry: {} as never,
    });

    const callModel = createVerifierCallModel({ agentDir: "/tmp/test-agent" });
    await expect(callModel("bad/model", [{ role: "user", content: "test" }])).rejects.toThrow(
      "Unknown model",
    );
  });

  it("handles modelRef without slash as provider=modelRef, modelId=modelRef", async () => {
    const fakeModel = { provider: "grok", id: "grok", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: {} as never,
      modelRegistry: {} as never,
    });
    mockStreamSimple.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "text", text: "ok" };
      },
    } as never);

    const callModel = createVerifierCallModel({ agentDir: "/tmp/test-agent" });
    await callModel("grok", [{ role: "user", content: "test" }]);

    expect(mockResolveModel).toHaveBeenCalledWith("grok", "grok", "/tmp/test-agent", undefined);
  });

  it("passes config to resolveModel when provided", async () => {
    const cfg = { models: {} } as never;
    const fakeModel = { provider: "xai", id: "grok-4", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: {} as never,
      modelRegistry: {} as never,
    });
    mockStreamSimple.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "text", text: "ok" };
      },
    } as never);

    const callModel = createVerifierCallModel({ agentDir: "/tmp/test", config: cfg });
    await callModel("xai/grok-4", [{ role: "user", content: "test" }]);

    expect(mockResolveModel).toHaveBeenCalledWith("xai", "grok-4", "/tmp/test", cfg);
  });
});
