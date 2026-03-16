import type { AgentRoleConfig } from "../../config/types.agents.js";

export type ResolvedAgentRoleConfig = {
  roleId: string;
  persona?: string;
  toolPolicy?: AgentRoleConfig["toolPolicy"];
  defaultModel?: string;
  source: "builtin" | "config";
};

export function normalizeAgentRoleId(roleId: string): string {
  return roleId.trim().toLowerCase();
}
