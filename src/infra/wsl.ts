import { readFileSync } from "node:fs";
import fs from "node:fs/promises";

let wslCached: boolean | null = null;

type WslDetectionDeps = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readKernelVersionSync?: (path: string, encoding: BufferEncoding) => string;
  readKernelRelease?: (path: string, encoding: BufferEncoding) => Promise<string>;
};

export function resetWSLStateForTests(): void {
  wslCached = null;
}

export function isWSLEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WSL_INTEROP || env.WSL_DISTRO_NAME || env.WSLENV) {
    return true;
  }
  return false;
}

/**
 * Synchronously check if running in WSL.
 * Checks env vars first, then /proc/version.
 */
export function isWSLSync(deps: WslDetectionDeps = {}): boolean {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const readKernelVersionSync = deps.readKernelVersionSync ?? readFileSync;
  if (platform !== "linux") {
    return false;
  }
  if (isWSLEnv(env)) {
    return true;
  }
  try {
    const release = readKernelVersionSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * Synchronously check if running in WSL2.
 */
export function isWSL2Sync(deps: WslDetectionDeps = {}): boolean {
  const readKernelVersionSync = deps.readKernelVersionSync ?? readFileSync;
  if (!isWSLSync(deps)) {
    return false;
  }
  try {
    const version = readKernelVersionSync("/proc/version", "utf8").toLowerCase();
    return version.includes("wsl2") || version.includes("microsoft-standard");
  } catch {
    return false;
  }
}

export async function isWSL(deps: WslDetectionDeps = {}): Promise<boolean> {
  const shouldUseCache =
    deps.env === undefined && deps.platform === undefined && deps.readKernelRelease === undefined;
  if (shouldUseCache && wslCached !== null) {
    return wslCached;
  }
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const readKernelRelease = deps.readKernelRelease ?? fs.readFile;
  if (platform !== "linux") {
    if (shouldUseCache) {
      wslCached = false;
      return wslCached;
    }
    return false;
  }
  if (isWSLEnv(env)) {
    if (shouldUseCache) {
      wslCached = true;
      return wslCached;
    }
    return true;
  }
  try {
    const release = await readKernelRelease("/proc/sys/kernel/osrelease", "utf8");
    const detected =
      release.toLowerCase().includes("microsoft") || release.toLowerCase().includes("wsl");
    if (shouldUseCache) {
      wslCached = detected;
      return wslCached;
    }
    return detected;
  } catch {
    if (shouldUseCache) {
      wslCached = false;
      return wslCached;
    }
    return false;
  }
}
