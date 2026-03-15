import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistVerificationArtifact } from "./verification-artifact-store.js";
import {
  loadRecentVerificationReports,
  renderLatestStoredVerificationSummary,
  renderStoredVerificationSummary,
  renderVerificationSummary,
} from "./verification-scope.js";

describe("renderVerificationSummary", () => {
  it("renders patch-only summary correctly without implying verification", () => {
    expect(
      renderVerificationSummary({
        patchApplied: true,
        targetedTests: "not-run",
        fullTsc: "not-run",
        fullLint: "not-run",
        requiredRepoTests: "not-run",
      }),
    ).toEqual([
      "Patch applied",
      "Targeted tests not run",
      "Full tsc not run",
      "Full lint not run",
      "Required repo-wide tests not run",
      "Repo-wide health unknown",
    ]);
  });

  it("renders targeted-only summary with the expected stable labels", () => {
    expect(
      renderVerificationSummary({
        patchApplied: false,
        targetedTests: "passed",
        fullTsc: "not-run",
        fullLint: "not-run",
        requiredRepoTests: "not-run",
      }),
    ).toEqual([
      "Targeted tests passed",
      "Full tsc not run",
      "Full lint not run",
      "Required repo-wide tests not run",
      "Repo-wide health unknown",
    ]);
  });

  it("renders Full tsc failed: <reason> correctly", () => {
    expect(
      renderVerificationSummary({
        patchApplied: false,
        targetedTests: "passed",
        fullTsc: "failed",
        fullLint: "not-run",
        requiredRepoTests: "not-run",
        reasons: { fullTsc: "tsc exited 2" },
      }),
    ).toEqual([
      "Targeted tests passed",
      "Full tsc failed: tsc exited 2",
      "Full lint not run",
      "Required repo-wide tests not run",
      "Repo-wide health unknown",
    ]);
  });

  it("never renders Repo-wide health established unless fullTsc + fullLint + required tests are all passed", () => {
    expect(
      renderVerificationSummary({
        patchApplied: false,
        targetedTests: "passed",
        fullTsc: "passed",
        fullLint: "passed",
        requiredRepoTests: "not-run",
      }),
    ).toEqual([
      "Targeted tests passed",
      "Full tsc passed",
      "Full lint passed",
      "Required repo-wide tests not run",
      "Repo-wide health unknown",
    ]);
  });

  it("renders Repo-wide health unknown when any required broad check is not-run or failed", () => {
    expect(
      renderVerificationSummary({
        patchApplied: false,
        targetedTests: "passed",
        fullTsc: "passed",
        fullLint: "failed",
        requiredRepoTests: "passed",
      }),
    ).toEqual([
      "Targeted tests passed",
      "Full tsc passed",
      "Full lint failed",
      "Required repo-wide tests passed",
      "Repo-wide health unknown",
    ]);
  });
});

describe("verification artifact persistence", () => {
  let tempStateDir: string | undefined;

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = undefined;
    }
  });

  it("loads the most recent stored verification records", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-verification-"));
    const env = { ...process.env, OPENCLAW_STATE_DIR: tempStateDir };
    await persistVerificationArtifact({
      runId: "run-1",
      now: 1000,
      env,
      report: {
        patchApplied: true,
        targetedTests: "passed",
        fullTsc: "not-run",
        fullLint: "not-run",
        requiredRepoTests: "not-run",
      },
    });
    await persistVerificationArtifact({
      runId: "run-2",
      now: 2000,
      env,
      report: {
        patchApplied: false,
        targetedTests: "failed",
        fullTsc: "not-run",
        fullLint: "not-run",
        requiredRepoTests: "not-run",
      },
    });

    const records = await loadRecentVerificationReports({ limit: 2, env });
    expect(records.map((record) => record.runId)).toEqual(["run-2", "run-1"]);
  });

  it("renders the latest stored verification summary from persisted records", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-verification-"));
    const env = { ...process.env, OPENCLAW_STATE_DIR: tempStateDir };
    await persistVerificationArtifact({
      runId: "run-latest",
      now: 3000,
      env,
      report: {
        patchApplied: false,
        targetedTests: "passed",
        fullTsc: "not-run",
        fullLint: "not-run",
        requiredRepoTests: "not-run",
      },
    });

    await expect(renderLatestStoredVerificationSummary({ env })).resolves.toEqual([
      "Targeted tests passed",
      "Full tsc not run",
      "Full lint not run",
      "Required repo-wide tests not run",
      "Repo-wide health unknown",
    ]);
  });

  it("reports explicitly when no stored verification record exists", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-verification-"));
    const env = { ...process.env, OPENCLAW_STATE_DIR: tempStateDir };
    await expect(renderLatestStoredVerificationSummary({ env })).resolves.toEqual([
      "No stored verification record found",
    ]);
    expect(renderStoredVerificationSummary(undefined)).toEqual([
      "No stored verification record found",
    ]);
  });
});
