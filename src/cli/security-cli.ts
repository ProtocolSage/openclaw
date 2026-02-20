import type { Command } from "commander";
import { migratePlaintextAuthProfileSecretsToVault } from "../agents/auth-profiles.js";
import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { runSecurityAudit } from "../security/audit.js";
import {
  getAuditStats,
  verifyAuditLogIntegrity,
  type AuditLogIntegrity,
} from "../security/credential-audit.js";
import {
  migrateAllEnvToVault,
  scanEnvironmentForCredentials,
} from "../security/credential-env-scan.js";
import {
  ensureVaultDir,
  getCredentialsDueForRotation,
  listCredentials,
  rotateCredential,
  type CredentialScope,
} from "../security/credential-vault.js";
import { fixSecurityFootguns } from "../security/fix.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomeInString, shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

type SecurityAuditOptions = {
  json?: boolean;
  deep?: boolean;
  fix?: boolean;
};

type SecurityCredentialsStatusOptions = {
  json?: boolean;
};

type SecurityCredentialsMigrateOptions = {
  json?: boolean;
  env?: boolean;
  removeEnv?: boolean;
  risk?: "high" | "medium" | "low";
};

type SecurityCredentialsRotateOptions = {
  json?: boolean;
  scope?: string;
  value?: string;
};

function formatSummary(summary: { critical: number; warn: number; info: number }): string {
  const rich = isRich();
  const c = summary.critical;
  const w = summary.warn;
  const i = summary.info;
  const parts: string[] = [];
  parts.push(rich ? theme.error(`${c} critical`) : `${c} critical`);
  parts.push(rich ? theme.warn(`${w} warn`) : `${w} warn`);
  parts.push(rich ? theme.muted(`${i} info`) : `${i} info`);
  return parts.join(" · ");
}

