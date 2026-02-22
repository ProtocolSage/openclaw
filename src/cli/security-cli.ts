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

  // ── security monitoring ────────────────────────────────────────────────────
  const monitoring = security
    .command("monitoring")
    .description("Security monitoring and event detection status");

  monitoring
    .command("status")
    .description("Show monitor runner and event system status")
    .option("--json", "Output JSON", false)
    .action(async (opts: { json?: boolean }) => {
      const { getMonitorRunner } = await import("../security/monitor-runner.js");
      const { getSecurityEventsManager } = await import("../security/security-events.js");
      const { getSessionRiskMonitor } = await import("../security/session-monitoring.js");
      const { getToolMonitor } = await import("../security/tool-monitoring.js");

      const runnerStatus = getMonitorRunner().getStatus();
      const eventsStats = getSecurityEventsManager().getStats();
      const sessionStats = getSessionRiskMonitor().getStats();
      const toolStats = getToolMonitor().getWindowStats();

      if (opts.json) {
        defaultRuntime.log(
          JSON.stringify(
            { runner: runnerStatus, events: eventsStats, sessions: sessionStats, tools: toolStats },
            null,
            2,
          ),
        );
        return;
      }

      const rich = isRich();
      const lines: string[] = [];
      lines.push(rich ? theme.heading("Security Monitoring Status") : "Security Monitoring Status");
      lines.push("");

      // Runner
      lines.push(rich ? theme.heading("Monitor Runner") : "Monitor Runner");
      lines.push(
        `  Running:    ${runnerStatus.running ? (rich ? theme.accent("yes") : "yes") : rich ? theme.error("no") : "no"}`,
      );
      lines.push(`  Enabled:    ${runnerStatus.enabled ? "yes" : "no"}`);
      lines.push(`  Scans run:  ${runnerStatus.scanCount}`);
      lines.push(`  Errors:     ${runnerStatus.errorCount}`);
      if (runnerStatus.lastScanAt) {
        lines.push(
          `  Last scan:  ${new Date(runnerStatus.lastScanAt).toISOString()} (${runnerStatus.lastScanFindings} findings)`,
        );
      }
      if (runnerStatus.nextScanAt) {
        lines.push(`  Next scan:  ${new Date(runnerStatus.nextScanAt).toISOString()}`);
      }
      lines.push("");

      // Events
      lines.push(rich ? theme.heading("Security Events") : "Security Events");
      lines.push(`  Total:      ${eventsStats.total}`);
      lines.push(
        `  Critical:   ${rich ? theme.error(String(eventsStats.bySeverity.critical)) : String(eventsStats.bySeverity.critical)}`,
      );
      lines.push(
        `  Warn:       ${rich ? theme.warn(String(eventsStats.bySeverity.warn)) : String(eventsStats.bySeverity.warn)}`,
      );
      lines.push(
        `  Info:       ${rich ? theme.muted(String(eventsStats.bySeverity.info)) : String(eventsStats.bySeverity.info)}`,
      );
      lines.push("");

      // Sessions
      lines.push(rich ? theme.heading("Session Risk Monitor") : "Session Risk Monitor");
      lines.push(`  Sessions:   ${sessionStats.totalSessions}`);
      lines.push(`  High-risk:  ${sessionStats.highRiskCount}`);
      lines.push(`  Max score:  ${sessionStats.maxScore}`);
      lines.push("");

      // Tool calls
      lines.push(
        rich ? theme.heading("Tool Monitor (active window)") : "Tool Monitor (active window)",
      );
      lines.push(`  Calls:      ${toolStats.totalCalls}`);

      defaultRuntime.log(lines.join("\n"));
    });

  monitoring
    .command("events")
    .description("Query recent security events")
    .option("--severity <level>", "Filter by severity: info | warn | critical")
    .option("--type <type>", "Filter by event type")
    .option("--since <duration>", "Only events within window (e.g. 1h, 24h, 7d)", "24h")
    .option("--limit <n>", "Maximum events to show", "20")
    .option("--json", "Output JSON", false)
    .action(
      async (opts: {
        severity?: string;
        type?: string;
        since?: string;
        limit?: string;
        json?: boolean;
      }) => {
        const { parseDurationMs } = await import("./parse-duration.js");
        const { querySecurityEvents } = await import("../security/security-events.js");
        const { getSecurityEventsManager } = await import("../security/security-events.js");

        await getSecurityEventsManager().init();

        const sinceMs = opts.since
          ? parseDurationMs(opts.since, { defaultUnit: "h" })
          : 24 * 60 * 60 * 1000;
        const limit = parseInt(opts.limit ?? "20", 10);

        const events = querySecurityEvents({
          severity: opts.severity as "info" | "warn" | "critical" | undefined,
          since: Date.now() - sinceMs,
          limit,
        });

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(events, null, 2));
          return;
        }

        if (events.length === 0) {
          defaultRuntime.log(`No events in the last ${opts.since ?? "24h"}.`);
          return;
        }

        const rich = isRich();
        const lines: string[] = [];
        lines.push(
          rich
            ? theme.heading(`Security Events (last ${opts.since ?? "24h"}, ${events.length} shown)`)
            : `Security Events (last ${opts.since ?? "24h"}, ${events.length} shown)`,
        );
        lines.push("");

        for (const ev of events) {
          const ts = new Date(ev.ts).toISOString();
          const sevLabel =
            ev.severity === "critical"
              ? rich
                ? theme.error("CRIT")
                : "CRIT"
              : ev.severity === "warn"
                ? rich
                  ? theme.warn("WARN")
                  : "WARN"
                : rich
                  ? theme.muted("INFO")
                  : "INFO";
          lines.push(`[${ts}] ${sevLabel} ${ev.type}`);
          lines.push(`  ${ev.source}: ${ev.message}`);
          if (ev.remediation) {
            lines.push(
              rich ? `  ${theme.muted("Fix:")} ${ev.remediation}` : `  Fix: ${ev.remediation}`,
            );
          }
          if (ev.occurrences > 1) {
            lines.push(
              rich
                ? `  ${theme.muted(`(${ev.occurrences}x deduplicated)`)}`
                : `  (${ev.occurrences}x deduplicated)`,
            );
          }
          lines.push("");
        }

        defaultRuntime.log(lines.join("\n").trimEnd());
      },
    );
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
