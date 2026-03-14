import { describe, expect, it } from "vitest";
import { renderVerificationSummary } from "./verification-scope.js";

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
