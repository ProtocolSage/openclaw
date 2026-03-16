import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoalStore } from "./store.js";
import type { Goal, Task, TaskAttempt } from "./types.js";

describe("GoalStore", () => {
  let store: GoalStore;
  let dbPath: string;

  beforeEach(() => {
    store = new GoalStore();
    dbPath = path.join(
      os.tmpdir(),
      `goal-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    store.open(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore cleanup errors
    }
  });

  // --- Goals ---

  it("round-trips a goal with all fields", () => {
    const goal: Goal = {
      id: "goal-test-1",
      agentId: "agent-1",
      ownerSessionKey: "sess-1",
      title: "Test Goal",
      description: "A goal for testing",
      status: "pending",
      priority: 2,
      deadlineMs: 1700000000000,
      parentGoalId: null,
      tags: ["test", "spec-1a"],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal(goal);
    const retrieved = store.getGoal("goal-test-1");
    expect(retrieved).toEqual(goal);
  });

  it("returns null for missing goal", () => {
    expect(store.getGoal("nonexistent")).toBeNull();
  });

  it("creates DB file on open", () => {
    const newPath = path.join(os.tmpdir(), `goal-store-new-${Date.now()}.db`);
    const newStore = new GoalStore();
    newStore.open(newPath);
    expect(fs.existsSync(newPath)).toBe(true);
    newStore.close();
    fs.unlinkSync(newPath);
  });

  it("updates partial goal fields", () => {
    const goal: Goal = {
      id: "goal-update-1",
      agentId: "agent-1",
      ownerSessionKey: "sess-1",
      title: "Original Title",
      description: "Original",
      status: "pending",
      priority: 3,
      deadlineMs: null,
      parentGoalId: null,
      tags: [],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal(goal);
    store.updateGoal("goal-update-1", { title: "Updated Title", priority: 1 });
    const updated = store.getGoal("goal-update-1");
    expect(updated?.title).toBe("Updated Title");
    expect(updated?.priority).toBe(1);
    expect(updated?.description).toBe("Original");
    expect(updated?.updatedAt).toBeGreaterThan(1690000000000);
  });

  it("lists goals filtered by agentId and status", () => {
    const base = {
      ownerSessionKey: "sess-1",
      description: "",
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      tags: [] as string[],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "g1", agentId: "a1", title: "G1", status: "active" });
    store.insertGoal({ ...base, id: "g2", agentId: "a1", title: "G2", status: "pending" });
    store.insertGoal({ ...base, id: "g3", agentId: "a2", title: "G3", status: "active" });

    const active1 = store.listGoals({ agentId: "a1", status: "active" });
    expect(active1).toHaveLength(1);
    expect(active1[0].id).toBe("g1");

    const allA1 = store.listGoals({ agentId: "a1" });
    expect(allA1).toHaveLength(2);
  });

  it("filters goals by tags (in-app)", () => {
    const base = {
      ownerSessionKey: "sess-1",
      agentId: "a1",
      description: "",
      status: "active" as const,
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "gt1", title: "Tagged1", tags: ["alpha"] });
    store.insertGoal({ ...base, id: "gt2", title: "Tagged2", tags: ["beta"] });
    store.insertGoal({ ...base, id: "gt3", title: "Tagged3", tags: ["alpha", "beta"] });

    const results = store.listGoals({ agentId: "a1", tags: ["alpha"] });
    expect(results).toHaveLength(2);
    const ids = results.map((g) => g.id).toSorted();
    expect(ids).toEqual(["gt1", "gt3"]);
  });

  // --- Tasks ---

  it("round-trips a task with all fields", () => {
    const base = {
      ownerSessionKey: "sess-1",
      agentId: "a1",
      description: "",
      status: "pending" as const,
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      tags: [] as string[],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "goal-for-task", title: "Parent Goal" });

    const task: Task = {
      id: "task-test-1",
      goalId: "goal-for-task",
      agentId: "a1",
      title: "Test Task",
      description: "A task for testing",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: ["task-dep-1", "task-dep-2"],
      result: null,
      createdAt: 1690000000000,
      completedAt: null,
    };
    store.insertTask(task);
    const retrieved = store.getTask("task-test-1");
    expect(retrieved).toEqual(task);
    expect(retrieved?.dependsOn).toEqual(["task-dep-1", "task-dep-2"]);
  });

  it("creates task with status pending", () => {
    const base = {
      ownerSessionKey: "sess-1",
      agentId: "a1",
      description: "",
      status: "active" as const,
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      tags: [] as string[],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "g-task", title: "G" });

    const task: Task = {
      id: "task-status",
      goalId: "g-task",
      agentId: "a1",
      title: "T",
      description: "",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: [],
      result: null,
      createdAt: Date.now(),
      completedAt: null,
    };
    store.insertTask(task);
    const retrieved = store.getTask("task-status");
    expect(retrieved?.status).toBe("pending");
  });

  it("updates task fields", () => {
    const base = {
      ownerSessionKey: "s",
      agentId: "a",
      description: "",
      status: "active" as const,
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      tags: [] as string[],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "g-upd", title: "G" });
    store.insertTask({
      id: "t-upd",
      goalId: "g-upd",
      agentId: "a",
      title: "T",
      description: "",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: [],
      result: null,
      createdAt: 1690000000000,
      completedAt: null,
    });
    store.updateTask("t-upd", { status: "in_progress", result: "Working on it" });
    const updated = store.getTask("t-upd");
    expect(updated?.status).toBe("in_progress");
    expect(updated?.result).toBe("Working on it");
  });

  it("lists tasks by goalId", () => {
    const base = {
      ownerSessionKey: "s",
      agentId: "a",
      description: "",
      status: "active" as const,
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      tags: [] as string[],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "g-list", title: "G" });
    store.insertGoal({ ...base, id: "g-list2", title: "G2" });
    store.insertTask({
      id: "t-l1",
      goalId: "g-list",
      agentId: "a",
      title: "T1",
      description: "",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: [],
      result: null,
      createdAt: 1690000000000,
      completedAt: null,
    });
    store.insertTask({
      id: "t-l2",
      goalId: "g-list",
      agentId: "a",
      title: "T2",
      description: "",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: [],
      result: null,
      createdAt: 1690000001000,
      completedAt: null,
    });
    store.insertTask({
      id: "t-l3",
      goalId: "g-list2",
      agentId: "a",
      title: "T3",
      description: "",
      status: "pending",
      assignedSessionKey: null,
      dependsOn: [],
      result: null,
      createdAt: 1690000002000,
      completedAt: null,
    });

    const tasks = store.listTasks({ goalId: "g-list" });
    expect(tasks).toHaveLength(2);
  });

  // --- Task Attempts ---

  it("appends and lists task attempts", () => {
    const base = {
      ownerSessionKey: "s",
      agentId: "a",
      description: "",
      status: "active" as const,
      priority: 3 as const,
      deadlineMs: null,
      parentGoalId: null,
      tags: [] as string[],
      createdAt: 1690000000000,
      updatedAt: 1690000000000,
    };
    store.insertGoal({ ...base, id: "g-att", title: "G" });
    store.insertTask({
      id: "t-att",
      goalId: "g-att",
      agentId: "a",
      title: "T",
      description: "",
      status: "in_progress",
      assignedSessionKey: null,
      dependsOn: [],
      result: null,
      createdAt: 1690000000000,
      completedAt: null,
    });

    const attempt: TaskAttempt = {
      id: "att-1",
      taskId: "t-att",
      runId: "run-1",
      sessionKey: "sess-1",
      startedAt: 1690000000000,
      finishedAt: 1690000001000,
      outcome: "success",
      notes: "Completed successfully",
    };
    store.appendAttempt(attempt);
    const attempts = store.listAttempts("t-att");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toEqual(attempt);
  });
});
