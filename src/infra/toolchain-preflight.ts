import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOLCHAIN_REQUIREMENTS = {
  pnpm: ["pnpm", "node"],
  git: ["git"],
  codex: ["codex", "node"],
  claude: ["claude"],
  opencode: ["opencode", "node"],
  pi: ["pi", "node"],
} as const;

export type ToolchainCommand = keyof typeof TOOLCHAIN_REQUIREMENTS;

export type ToolchainPreflightResult = {
  ok: boolean;
  required: string[];
  missing: string[];
  pathUsed: string;
};

function uniqueEntries(entries: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const trimmed = entry?.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function splitPathEntries(value?: string): string[] {
  return (
    value
      ?.split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

function getHomeDir(baseEnv: NodeJS.ProcessEnv): string {
  return baseEnv.HOME?.trim() || os.homedir();
}

function stripLeadingEnvTokens(command: string): string[] {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  if (tokens[index] === "env") {
    index += 1;
  }
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index += 1;
  }
  return tokens.slice(index);
}

export function buildDeterministicExecPath(baseEnv: NodeJS.ProcessEnv): string {
  const homeDir = getHomeDir(baseEnv);
  const processBinDir = path.dirname(process.execPath);
  const candidateDirs = uniqueEntries([
    processBinDir,
    path.join(homeDir, ".nvm/versions/node", process.version, "bin"),
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".local", "share", "pnpm"),
    path.join(homeDir, "Library", "pnpm"),
    path.join(homeDir, "bin"),
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
    ...splitPathEntries(baseEnv.PATH),
  ]);
  return candidateDirs.join(path.delimiter);
}

export function detectRequiredBinaries(command: string): string[] {
  const tokens = stripLeadingEnvTokens(command);
  const tool = tokens[0] as ToolchainCommand | undefined;
  if (!tool || !(tool in TOOLCHAIN_REQUIREMENTS)) {
    return [];
  }
  return [...TOOLCHAIN_REQUIREMENTS[tool]];
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findBinaryInPath(binary: string, pathValue: string): boolean {
  const entries = splitPathEntries(pathValue);
  if (entries.length === 0) {
    return false;
  }
  const pathExt =
    process.platform === "win32"
      ? splitPathEntries(process.env.PATHEXT?.replace(/;/g, path.delimiter) || ".EXE;.CMD;.BAT")
      : [""];
  for (const dir of entries) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `${binary}${ext}`);
      if (isExecutable(candidate)) {
        return true;
      }
    }
  }
  return false;
}

export function runToolchainPreflight(
  command: string,
  env: NodeJS.ProcessEnv,
): ToolchainPreflightResult {
  const required = detectRequiredBinaries(command);
  const pathUsed = buildDeterministicExecPath(env);
  if (required.length === 0) {
    return {
      ok: true,
      required,
      missing: [],
      pathUsed,
    };
  }
  const missing = required.filter((binary) => !findBinaryInPath(binary, pathUsed));
  return {
    ok: missing.length === 0,
    required,
    missing,
    pathUsed,
  };
}
