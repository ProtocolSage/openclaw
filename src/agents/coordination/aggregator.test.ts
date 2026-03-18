import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalManager } from "../../goals/manager.js";
import { GoalStore } from "../../goals/store.js";
import { checkGoalCompletion, checkGoalCompletionInBackground } from "./aggregator.js";

describe("goal aggregator", () => {
  let store: GoalStore;
  let manager: GoalManager;
  let dbPath: string;

  beforeEach(() => {
    store = new GoalStore();
    dbPath = path.join(
      os.tmpdir(),
      `aggregator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

  it("completes an active goal when all tasks are done", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Ship feature",
    });
    manager.updateGoal(goal.id, { status: "active" });
    const taskA = manager.createTask({ goalId: goal.id, agentId: "agent-1", title: "Build" });
    const taskB = manager.createTask({ goalId: goal.id, agentId: "agent-1", title: "Verify" });
    manager.updateTask(taskA.id, { status: "in_progress" });
    manager.completeTask(taskA.id, "success", "done");
    manager.updateTask(taskB.id, { status: "in_progress" });
    manager.completeTask(taskB.id, "success", "done");
    const sendToSession = vi.fn();

    const result = await checkGoalCompletion({
      goalManager: manager,
      goalId: goal.id,
      sendToSession,
    });

    expect(result).toMatchObject({
      status: "completed",
      goal: { id: goal.id, status: "complete" },
    });
    expect(sendToSession).toHaveBeenCalledWith(
      "agent:main:main",
      expect.stringContaining('Goal "Ship feature" is complete.'),
    );
  });

  it("flags failed terminal tasks as a blocked goal", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Deploy feature",
    });
    manager.updateGoal(goal.id, { status: "active" });
    const task = manager.createTask({ goalId: goal.id, agentId: "agent-1", title: "Deploy" });
    manager.updateTask(task.id, { status: "in_progress" });
    manager.failTask(task.id, "boom");
    const sendToSession = vi.fn();

    const result = await checkGoalCompletion({
      goalManager: manager,
      goalId: goal.id,
      sendToSession,
    });

    expect(result).toMatchObject({
      status: "blocked",
      goal: { id: goal.id, status: "blocked" },
    });
    expect(sendToSession).toHaveBeenCalledWith(
      "agent:main:main",
      expect.stringContaining('Goal "Deploy feature" is blocked.'),
    );
  });

  it("swallows notifier failures in the fire-and-forget wrapper", async () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "agent:main:main",
      title: "Wrap up",
    });
    manager.updateGoal(goal.id, { status: "active" });
    const task = manager.createTask({ goalId: goal.id, agentId: "agent-1", title: "Finish" });
    manager.updateTask(task.id, { status: "in_progress" });
    manager.completeTask(task.id, "success", "done");
    const sendToSession = vi.fn().mockRejectedValue(new Error("delivery failed"));

    expect(() =>
      checkGoalCompletionInBackground({
        goalManager: manager,
        goalId: goal.id,
        sendToSession,
      }),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendToSession).toHaveBeenCalledOnce();
  });
});
