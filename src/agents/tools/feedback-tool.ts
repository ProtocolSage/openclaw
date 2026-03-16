import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { emitUserExplicitSignal } from "../../feedback/signals.js";
import type { FeedbackStore } from "../../feedback/store.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const FEEDBACK_ACTIONS = [
  "signal",
  "history",
  "corrections",
  "approve_correction",
  "reject_correction",
  "stats",
] as const;

const FeedbackToolSchema = Type.Object({
  action: stringEnum(FEEDBACK_ACTIONS),
  id: Type.Optional(Type.String()),
  signal: Type.Optional(Type.String()),
  context: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  since: Type.Optional(Type.Number({ minimum: 0 })),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
});

function resolveFeedbackMemoryDir(agentDir: string): string {
  return path.resolve(agentDir, "..", "..", "..", "memory");
}

function buildFeedbackMemoryFile(params: {
  correctionId: string;
  ruleText: string;
  sourceText: string;
}): string {
  return [
    "---",
    `name: feedback_${params.correctionId}`,
    "description: Approved feedback correction",
    "type: feedback",
    "---",
    "",
    params.ruleText,
    "",
    `Source: ${params.sourceText}`,
    "",
  ].join("\n");
}

export function createFeedbackTool(opts: {
  feedbackStore: FeedbackStore;
  agentId: string;
  sessionKey: string;
  agentDir: string;
}): AnyAgentTool {
  return {
    label: "Feedback",
    name: "feedback",
    description:
      "Record explicit feedback, inspect recent feedback signals, review proposed corrections, and approve or reject corrections into durable memory.",
    parameters: FeedbackToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        if (action === "signal") {
          const signal = readStringParam(params, "signal", { required: true });
          const context = readStringParam(params, "context", { required: true });
          if (signal !== "positive" && signal !== "negative") {
            return jsonResult({ status: "error", error: `Invalid signal: ${signal}` });
          }
          emitUserExplicitSignal({
            feedbackStore: opts.feedbackStore,
            agentId: opts.agentId,
            sessionKey: opts.sessionKey,
            signal,
            context,
          });
          return jsonResult({ status: "ok", action, signal, context });
        }

        if (action === "history") {
          const signals = opts.feedbackStore.listSignals({
            agentId: opts.agentId,
            sessionKey: readStringParam(params, "context") ? undefined : opts.sessionKey,
            since: readNumberParam(params, "since", { integer: true }),
            limit: readNumberParam(params, "limit", { integer: true }) ?? 20,
          });
          return jsonResult({ status: "ok", action, count: signals.length, signals });
        }

        if (action === "corrections") {
          const status = readStringParam(params, "status");
          const corrections =
            status === "proposed" || status === "approved" || status === "rejected"
              ? opts.feedbackStore.listCorrections(status)
              : opts.feedbackStore.listCorrections();
          return jsonResult({ status: "ok", action, count: corrections.length, corrections });
        }

        if (action === "approve_correction") {
          const id = readStringParam(params, "id", { required: true });
          const correction = opts.feedbackStore.getCorrection(id);
          if (!correction) {
            return jsonResult({ status: "error", error: `Correction not found: ${id}` });
          }
          if (correction.status !== "proposed") {
            return jsonResult({
              status: "error",
              error: `Correction ${id} is already ${correction.status}`,
            });
          }
          const memoryDir = resolveFeedbackMemoryDir(opts.agentDir);
          await fs.mkdir(memoryDir, { recursive: true });
          const memoryPath = path.join(memoryDir, `feedback_${correction.id}.md`);
          await fs.writeFile(
            memoryPath,
            buildFeedbackMemoryFile({
              correctionId: correction.id,
              ruleText: correction.ruleText,
              sourceText: correction.sourceText,
            }),
            "utf-8",
          );
          opts.feedbackStore.updateCorrectionStatus(correction.id, "approved");
          return jsonResult({
            status: "ok",
            action,
            correction: opts.feedbackStore.getCorrection(correction.id),
            memoryPath,
          });
        }

        if (action === "reject_correction") {
          const id = readStringParam(params, "id", { required: true });
          const correction = opts.feedbackStore.getCorrection(id);
          if (!correction) {
            return jsonResult({ status: "error", error: `Correction not found: ${id}` });
          }
          if (correction.status !== "proposed") {
            return jsonResult({
              status: "error",
              error: `Correction ${id} is already ${correction.status}`,
            });
          }
          opts.feedbackStore.updateCorrectionStatus(correction.id, "rejected");
          return jsonResult({
            status: "ok",
            action,
            correction: opts.feedbackStore.getCorrection(correction.id),
          });
        }

        if (action === "stats") {
          const stats = opts.feedbackStore.stats(
            opts.agentId,
            readNumberParam(params, "since", { integer: true }),
          );
          return jsonResult({ status: "ok", action, stats });
        }

        return jsonResult({ status: "error", error: `Unknown action: ${action}` });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
