import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { runExecProcess } from "./bash-tools.exec-runtime.js";

const { supervisorSpawnMock, preflightMock } = vi.hoisted(() => ({
  supervisorSpawnMock: vi.fn(),
  preflightMock: vi.fn(),
}));

vi.mock("../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => ({
    spawn: (...args: unknown[]) => supervisorSpawnMock(...args),
    cancel: vi.fn(),
    cancelScope: vi.fn(),
    reconcileOrphans: vi.fn(),
    getRecord: vi.fn(),
  }),
}));

vi.mock("../infra/toolchain-preflight.js", async () => {
  const actual = await vi.importActual<typeof import("../infra/toolchain-preflight.js")>(
    "../infra/toolchain-preflight.js",
  );
  return {
    ...actual,
    runToolchainPreflight: (...args: Parameters<typeof actual.runToolchainPreflight>) =>
      preflightMock(...args),
  };
});

function createManagedRun(exitCode = 0) {
  return {
    runId: "run-supervisor",
    pid: 1234,
    startedAtMs: Date.now(),
    stdin: undefined,
    wait: vi.fn().mockResolvedValue({
      reason: "exit" as const,
      exitCode,
      exitSignal: null,
      durationMs: 10,
      stdout: "",
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    }),
    cancel: vi.fn(),
  };
}

describe("runExecProcess toolchain preflight", () => {
  beforeEach(() => {
    supervisorSpawnMock.mockReset();
    preflightMock.mockReset();
  });

  afterEach(() => {
    resetProcessRegistryForTests();
  });

  it("short-circuits before spawn when required binary is missing", async () => {
    preflightMock.mockReturnValue({
      ok: false,
      required: ["pnpm", "node"],
      missing: ["pnpm"],
      pathUsed: "/deterministic/bin",
    });

    const handle = await runExecProcess({
      command: "pnpm exec vitest",
      workdir: process.cwd(),
      env: { PATH: "/ambient/bin" },
      usePty: false,
      warnings: [],
      maxOutput: 1_000,
      pendingMaxOutput: 1_000,
      notifyOnExit: false,
      timeoutSec: null,
    });

    const result = await handle.promise;
    expect(supervisorSpawnMock).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("Blocked: required tool not found in PATH: pnpm");
  });

  it("does not block non-tooling commands", async () => {
    preflightMock.mockReturnValue({
      ok: true,
      required: [],
      missing: [],
      pathUsed: "/deterministic/bin:/ambient/bin",
    });
    supervisorSpawnMock.mockResolvedValueOnce(createManagedRun());

    const handle = await runExecProcess({
      command: "echo ok",
      workdir: process.cwd(),
      env: { PATH: "/ambient/bin" },
      usePty: false,
      warnings: [],
      maxOutput: 1_000,
      pendingMaxOutput: 1_000,
      notifyOnExit: false,
      timeoutSec: null,
    });

    const result = await handle.promise;
    expect(supervisorSpawnMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("completed");
  });
});
