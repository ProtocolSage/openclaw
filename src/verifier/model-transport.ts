// src/verifier/model-transport.ts
//
// Builds a real callModel function for the verifier using
// the existing model registry and pi-ai streaming infrastructure.

import { streamSimple } from "@mariozechner/pi-ai";
import { getApiKeyForModel, requireApiKey } from "../agents/model-auth.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ModelCallFn } from "./llm-call.js";

const log = createSubsystemLogger("verifier");

export interface CreateCallModelOpts {
  agentDir: string;
  config?: OpenClawConfig;
}

function parseModelRef(modelRef: string): { provider: string; modelId: string } {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx === -1) {
    return { provider: modelRef, modelId: modelRef };
  }
  return {
    provider: modelRef.slice(0, slashIdx),
    modelId: modelRef.slice(slashIdx + 1),
  };
}

function getStreamErrorMessage(event: unknown): string {
  const record = event as Record<string, unknown>;

  if (typeof record.errorMessage === "string") {
    return record.errorMessage;
  }

  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object") {
    const message = (record.error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown stream error";
}

function getStreamText(event: unknown): string | null {
  const record = event as Record<string, unknown>;

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.delta === "string") {
    return record.delta;
  }

  return null;
}

/**
 * Creates a real ModelCallFn that resolves model refs via the pi-ai model
 * registry and collects streamed tokens into a single response string.
 */
export function createVerifierCallModel(opts: CreateCallModelOpts): ModelCallFn {
  return async (modelRef, messages, params) => {
    const { provider, modelId } = parseModelRef(modelRef);

    const { model, error, authStorage } = resolveModel(
      provider,
      modelId,
      opts.agentDir,
      opts.config,
    );
    if (!model) {
      throw new Error(error ?? `Cannot resolve model: ${modelRef}`);
    }

    const apiKeyInfo = await getApiKeyForModel({
      model,
      cfg: opts.config,
      agentDir: opts.agentDir,
    });
    const apiKey = requireApiKey(apiKeyInfo, model.provider);
    authStorage.setRuntimeApiKey(model.provider, apiKey);

    log.debug(`Verifier calling ${modelRef}`);

    const stream = streamSimple(model as never, messages as never, {
      apiKey,
      ...params,
    });

    let content = "";
    for await (const event of stream) {
      const eventType = (event as { type?: string }).type;

      if (eventType === "error") {
        const errorMessage = getStreamErrorMessage(event);
        log.error("Verifier stream error", {
          error: errorMessage,
          modelRef,
        });
        throw new Error(`Stream error: ${errorMessage}`);
      }

      const text = getStreamText(event);
      if (text) {
        content += text;
      }
    }

    if (content === "") {
      log.warn(`Verifier call to ${modelRef} produced empty content`);
    }

    return { content };
  };
}
