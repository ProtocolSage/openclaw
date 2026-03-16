import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentWatcher } from "../../initiative/watcher.js";
import { createWatchTool } from "./watch-tool.js";

describe("watch tool", () => {
  it("rejects paths outside the workspace", async () => {
    const tool = createWatchTool({
      watcher: new EnvironmentWatcher(path.join(os.tmpdir(), `watch-${Date.now()}-1.db`)),
      workspaceDir: "/home/user/project",
    });

    const result = await tool.execute("call-1", {
      action: "add_file",
      path: "/etc/passwd",
    });

    expect(result.details).toMatchObject({ status: "error" });
  });

  it("rejects file URLs", async () => {
    const tool = createWatchTool({
      watcher: new EnvironmentWatcher(path.join(os.tmpdir(), `watch-${Date.now()}-2.db`)),
      workspaceDir: "/home/user/project",
    });

    const result = await tool.execute("call-2", {
      action: "add_http",
      url: "file:///etc/passwd",
    });

    expect(result.details).toMatchObject({ status: "error" });
  });

  it("returns JSON errors when watch storage fails", async () => {
    const watcher = {
      addFileWatch: vi.fn(() => {
        throw new Error("db down");
      }),
      addHttpWatch: vi.fn(),
      list: vi.fn(),
      remove: vi.fn(),
    };
    const tool = createWatchTool({
      watcher: watcher as unknown as EnvironmentWatcher,
      workspaceDir: "/home/user/project",
    });

    const result = await tool.execute("call-3", {
      action: "add_file",
      path: "src/index.ts",
    });

    expect(result.details).toEqual({
      status: "error",
      error: "db down",
    });
  });
});
