import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalManager } from "../../goals/manager.js";
import { GoalStore } from "../../goals/store.js";
import { createTasksTool } from "./tasks-tool.js";

describe("tasks tool", () => {
  let store: GoalStore;
  let manager: GoalManager;
  let dbPath: string;

  beforeEach(() => {
    store = new GoalStore();
    dbPath = path.join(
      os.tmpdir(),
      `tasks-tool-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

  it("creates a task under an existing goal", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });

    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-create", {
      action: "create",
      goalId: goal.id,
      title: "Write tests",
      description: "Add tool tests",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "create",
      task: {
        goalId: goal.id,
        agentId: "agent-1",
        title: "Write tests",
        description: "Add tool tests",
        status: "pending",
      },
    });
  });

  it("lists ready tasks by default", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });
    const dep = manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Dependency",
    });
    manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Blocked",
      dependsOn: [dep.id],
    });

    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-list", { action: "list" });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "list",
      filter: "ready",
      count: 1,
    });
    expect(result.details).toMatchObject({
      tasks: [
        expect.objectContaining({
          id: dep.id,
          title: "Dependency",
        }),
      ],
    });
  });

  it("updates an existing task", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });
    const task = manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Task",
    });

    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-update", {
      action: "update",
      id: task.id,
      description: "Updated task description",
      status: "in_progress",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "update",
      task: {
        id: task.id,
        description: "Updated task description",
        status: "in_progress",
      },
    });
  });

  it("completes an in-progress task", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });
    const task = manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Task",
    });
    manager.updateTask(task.id, { status: "in_progress" });

    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-complete", {
      action: "complete",
      id: task.id,
      result: "Done",
      outcome: "success",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "complete",
      task: {
        id: task.id,
        status: "done",
        result: "Done",
      },
    });
  });

  it("runs goal completion checks in the background after the final task completes", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });
    manager.updateGoal(goal.id, { status: "active" });
    const task = manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Task",
    });
    manager.updateTask(task.id, { status: "in_progress" });
    const sendToSession = vi.fn();

    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
      sendToSession,
    });

    await tool.execute("call-complete-final", {
      action: "complete",
      id: task.id,
      result: "Done",
      outcome: "success",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.getGoal(goal.id)?.status).toBe("complete");
    expect(sendToSession).toHaveBeenCalledOnce();
  });

  it("fails an in-progress task", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });
    const task = manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Task",
    });
    manager.updateTask(task.id, { status: "in_progress" });

    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-fail", {
      action: "fail",
      id: task.id,
      result: "Broken",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      action: "fail",
      task: {
        id: task.id,
        status: "failed",
        result: "Broken",
      },
    });
  });

  it("returns JSON error details for missing goals instead of throwing", async () => {
    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
    });

    await expect(
      tool.execute("call-error", {
        action: "create",
        goalId: "missing-goal",
        title: "Should fail",
      }),
    ).resolves.toMatchObject({
      details: {
        status: "error",
        error: "Goal not found: missing-goal",
      },
    });
  });

  it("delegates a task through the injected spawn callback", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Goal",
    });
    const task = manager.createTask({
      goalId: goal.id,
      agentId: "agent-1",
      title: "Delegate me",
      description: "Inspect the failing path",
    });
    const spawnTaskSession = vi.fn().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:worker",
    });
    const tool = createTasksTool({
      goalManager: manager,
      agentId: "agent-1",
      sessionKey: "agent:main:main",
      spawnTaskSession,
    });

    const result = await tool.execute("call-delegate", {
      action: "delegate",
      id: task.id,
      agentPrompt: "Inspect and report back",
      roleId: "reviewer",
      runtime: "subagent",
      model: "anthropic/claude-sonnet-4-6",
    });

    expect(spawnTaskSession).toHaveBeenCalledWith({
      taskId: task.id,
      task: "Inspect and report back",
      roleId: "reviewer",
      runtime: "subagent",
      agentId: undefined,
      model: "anthropic/claude-sonnet-4-6",
      thinking: undefined,
      runTimeoutSeconds: undefined,
      sandbox: undefined,
      reportBack: undefined,
    });
    expect(result.details).toMatchObject({
      status: "ok",
      action: "delegate",
      spawn: {
        status: "accepted",
        childSessionKey: "agent:main:subagent:worker",
      },
    });
  });
});
