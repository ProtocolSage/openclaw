import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { wrapToolWithDecisionLog } from "./decision-log.js";
import { classifyTool } from "./reversibility.js";
import { AuditStore } from "./store.js";

function createAuditStoreStub() {
  const append = vi.fn();
  return {
    append,
  } as AuditStore & { append: typeof append };
}

describe("wrapToolWithDecisionLog", () => {
  it("logs successful tool calls", async () => {
    const auditStore = createAuditStoreStub();
    const tool: AnyAgentTool = {
      name: "read",
      label: "Read",
      description: "",
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => ({
        content: [],
        details: { ok: true },
      }),
    };

    const wrapped = wrapToolWithDecisionLog(tool, auditStore, {
      agentId: "main",
      sessionKey: "agent:main:main",
      turnId: "turn-1",
    });
    await wrapped.execute?.("call-1", { path: "src/file.ts" });

    const append = auditStore.append;
    expect(append).toHaveBeenCalledTimes(1);
    const entry = append.mock.calls[0]?.[0];
    expect(entry?.outcome).toBe("success");
    expect(entry?.toolName).toBe("read");
  });

  it("redacts known secret patterns in toolInput", async () => {
    const auditStore = createAuditStoreStub();
    const tool: AnyAgentTool = {
      name: "exec",
      label: "Exec",
      description: "",
      parameters: Type.Object({ token: Type.String() }),
      execute: async () => ({
        content: [],
        details: { ok: true },
      }),
    };

    const wrapped = wrapToolWithDecisionLog(tool, auditStore, {
      agentId: "main",
      sessionKey: "agent:main:main",
      turnId: "turn-1",
    });
    await wrapped.execute?.("call-1", { token: "sk-1234567890abcdefghijklmnop" });

    const entry = auditStore.append.mock.calls[0]?.[0];
    expect(entry?.toolInput).not.toContain("sk-1234567890abcdefghijklmnop");
  });

  it("truncates toolOutput to 2048 chars", async () => {
    const auditStore = createAuditStoreStub();
    const tool: AnyAgentTool = {
      name: "read",
      label: "Read",
      description: "",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [],
        details: { text: "x".repeat(3000) },
      }),
    };

    const wrapped = wrapToolWithDecisionLog(tool, auditStore, {
      agentId: "main",
      sessionKey: "agent:main:main",
      turnId: "turn-1",
    });
    await wrapped.execute?.("call-1", {});

    const entry = auditStore.append.mock.calls[0]?.[0];
    expect((entry?.toolOutput?.length ?? 0) <= 2049).toBe(true);
  });

  it("does not block tool execution when append fails", async () => {
    const auditStore = {
      append: vi.fn(() => {
        throw new Error("db unavailable");
      }),
    } as unknown as AuditStore & { append: ReturnType<typeof vi.fn> };
    const tool: AnyAgentTool = {
      name: "read",
      label: "Read",
      description: "",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [],
        details: { ok: true },
      }),
    };
    const wrapped = wrapToolWithDecisionLog(tool, auditStore, {
      agentId: "main",
      sessionKey: "agent:main:main",
      turnId: "turn-1",
    });

    await expect(wrapped.execute?.("call-1", {})).resolves.toEqual({
      content: [],
      details: { ok: true },
    });
  });
});

describe("classifyTool", () => {
  it("classifies tool approval policies", () => {
    expect(classifyTool("exec")).toBe("required");
    expect(classifyTool("read")).toBe("none");
    expect(classifyTool("message")).toBe("preview");
  });
});
