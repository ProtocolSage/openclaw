import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoalManager } from "../../goals/manager.js";
import { GoalStore } from "../../goals/store.js";
import { createGoalsTool } from "./goals-tool.js";

describe("goals tool", () => {
  let store: GoalStore;
  let manager: GoalManager;
  let dbPath: string;

  beforeEach(() => {
    store = new GoalStore();
    dbPath = path.join(
      os.tmpdir(),
      `goals-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    store.open(dbPath);
    manager = new GoalManager(store);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore cleanup errors
    }
  });

  it("creates a goal and returns it in the result payload", async () => {
    const tool = createGoalsTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-create", {
      action: "create",
      title: "Ship Pass 1A",
      description: "Finish the goals core store",
      priority: 5,
      tags: ["goals", "spec-1a"],
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "create",
      goal: {
        agentId: "agent-1",
        ownerSessionKey: "agent:main:main",
        title: "Ship Pass 1A",
        description: "Finish the goals core store",
        priority: 5,
        tags: ["goals", "spec-1a"],
      },
    });
  });

  it("lists active goals for the current agent", async () => {
    const activeGoal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Active Goal",
      tags: ["tracked"],
    });
    manager.updateGoal(activeGoal.id, { status: "active" });
    manager.createGoal({
      agentId: "agent-2",
      ownerSessionKey: "agent:other:main",
      title: "Other Agent Goal",
    });

    const tool = createGoalsTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-list", { action: "list" });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "list",
      count: 1,
    });
    expect(result.details).toMatchObject({
      goals: [
        expect.objectContaining({
          id: activeGoal.id,
          title: "Active Goal",
        }),
      ],
    });
  });

  it("updates an existing goal", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Update Me",
    });

    const tool = createGoalsTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-update", {
      action: "update",
      id: goal.id,
      description: "Updated description",
      status: "active",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "update",
      goal: {
        id: goal.id,
        description: "Updated description",
        status: "active",
      },
    });
  });

  it("closes an active goal", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Close Me",
    });
    manager.updateGoal(goal.id, { status: "active" });

    const tool = createGoalsTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-close", {
      action: "close",
      id: goal.id,
      status: "complete",
      result: "Finished",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "close",
      goal: {
        id: goal.id,
        status: "complete",
        description: "Finished",
      },
    });
  });

  it("returns JSON error details for invalid input instead of throwing", async () => {
    const tool = createGoalsTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    await expect(
      tool.execute("call-error", {
        action: "create",
      }),
    ).resolves.toMatchObject({
      details: {
        status: "error",
        error: "title required",
      },
    });
  });
});
