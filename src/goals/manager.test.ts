import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoalManager } from "./manager.js";
import { GoalStore } from "./store.js";

describe("GoalManager", () => {
  let store: GoalStore;
  let manager: GoalManager;
  let dbPath: string;

  beforeEach(() => {
    store = new GoalStore();
    dbPath = path.join(
      os.tmpdir(),
      `goal-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

  // --- Goal status transitions ---

  describe("validateGoalTransition", () => {
    it("allows pending -> active", () => {
      expect(manager.validateGoalTransition("pending", "active")).toBe(true);
    });

    it("allows pending -> cancelled", () => {
      expect(manager.validateGoalTransition("pending", "cancelled")).toBe(true);
    });

    it("allows active -> complete", () => {
      expect(manager.validateGoalTransition("active", "complete")).toBe(true);
    });

    it("allows active -> blocked", () => {
      expect(manager.validateGoalTransition("active", "blocked")).toBe(true);
    });

    it("allows active -> cancelled", () => {
      expect(manager.validateGoalTransition("active", "cancelled")).toBe(true);
    });

    it("allows blocked -> active", () => {
      expect(manager.validateGoalTransition("blocked", "active")).toBe(true);
    });

    it("rejects complete -> active", () => {
      expect(manager.validateGoalTransition("complete", "active")).toBe(false);
    });

    it("rejects cancelled -> active", () => {
      expect(manager.validateGoalTransition("cancelled", "active")).toBe(false);
    });

    it("rejects pending -> complete (skip active)", () => {
      expect(manager.validateGoalTransition("pending", "complete")).toBe(false);
    });
  });

  // --- Task status transitions ---

  describe("validateTaskTransition", () => {
    it("allows pending -> in_progress", () => {
      expect(manager.validateTaskTransition("pending", "in_progress")).toBe(true);
    });

    it("allows in_progress -> done", () => {
      expect(manager.validateTaskTransition("in_progress", "done")).toBe(true);
    });

    it("allows in_progress -> failed", () => {
      expect(manager.validateTaskTransition("in_progress", "failed")).toBe(true);
    });

    it("allows pending -> delegated", () => {
      expect(manager.validateTaskTransition("pending", "delegated")).toBe(true);
    });

    it("allows delegated -> done", () => {
      expect(manager.validateTaskTransition("delegated", "done")).toBe(true);
    });

    it("rejects done -> in_progress", () => {
      expect(manager.validateTaskTransition("done", "in_progress")).toBe(false);
    });

    it("rejects failed -> pending", () => {
      expect(manager.validateTaskTransition("failed", "pending")).toBe(false);
    });
  });

  // --- Goal CRUD ---

  it("creates goal with pending status and generates id", () => {
    const goal = manager.createGoal({
      agentId: "agent-1",
      ownerSessionKey: "sess-1",
      title: "Test Goal",
    });
    expect(goal.id).toMatch(/^goal-/);
    expect(goal.status).toBe("pending");
    expect(goal.priority).toBe(3);
    expect(goal.tags).toEqual([]);
  });

  it("updateGoal rejects invalid transition", () => {
    const goal = manager.createGoal({
      agentId: "a1",
      ownerSessionKey: "s1",
      title: "G",
    });
    // pending -> complete is not allowed (must go through active first)
    expect(() => manager.updateGoal(goal.id, { status: "complete" })).toThrow(
      /Invalid goal transition/,
    );
  });

  it("updateGoal allows valid transition", () => {
    const goal = manager.createGoal({
      agentId: "a1",
      ownerSessionKey: "s1",
      title: "G",
    });
    const updated = manager.updateGoal(goal.id, { status: "active" });
    expect(updated.status).toBe("active");
  });

  it("closeGoal with complete", () => {
    const goal = manager.createGoal({
      agentId: "a1",
      ownerSessionKey: "s1",
      title: "G",
    });
    manager.updateGoal(goal.id, { status: "active" });
    const closed = manager.closeGoal(goal.id, "complete", "Done!");
    expect(closed.status).toBe("complete");
  });

  // --- Task CRUD ---

  it("creates task with pending status", () => {
    const goal = manager.createGoal({
      agentId: "a1",
      ownerSessionKey: "s1",
      title: "G",
    });
    const task = manager.createTask({
      goalId: goal.id,
      agentId: "a1",
      title: "T",
    });
    expect(task.id).toMatch(/^task-/);
    expect(task.status).toBe("pending");
    expect(task.dependsOn).toEqual([]);
  });

  it("completeTask sets done + result", () => {
    const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
    const task = manager.createTask({ goalId: goal.id, agentId: "a1", title: "T" });
    manager.updateTask(task.id, { status: "in_progress" });
    const completed = manager.completeTask(task.id, "success", "All done");
    expect(completed.status).toBe("done");
    expect(completed.result).toBe("All done");
    expect(completed.completedAt).toBeGreaterThan(0);
  });

  it("failTask sets failed + reason", () => {
    const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
    const task = manager.createTask({ goalId: goal.id, agentId: "a1", title: "T" });
    manager.updateTask(task.id, { status: "in_progress" });
    const failed = manager.failTask(task.id, "Something went wrong");
    expect(failed.status).toBe("failed");
    expect(failed.result).toBe("Something went wrong");
  });

  // --- getReadyTasks ---

  describe("getReadyTasks", () => {
    it("returns task with empty dependsOn", () => {
      const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
      manager.updateGoal(goal.id, { status: "active" });
      manager.createTask({ goalId: goal.id, agentId: "a1", title: "T1" });
      const ready = manager.getReadyTasks("a1");
      expect(ready).toHaveLength(1);
    });

    it("returns task when dependency is done", () => {
      const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
      manager.updateGoal(goal.id, { status: "active" });
      const dep = manager.createTask({ goalId: goal.id, agentId: "a1", title: "Dep" });
      manager.updateTask(dep.id, { status: "in_progress" });
      manager.completeTask(dep.id, "success");
      manager.createTask({ goalId: goal.id, agentId: "a1", title: "T2", dependsOn: [dep.id] });
      const ready = manager.getReadyTasks("a1");
      expect(ready.some((t) => t.title === "T2")).toBe(true);
    });

    it("skips task when dependency is pending", () => {
      const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
      manager.updateGoal(goal.id, { status: "active" });
      const dep = manager.createTask({ goalId: goal.id, agentId: "a1", title: "Dep" });
      manager.createTask({ goalId: goal.id, agentId: "a1", title: "T2", dependsOn: [dep.id] });
      const ready = manager.getReadyTasks("a1");
      // T2 should NOT be ready since its dependency is still pending
      expect(ready.some((t) => t.title === "T2")).toBe(false);
      // Dep should be ready (no dependencies itself)
      expect(ready.some((t) => t.title === "Dep")).toBe(true);
    });
  });

  // --- areAllTasksTerminal ---

  describe("areAllTasksTerminal", () => {
    it("returns true when no tasks exist", () => {
      const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
      expect(manager.areAllTasksTerminal(goal.id)).toBe(true);
    });

    it("returns true when all tasks are done/failed", () => {
      const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
      const t1 = manager.createTask({ goalId: goal.id, agentId: "a1", title: "T1" });
      const t2 = manager.createTask({ goalId: goal.id, agentId: "a1", title: "T2" });
      manager.updateTask(t1.id, { status: "in_progress" });
      manager.completeTask(t1.id, "success");
      manager.updateTask(t2.id, { status: "in_progress" });
      manager.failTask(t2.id, "reason");
      expect(manager.areAllTasksTerminal(goal.id)).toBe(true);
    });

    it("returns false when a pending task exists", () => {
      const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
      manager.createTask({ goalId: goal.id, agentId: "a1", title: "T1" });
      const t2 = manager.createTask({ goalId: goal.id, agentId: "a1", title: "T2" });
      manager.updateTask(t2.id, { status: "in_progress" });
      manager.completeTask(t2.id, "success");
      expect(manager.areAllTasksTerminal(goal.id)).toBe(false);
    });
  });

  // --- getStaleGoals ---

  it("getStaleGoals returns goals with old updatedAt", () => {
    const goal = manager.createGoal({ agentId: "a1", ownerSessionKey: "s1", title: "G" });
    manager.updateGoal(goal.id, { status: "active" });

    // With a very large staleness window (1 hour), the goal was just updated so NOT stale
    const notStale = manager.getStaleGoals("a1", 3_600_000);
    expect(notStale).toHaveLength(0);

    // Force updatedAt to be old by directly updating the store
    store.updateGoal(goal.id, {}); // just refreshes updatedAt to now
    // With a 1ms window, it should be stale (since at least 1ms has passed)
    // Wait a tiny bit to ensure time passes
    const start = Date.now();
    while (Date.now() === start) {
      // spin until clock tick
    }
    const stale = manager.getStaleGoals("a1", 1);
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(goal.id);
  });

  // --- getImminentDeadlines ---

  it("getImminentDeadlines returns goals within window", () => {
    const now = Date.now();
    const goal = manager.createGoal({
      agentId: "a1",
      ownerSessionKey: "s1",
      title: "G",
      deadlineMs: now + 5000,
    });
    manager.updateGoal(goal.id, { status: "active" });

    const imminent = manager.getImminentDeadlines("a1", 10000);
    expect(imminent).toHaveLength(1);

    // Very small window should not include it
    const notImminent = manager.getImminentDeadlines("a1", 100);
    expect(notImminent).toHaveLength(0);
  });

  // --- Error handling ---

  it("throws on update for nonexistent goal", () => {
    expect(() => manager.updateGoal("doesnt-exist", { title: "X" })).toThrow(/Goal not found/);
  });

  it("throws on update for nonexistent task", () => {
    expect(() => manager.updateTask("doesnt-exist", { title: "X" })).toThrow(/Task not found/);
  });
});
