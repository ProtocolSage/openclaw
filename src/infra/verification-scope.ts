export type VerificationResult = "passed" | "failed" | "not-run";

export type VerificationScopeReport = {
  patchApplied: boolean;
  targetedTests: VerificationResult;
  fullTsc: VerificationResult;
  fullLint: VerificationResult;
  requiredRepoTests: VerificationResult;
  reasons?: Partial<{
    targetedTests: string;
    fullTsc: string;
    fullLint: string;
    requiredRepoTests: string;
  }>;
};

function renderVerificationResult(
  scope: "targetedTests" | "fullTsc" | "fullLint" | "requiredRepoTests",
  result: VerificationResult,
  reason?: string,
): string {
  const labels = {
    targetedTests: {
      passed: "Targeted tests passed",
      failed: "Targeted tests failed",
      "not-run": "Targeted tests not run",
    },
    fullTsc: {
      passed: "Full tsc passed",
      failed: "Full tsc failed",
      "not-run": "Full tsc not run",
    },
    fullLint: {
      passed: "Full lint passed",
      failed: "Full lint failed",
      "not-run": "Full lint not run",
    },
    requiredRepoTests: {
      passed: "Required repo-wide tests passed",
      failed: "Required repo-wide tests failed",
      "not-run": "Required repo-wide tests not run",
    },
  } as const;
  const label = labels[scope][result];
  return result === "failed" && reason ? `${label}: ${reason}` : label;
}

export function renderVerificationSummary(report: VerificationScopeReport): string[] {
  const lines: string[] = [];
  if (report.patchApplied) {
    lines.push("Patch applied");
  }
  lines.push(
    renderVerificationResult("targetedTests", report.targetedTests, report.reasons?.targetedTests),
  );
  lines.push(renderVerificationResult("fullTsc", report.fullTsc, report.reasons?.fullTsc));
  lines.push(renderVerificationResult("fullLint", report.fullLint, report.reasons?.fullLint));
  lines.push(
    renderVerificationResult(
      "requiredRepoTests",
      report.requiredRepoTests,
      report.reasons?.requiredRepoTests,
    ),
  );

  const repoHealthEstablished =
    report.fullTsc === "passed" &&
    report.fullLint === "passed" &&
    report.requiredRepoTests === "passed";
  const repoHealthLine = repoHealthEstablished
    ? "Repo-wide health established"
    : "Repo-wide health unknown";
  lines.push(repoHealthLine);

  return lines;
}
