import { describe, it, expect, vi, beforeEach } from "vitest";
import { createVerifierCallModel } from "./model-transport.js";

// Mock streamSimple and resolveModel at module level
vi.mock("@mariozechner/pi-ai", () => ({
  streamSimple: vi.fn(),
}));

vi.mock("../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: vi.fn(),
}));

vi.mock("../agents/model-auth.js", () => ({
  getApiKeyForModel: vi.fn(),
  requireApiKey: vi.fn(),
}));

import { streamSimple } from "@mariozechner/pi-ai";
import { getApiKeyForModel, requireApiKey } from "../agents/model-auth.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";

const mockStreamSimple = vi.mocked(streamSimple);
const mockGetApiKeyForModel = vi.mocked(getApiKeyForModel);
const mockRequireApiKey = vi.mocked(requireApiKey);
const mockResolveModel = vi.mocked(resolveModel);

describe("createVerifierCallModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKeyForModel.mockResolvedValue({
      apiKey: "oauth-token",
      mode: "oauth",
      source: "profile:openai-codex:default",
    });
    mockRequireApiKey.mockReturnValue("oauth-token");
  });

  it("parses modelRef as provider/modelId and calls streamSimple with resolved auth", async () => {
    const authStorage = { setRuntimeApiKey: vi.fn() };
    const fakeModel = { provider: "openai-codex", id: "gpt-5.4", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: authStorage as never,
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
    const result = await callModel("openai-codex/gpt-5.4", [{ role: "user", content: "test" }], {
      fastMode: true,
    });

    expect(result.content).toBe("Hello world");
    expect(mockResolveModel).toHaveBeenCalledWith(
      "openai-codex",
      "gpt-5.4",
      "/tmp/test-agent",
      undefined,
    );
    expect(mockGetApiKeyForModel).toHaveBeenCalledWith({
      model: fakeModel,
      cfg: undefined,
      agentDir: "/tmp/test-agent",
    });
    expect(mockRequireApiKey).toHaveBeenCalledWith(
      {
        apiKey: "oauth-token",
        mode: "oauth",
        source: "profile:openai-codex:default",
      },
      "openai-codex",
    );
    expect(authStorage.setRuntimeApiKey).toHaveBeenCalledWith("openai-codex", "oauth-token");
    expect(mockStreamSimple).toHaveBeenCalledWith(fakeModel, [{ role: "user", content: "test" }], {
      apiKey: "oauth-token",
      fastMode: true,
    });
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
    const authStorage = { setRuntimeApiKey: vi.fn() };
    const fakeModel = { provider: "grok", id: "grok", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: authStorage as never,
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
    const authStorage = { setRuntimeApiKey: vi.fn() };
    const cfg = { models: {} } as never;
    const fakeModel = { provider: "xai", id: "grok-4", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: authStorage as never,
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
    expect(mockGetApiKeyForModel).toHaveBeenCalledWith({
      model: fakeModel,
      cfg,
      agentDir: "/tmp/test",
    });
  });

  // Targeted fix tests
  it("throws on stream error event (logs handled by subsystem logger)", async () => {
    const fakeModel = { provider: "openai-codex", id: "gpt-5.4", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: { setRuntimeApiKey: vi.fn() } as never,
      modelRegistry: {} as never,
    });

    const errorMsg = "Cannot read properties of undefined (reading 'map')";
    mockStreamSimple.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "text", text: "partial " };
        yield { type: "error", errorMessage: errorMsg };
      },
    } as never);

    const callModel = createVerifierCallModel({ agentDir: "/tmp/test-agent" });
    await expect(
      callModel("openai-codex/gpt-5.4", [{ role: "user", content: "test" }], {}),
    ).rejects.toThrow(`Stream error: ${errorMsg}`);
  });

  it("warns on empty content (no text events), returns empty", async () => {
    const fakeModel = { provider: "grok", id: "grok", api: "openai" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: { setRuntimeApiKey: vi.fn() } as never,
      modelRegistry: {} as never,
    });

    mockStreamSimple.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        // No text
      },
    } as never);

    const callModel = createVerifierCallModel({ agentDir: "/tmp/test-agent" });
    const result = await callModel("grok", [{ role: "user", content: "test" }], {});

    expect(result.content).toBe("");
  });

  it("ignores non-text/non-error events, appends text only", async () => {
    const fakeModel = { provider: "test", id: "test", api: "test" };
    mockResolveModel.mockReturnValue({
      model: fakeModel as never,
      authStorage: { setRuntimeApiKey: vi.fn() } as never,
      modelRegistry: {} as never,
    });

    mockStreamSimple.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: "text", text: "Hello" };
        yield { type: "metadata", foo: "ignored" };
        yield { type: "text", text: " world" };
      },
    } as never);

    const callModel = createVerifierCallModel({ agentDir: "/tmp" });
    const result = await callModel("test/test", [{ role: "user", content: "test" }], {});

    expect(result.content).toBe("Hello world");
  });
});
