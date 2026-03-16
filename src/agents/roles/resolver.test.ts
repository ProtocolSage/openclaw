import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { BUILTIN_AGENT_ROLES } from "./presets.js";
import { listResolvedAgentRoles, resolveAgentRoleConfig } from "./resolver.js";

describe("agent role resolver", () => {
  it("exposes the built-in specialization roles", () => {
    const resolved = listResolvedAgentRoles();

    expect(resolved.map((role) => role.roleId)).toEqual(
      BUILTIN_AGENT_ROLES.map((role) => role.roleId),
    );
    expect(resolveAgentRoleConfig("researcher")).toMatchObject({
      roleId: "researcher",
      source: "builtin",
    });
    expect(resolveAgentRoleConfig("coordinator")?.toolPolicy?.deny).toContain("read");
  });

  it("normalizes role ids during lookup", () => {
    expect(resolveAgentRoleConfig(" Reviewer ")).toMatchObject({
      roleId: "reviewer",
      source: "builtin",
    });
  });

  it("lets config-defined roles override built-ins with the same roleId", () => {
    const cfg: OpenClawConfig = {
      agents: {
        roles: [
          {
            roleId: "researcher",
            persona: "Custom researcher persona",
            defaultModel: "openai/gpt-5.2",
            toolPolicy: {
              deny: ["exec"],
            },
          },
        ],
      },
    };

    expect(resolveAgentRoleConfig("researcher", cfg)).toEqual({
      roleId: "researcher",
      persona: "Custom researcher persona",
      defaultModel: "openai/gpt-5.2",
      toolPolicy: {
        deny: ["exec"],
      },
      source: "config",
    });
  });

  it("includes config-defined roles that do not match a built-in", () => {
    const cfg: OpenClawConfig = {
      agents: {
        roles: [
          {
            roleId: "triager",
            persona: "Classify work before delegation.",
            toolPolicy: {
              deny: ["exec", "apply_patch"],
            },
          },
        ],
      },
    };

    const resolved = listResolvedAgentRoles(cfg);
    expect(resolved.map((role) => role.roleId)).toContain("triager");
    expect(resolveAgentRoleConfig("triager", cfg)).toMatchObject({
      roleId: "triager",
      source: "config",
    });
  });
});
