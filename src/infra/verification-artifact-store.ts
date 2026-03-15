import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { VerificationScopeReport } from "./verification-scope.js";

export type VerificationArtifactRecord = {
  runId: string;
  createdAt: number;
  report: VerificationScopeReport;
};

function normalizeRunId(runId: string): string {
  const trimmed = runId.trim();
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-") || "run";
}

export function resolveVerificationArtifactsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "verification-artifacts");
}

function buildArtifactFilename(record: VerificationArtifactRecord): string {
  return `${record.createdAt}-${normalizeRunId(record.runId)}.json`;
}

export async function persistVerificationArtifact(params: {
  runId: string;
  report: VerificationScopeReport;
  env?: NodeJS.ProcessEnv;
  now?: number;
}): Promise<VerificationArtifactRecord> {
  const record: VerificationArtifactRecord = {
    runId: params.runId,
    createdAt: params.now ?? Date.now(),
    report: params.report,
  };
  const dir = resolveVerificationArtifactsDir(params.env);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, buildArtifactFilename(record));
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function loadRecentVerificationArtifacts(params?: {
  limit?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<VerificationArtifactRecord[]> {
  const limit = Math.max(1, params?.limit ?? 10);
  const dir = resolveVerificationArtifactsDir(params?.env);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const fileNames = entries
    .filter((entry) => entry.endsWith(".json"))
    .toSorted()
    .toReversed();
  const records: VerificationArtifactRecord[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(dir, fileName);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as VerificationArtifactRecord;
      if (
        parsed &&
        typeof parsed.runId === "string" &&
        typeof parsed.createdAt === "number" &&
        parsed.report &&
        typeof parsed.report === "object"
      ) {
        records.push(parsed);
      }
    } catch {
      continue;
    }
    if (records.length >= limit) {
      break;
    }
  }
  return records;
}
