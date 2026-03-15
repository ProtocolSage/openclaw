import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../test-utils/env.js";

const readFileSyncMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: readFileMock,
  },
}));

const { isWSLEnv, isWSLSync, isWSL2Sync, isWSL, resetWSLStateForTests } = await import("./wsl.js");

describe("wsl detection", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["WSL_INTEROP", "WSL_DISTRO_NAME", "WSLENV"]);
    delete process.env.WSL_INTEROP;
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.WSLENV;
    readFileSyncMock.mockReset();
    readFileMock.mockReset();
    resetWSLStateForTests();
  });

  afterEach(() => {
    envSnapshot.restore();
    resetWSLStateForTests();
  });

  it.each([
    ["WSL_DISTRO_NAME", "Ubuntu"],
    ["WSL_INTEROP", "/run/WSL/123_interop"],
    ["WSLENV", "PATH/l"],
  ])("detects WSL from %s", (key, value) => {
    expect(isWSLEnv({ [key]: value })).toBe(true);
  });

  it("reads /proc/version for sync WSL detection when env vars are absent", () => {
    readFileSyncMock.mockReturnValueOnce("Linux version 6.6.0-1-microsoft-standard-WSL2");
    expect(
      isWSLSync({
        env: {},
        platform: "linux",
        readKernelVersionSync: readFileSyncMock,
      }),
    ).toBe(true);
    expect(readFileSyncMock).toHaveBeenCalledWith("/proc/version", "utf8");
  });

  it("returns false when sync detection cannot read /proc/version", () => {
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(
      isWSLSync({
        env: {},
        platform: "linux",
        readKernelVersionSync: readFileSyncMock,
      }),
    ).toBe(false);
  });

  it.each(["Linux version 6.6.0-1-microsoft-standard-WSL2", "Linux version 6.6.0-1-wsl2"])(
    "detects WSL2 sync from kernel version: %s",
    (kernelVersion) => {
      readFileSyncMock.mockReturnValueOnce(kernelVersion);
      readFileSyncMock.mockReturnValueOnce(kernelVersion);
      expect(
        isWSL2Sync({
          env: {},
          platform: "linux",
          readKernelVersionSync: readFileSyncMock,
        }),
      ).toBe(true);
    },
  );

  it("returns false for WSL2 sync when WSL is detected but no WSL2 markers exist", () => {
    readFileSyncMock.mockReturnValueOnce("Linux version 4.4.0-19041-Microsoft");
    readFileSyncMock.mockReturnValueOnce("Linux version 4.4.0-19041-Microsoft");
    expect(
      isWSL2Sync({
        env: {},
        platform: "linux",
        readKernelVersionSync: readFileSyncMock,
      }),
    ).toBe(false);
  });

  it("returns false for sync detection on non-linux platforms", () => {
    expect(isWSLSync({ env: {}, platform: "darwin" })).toBe(false);
    expect(isWSL2Sync({ env: {}, platform: "darwin" })).toBe(false);
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("caches async WSL detection until reset", async () => {
    readFileMock.mockResolvedValue("6.6.0-1-microsoft-standard-WSL2");

    await expect(
      isWSL({
        env: {},
        platform: "linux",
        readKernelRelease: readFileMock,
      }),
    ).resolves.toBe(true);
    await expect(
      isWSL({
        env: {},
        platform: "linux",
        readKernelRelease: readFileMock,
      }),
    ).resolves.toBe(true);

    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it("caches async WSL detection only for the default runtime path", async () => {
    readFileMock.mockResolvedValue("6.6.0-1-microsoft-standard-WSL2");

    await expect(isWSL()).resolves.toBe(true);
    await expect(isWSL()).resolves.toBe(true);
    expect(readFileMock).toHaveBeenCalledTimes(1);

    resetWSLStateForTests();
    await expect(isWSL()).resolves.toBe(true);
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it("short-circuits async detection from WSL env vars without reading osrelease", async () => {
    await expect(isWSL({ env: { WSL_DISTRO_NAME: "Ubuntu" } })).resolves.toBe(true);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("returns false when async WSL detection cannot read osrelease", async () => {
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(
      isWSL({
        env: {},
        platform: "linux",
        readKernelRelease: readFileMock,
      }),
    ).resolves.toBe(false);
  });

  it("returns false for async detection on non-linux platforms without reading osrelease", async () => {
    await expect(isWSL({ env: {}, platform: "win32" })).resolves.toBe(false);
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