export function registerSecurityCli(program: Command) {
  const security = program
    .command("security")
    .description("Security tools (audit, credential vault)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/security", "docs.openclaw.ai/cli/security")}\n`,
    );

  security
    .command("audit")
    .description("Audit config + local state for common security foot-guns")
    .option("--deep", "Attempt live Gateway probe (best-effort)", false)
    .option("--fix", "Apply safe fixes (tighten defaults + chmod state/config)", false)
    .option("--json", "Print JSON", false)
    .action(async (opts: SecurityAuditOptions) => {
      const fixResult = opts.fix ? await fixSecurityFootguns().catch((_err) => null) : null;

      const cfg = loadConfig();
      const report = await runSecurityAudit({
        config: cfg,
        deep: Boolean(opts.deep),
        includeFilesystem: true,
        includeChannelSecurity: true,
      });

      if (opts.json) {
        defaultRuntime.log(
          JSON.stringify(fixResult ? { fix: fixResult, report } : report, null, 2),
        );
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);

      const lines: string[] = [];
      lines.push(heading("OpenClaw security audit"));
      lines.push(muted(`Summary: ${formatSummary(report.summary)}`));
      lines.push(muted(`Run deeper: ${formatCliCommand("openclaw security audit --deep")}`));

      if (opts.fix) {
        lines.push(muted(`Fix: ${formatCliCommand("openclaw security audit --fix")}`));
        if (!fixResult) {
          lines.push(muted("Fixes: failed to apply (unexpected error)"));
        } else if (
          fixResult.errors.length === 0 &&
          fixResult.changes.length === 0 &&
          fixResult.actions.every((a) => !a.ok)
        ) {
          lines.push(muted("Fixes: no changes applied"));
        } else {
          lines.push("");
          lines.push(heading("FIX"));
          for (const change of fixResult.changes) {
            lines.push(muted(`  ${shortenHomeInString(change)}`));
          }
          for (const action of fixResult.actions) {
            if (action.kind === "chmod") {
              const mode = action.mode.toString(8).padStart(3, "0");
              if (action.ok) {
                lines.push(muted(`  chmod ${mode} ${shortenHomePath(action.path)}`));
              } else if (action.skipped) {
                lines.push(
                  muted(`  skip chmod ${mode} ${shortenHomePath(action.path)} (${action.skipped})`),
                );
              } else if (action.error) {
                lines.push(
                  muted(`  chmod ${mode} ${shortenHomePath(action.path)} failed: ${action.error}`),
                );
              }
              continue;
            }
            const command = shortenHomeInString(action.command);
            if (action.ok) {
              lines.push(muted(`  ${command}`));
            } else if (action.skipped) {
              lines.push(muted(`  skip ${command} (${action.skipped})`));
            } else if (action.error) {
              lines.push(muted(`  ${command} failed: ${action.error}`));
            }
          }
          if (fixResult.errors.length > 0) {
            for (const err of fixResult.errors) {
              lines.push(muted(`  error: ${shortenHomeInString(err)}`));
            }
          }
        }
      }

      const bySeverity = (sev: "critical" | "warn" | "info") =>
        report.findings.filter((f) => f.severity === sev);

      const render = (sev: "critical" | "warn" | "info") => {
        const list = bySeverity(sev);
        if (list.length === 0) {
          return;
        }
        const label =
          sev === "critical"
            ? rich
              ? theme.error("CRITICAL")
              : "CRITICAL"
            : sev === "warn"
              ? rich
                ? theme.warn("WARN")
                : "WARN"
              : rich
                ? theme.muted("INFO")
                : "INFO";
        lines.push("");
        lines.push(heading(label));
        for (const f of list) {
          lines.push(`${theme.muted(f.checkId)} ${f.title}`);
          lines.push(`  ${f.detail}`);
          if (f.remediation?.trim()) {
            lines.push(`  ${muted(`Fix: ${f.remediation.trim()}`)}`);
          }
        }
      };

      render("critical");
      render("warn");
      render("info");

      defaultRuntime.log(lines.join("\n"));
    });

  const credentials = security
    .command("credentials")
    .description("Credential vault inspection and migration tools");

  credentials
    .command("status")
    .description("Show vault and credential-audit status")
    .option("--json", "Print JSON", false)
    .action((opts: SecurityCredentialsStatusOptions) => {
      const entries = listCredentials();
      const dueForRotation = getCredentialsDueForRotation();
      const auditIntegrity = verifyAuditLogIntegrity();
      const auditStats = getAuditStats();
      const envScan = scanEnvironmentForCredentials();
      const authMigrationPreview = migratePlaintextAuthProfileSecretsToVault({ dryRun: true });

      const byScope: Record<CredentialScope, number> = {
        provider: 0,
        channel: 0,
        integration: 0,
        internal: 0,
      };
      for (const entry of entries) {
        byScope[entry.scope] += 1;
      }

      const payload = {
        credentials: {
          total: entries.length,
          byScope,
          dueForRotation: dueForRotation.length,
        },
        audit: {
          integrity: auditIntegrity,
          stats: auditStats,
        },
        authProfiles: {
          pendingPlaintextSecrets: authMigrationPreview.scanned,
        },
        envScan: {
          findings: envScan.findings.length,
          highRisk: envScan.findings.filter((f) => f.riskLevel === "high").length,
        },
      };

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(payload, null, 2));
        return;
      }

      const lines: string[] = [];
      lines.push(theme.heading("OpenClaw credential status"));
      lines.push(theme.muted(`Vault entries: ${entries.length}`));
      lines.push(
        theme.muted(
          `By scope: provider=${byScope.provider}, channel=${byScope.channel}, integration=${byScope.integration}, internal=${byScope.internal}`,
        ),
      );
      lines.push(theme.muted(`Due for rotation (>30d): ${dueForRotation.length}`));
      lines.push(theme.muted(`Audit integrity: ${formatIntegrity(auditIntegrity)}`));
      lines.push(
        theme.muted(`Pending plaintext auth-profile secrets: ${authMigrationPreview.scanned}`),
      );
      lines.push(
        theme.muted(
          `Env credential findings: ${envScan.findings.length} (${envScan.findings.filter((f) => f.riskLevel === "high").length} high risk)`,
        ),
      );
      defaultRuntime.log(lines.join("\n"));
    });

  credentials
    .command("migrate")
    .description(
      "Migrate plaintext auth-profile credentials (and optionally env secrets) into vault",
    )
    .option("--env", "Also migrate detected env credentials", false)
    .option("--remove-env", "Remove env vars after successful migration", false)
    .option("--risk <level>", "Env migration risk filter (high|medium|low)")
    .option("--json", "Print JSON", false)
    .action(async (opts: SecurityCredentialsMigrateOptions) => {
      ensureVaultDir();
      const authResult = migratePlaintextAuthProfileSecretsToVault();
      const envResult = opts.env
        ? await migrateAllEnvToVault(process.env, {
            removeFromEnv: Boolean(opts.removeEnv),
            riskLevelFilter: opts.risk,
          })
        : null;

      const payload = {
        authProfiles: authResult,
        env: envResult,
      };

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(payload, null, 2));
        return;
      }

      const lines: string[] = [];
      lines.push(theme.heading("Credential migration"));
      lines.push(
        theme.muted(
          `Auth profiles: migrated ${authResult.migrated}, failed ${authResult.failed}, pending ${Math.max(0, authResult.scanned - authResult.migrated - authResult.failed)}`,
        ),
      );
      if (envResult) {
        lines.push(
          theme.muted(
            `Environment: migrated ${envResult.migrated}, failed ${envResult.failed}, skipped ${envResult.skipped}`,
          ),
        );
      }
      defaultRuntime.log(lines.join("\n"));
    });

  credentials
    .command("rotate")
    .description("Rotate a vault credential")
    .argument("<name>", "Credential name")
    .requiredOption("--value <value>", "New credential value")
    .option(
      "--scope <scope>",
      "Credential scope (provider|channel|integration|internal)",
      "provider",
    )
    .option("--json", "Print JSON", false)
    .action((name: string, opts: SecurityCredentialsRotateOptions) => {
      const scope = toCredentialScope(opts.scope);
      if (!scope) {
        defaultRuntime.log("Invalid scope. Expected provider|channel|integration|internal.");
        return;
      }
      const value = String(opts.value ?? "").trim();
      if (!value) {
        defaultRuntime.log("Missing --value.");
        return;
      }
      const result = rotateCredential(name.trim(), scope, value, {
        requestor: "security-cli",
      });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(result, null, 2));
        return;
      }
      if (!result.ok) {
        defaultRuntime.log(`Rotation failed: ${result.error}`);
        return;
      }
      defaultRuntime.log(`Rotated ${scope}:${name.trim()} (hash ${result.entry.hashPrefix})`);
    });
}

function toCredentialScope(scope?: string): CredentialScope | null {
  if (
    scope === "provider" ||
    scope === "channel" ||
    scope === "integration" ||
    scope === "internal"
  ) {
    return scope;
  }
  return null;
}

function formatIntegrity(integrity: AuditLogIntegrity): string {
  if (integrity.valid) {
    return `ok (${integrity.entryCount} entries)`;
  }
  return `broken at index ${integrity.entryIndex}`;
}
