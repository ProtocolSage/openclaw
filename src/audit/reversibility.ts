import type { ApprovalPolicy } from "./types.js";

const APPROVAL_REQUIRED: ReadonlySet<string> = new Set(["exec", "process"]);
const PREVIEW_ONLY: ReadonlySet<string> = new Set(["message", "sessions_spawn", "cron"]);

export function classifyTool(toolName: string): ApprovalPolicy {
  if (APPROVAL_REQUIRED.has(toolName)) {
    return "required";
  }
  if (PREVIEW_ONLY.has(toolName)) {
    return "preview";
  }
  return "none";
}

export function isReversible(toolName: string): boolean {
  return !APPROVAL_REQUIRED.has(toolName) && !PREVIEW_ONLY.has(toolName);
}
