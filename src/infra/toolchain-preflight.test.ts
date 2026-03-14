import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeterministicExecPath,
  detectRequiredBinaries,
  runToolchainPreflight,
} from "./toolchain-preflight.js";

async function withTempBinDir(run: (binDir: string) => Promise<void>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-toolchain-preflight-"));
  const binDir = path.join(tempDir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  try {
    await run(binDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function writeExecutable(binDir: string, name: string) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const filePath = path.join(binDir, `${name}${suffix}`);
  const contents =
    process.platform === "win32" ? "@echo off\r\necho ok\r\n" : "#!/bin/sh\necho ok\n";
  await fs.writeFile(filePath, contents, "utf8");
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

describe("toolchain preflight", () => {
  afterEach(() => {
    delete process.env.PATH;
  });

  it("prepends deterministic candidate dirs ahead of ambient PATH", () => {
    const env = {
      HOME: "/tmp/example-home",
      PATH: "/ambient/bin",
    };
    const built = buildDeterministicExecPath(env);
    const entries = built.split(path.delimiter);
    expect(entries[0]).toBe(path.dirname(process.execPath));
    expect(entries.at(-1)).toBe("/ambient/bin");
  });

  it("detectRequiredBinaries returns [] for non-tooling commands", () => {
    expect(detectRequiredBinaries("echo ok")).toEqual([]);
  });

  it("preflight passes when required binaries are present", async () => {
    await withTempBinDir(async (binDir) => {
      await writeExecutable(binDir, "pnpm");
      await writeExecutable(binDir, "node");

      const result = runToolchainPreflight("pnpm exec vitest", {
        HOME: binDir,
        PATH: binDir,
      });

      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.required).toEqual(["pnpm", "node"]);
    });
  });

  it("preflight reports missing pnpm deterministically", async () => {
    await withTempBinDir(async (binDir) => {
      await writeExecutable(binDir, "node");
      // This test intentionally hooks the current synchronous fs.accessSync lookup.
      // If the preflight implementation switches to async access checks, update
      // this test to intercept that path instead of silently relying on the old one.
      const originalAccessSync = nodeFs.accessSync;
      const accessSpy = vi.spyOn(nodeFs, "accessSync").mockImplementation((candidate, mode) => {
        if (String(candidate).includes(`${path.sep}pnpm`)) {
          throw new Error("pnpm missing");
        }
        return Reflect.apply(originalAccessSync, nodeFs, [candidate, mode]);
      });

      const result = runToolchainPreflight("pnpm exec vitest", {
        HOME: binDir,
        PATH: binDir,
      });

      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(["pnpm"]);
      accessSpy.mockRestore();
    });
  });

  it("preflight reports missing codex deterministically", async () => {
    await withTempBinDir(async (binDir) => {
      await writeExecutable(binDir, "node");

      const result = runToolchainPreflight("codex exec 'hi'", {
        HOME: binDir,
        PATH: binDir,
      });

      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(["codex"]);
    });
  });
});
