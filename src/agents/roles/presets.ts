import type { AgentRoleConfig } from "../../config/types.agents.js";

export const BUILTIN_AGENT_ROLES: readonly AgentRoleConfig[] = [
  {
    roleId: "researcher",
    persona: "Research thoroughly, cite sources, and avoid making code or filesystem changes.",
    toolPolicy: {
      deny: ["exec", "process", "write", "edit", "apply_patch"],
    },
  },
  {
    roleId: "coder",
    persona: "Implement changes directly, verify them, and keep edits scoped to the task.",
  },
  {
    roleId: "reviewer",
    persona: "Review code critically, prefer evidence, and avoid mutating the workspace.",
    toolPolicy: {
      deny: ["exec", "process", "write", "edit", "apply_patch"],
    },
  },
  {
    roleId: "coordinator",
    persona: "Plan and delegate work, synthesize results, and avoid direct code execution.",
    toolPolicy: {
      deny: ["exec", "process", "read", "write", "edit", "apply_patch"],
    },
  },
] as const;
