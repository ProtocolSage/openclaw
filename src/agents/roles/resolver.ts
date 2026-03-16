import type { OpenClawConfig } from "../../config/config.js";
import type { AgentRoleConfig } from "../../config/types.agents.js";
import { BUILTIN_AGENT_ROLES } from "./presets.js";
import { normalizeAgentRoleId, type ResolvedAgentRoleConfig } from "./types.js";

function toResolvedRole(
  role: AgentRoleConfig,
  source: ResolvedAgentRoleConfig["source"],
): ResolvedAgentRoleConfig | undefined {
  const roleId = normalizeAgentRoleId(role.roleId);
  if (!roleId) {
    return undefined;
  }
  return {
    roleId,
    persona: role.persona?.trim() || undefined,
    toolPolicy: role.toolPolicy,
    defaultModel: role.defaultModel?.trim() || undefined,
    source,
  };
}

export function listResolvedAgentRoles(cfg?: OpenClawConfig): ResolvedAgentRoleConfig[] {
  const merged = new Map<string, ResolvedAgentRoleConfig>();

  for (const role of BUILTIN_AGENT_ROLES) {
    const resolved = toResolvedRole(role, "builtin");
    if (resolved) {
      merged.set(resolved.roleId, resolved);
    }
  }

  for (const role of cfg?.agents?.roles ?? []) {
    const resolved = toResolvedRole(role, "config");
    if (resolved) {
      merged.set(resolved.roleId, resolved);
    }
  }

  return [...merged.values()];
}

export function resolveAgentRoleConfig(
  roleId: string,
  cfg?: OpenClawConfig,
): ResolvedAgentRoleConfig | undefined {
  const normalized = normalizeAgentRoleId(roleId);
  if (!normalized) {
    return undefined;
  }
  return listResolvedAgentRoles(cfg).find((role) => role.roleId === normalized);
}
