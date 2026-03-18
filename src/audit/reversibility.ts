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

// Conservative reversibility check for the trajectory verifier.
// Unknown tools default to irreversible — only tools in the allowlist pass through without verification.
const KNOWN_REVERSIBLE: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "goals",
  "tasks",
  "audit",
  "feedback",
  "sessions_list",
  "sessions_history",
  "session_status",
  "agents_list",
  "web_search",
  "web_fetch",
  "watch",
  "image",
  "pdf",
]);

export function isIrreversibleForVerifier(toolName: string): boolean {
  return (
    APPROVAL_REQUIRED.has(toolName) || PREVIEW_ONLY.has(toolName) || !KNOWN_REVERSIBLE.has(toolName)
  );
}
