import path from "node:path";
import { Type } from "@sinclair/typebox";
import { EnvironmentWatcher } from "../../initiative/watcher.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const WATCH_ACTIONS = ["add_file", "add_http", "list", "remove"] as const;

const WatchToolSchema = Type.Object(
  {
    action: stringEnum(WATCH_ACTIONS),
    path: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
    id: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

function isPathInsideWorkspace(candidate: string, workspaceDir: string): boolean {
  const resolvedWorkspace = path.resolve(workspaceDir);
  const resolvedCandidate = path.resolve(resolvedWorkspace, candidate);
  return (
    resolvedCandidate === resolvedWorkspace ||
    resolvedCandidate.startsWith(`${resolvedWorkspace}${path.sep}`)
  );
}

function validateHttpsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("HTTP watch URL must use https://");
  }
  const host = parsed.hostname.trim().toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    throw new Error("HTTP watch URL cannot target a local address");
  }
  return parsed.toString();
}

export function createWatchTool(opts: {
  watcher: EnvironmentWatcher;
  workspaceDir: string;
}): AnyAgentTool {
  return {
    label: "Watch",
    name: "watch",
    description:
      "Manage workspace file watches and HTTPS endpoint watches. File watches are restricted to the current workspace.",
    parameters: WatchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        if (action === "add_file") {
          const filePath = readStringParam(params, "path", { required: true });
          if (!isPathInsideWorkspace(filePath, opts.workspaceDir)) {
            return jsonResult({
              status: "error",
              error: `File watch path must stay within workspace: ${opts.workspaceDir}`,
            });
          }
          const watch = opts.watcher.addFileWatch(path.resolve(opts.workspaceDir, filePath));
          return jsonResult({ status: "ok", action, watch });
        }

        if (action === "add_http") {
          const url = validateHttpsUrl(readStringParam(params, "url", { required: true }));
          const watch = opts.watcher.addHttpWatch(url);
          return jsonResult({ status: "ok", action, watch });
        }

        if (action === "list") {
          const watches = opts.watcher.list();
          return jsonResult({ status: "ok", action, count: watches.length, watches });
        }

        if (action === "remove") {
          const id = readStringParam(params, "id", { required: true });
          return jsonResult({ status: "ok", action, removed: opts.watcher.remove(id) });
        }

        return jsonResult({ status: "error", error: `Unknown action: ${action}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ status: "error", error: message });
      }
    },
  };
}
