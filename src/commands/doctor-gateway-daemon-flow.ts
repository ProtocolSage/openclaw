import fs from "node:fs/promises";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveGatewayPort } from "../config/config.js";
import {
  resolveGatewayLaunchAgentLabel,
  resolveNodeLaunchAgentLabel,
} from "../daemon/constants.js";
import { readLastGatewayErrorLine } from "../daemon/diagnostics.js";
import { execFileUtf8 } from "../daemon/exec-file.js";
import {
  isLaunchAgentListed,
  isLaunchAgentLoaded,
  launchAgentPlistExists,
  repairLaunchAgentBootstrap,
} from "../daemon/launchd.js";
import { describeGatewayServiceRestart, resolveGatewayService } from "../daemon/service.js";
import { renderSystemdUnavailableHints } from "../daemon/systemd-hints.js";
import { isSystemdUserServiceAvailable } from "../daemon/systemd.js";
import { formatPortDiagnostics, inspectPortUsage } from "../infra/ports.js";
import { isWSL } from "../infra/wsl.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { sleep } from "../utils.js";
import { buildGatewayInstallPlan, gatewayInstallErrorHint } from "./daemon-install-helpers.js";
import {
  DEFAULT_GATEWAY_DAEMON_RUNTIME,
  GATEWAY_DAEMON_RUNTIME_OPTIONS,
  type GatewayDaemonRuntime,
} from "./daemon-runtime.js";
import { buildGatewayRuntimeHints, formatGatewayRuntimeSummary } from "./doctor-format.js";
import type { DoctorOptions, DoctorPrompter } from "./doctor-prompter.js";
import { resolveGatewayInstallToken } from "./gateway-install-token.js";
import { formatHealthCheckFailure } from "./health-format.js";
import { healthCommand } from "./health.js";

async function maybeRepairLaunchAgentBootstrap(params: {
  env: Record<string, string | undefined>;
  title: string;
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
}): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  const listed = await isLaunchAgentListed({ env: params.env });
  if (!listed) {
    return false;
  }

  const loaded = await isLaunchAgentLoaded({ env: params.env });
  if (loaded) {
    return false;
  }

  const plistExists = await launchAgentPlistExists(params.env);
  if (!plistExists) {
    return false;
  }

  note("LaunchAgent is listed but not loaded in launchd.", `${params.title} LaunchAgent`);

  const shouldFix = await params.prompter.confirmSkipInNonInteractive({
    message: `Repair ${params.title} LaunchAgent bootstrap now?`,
    initialValue: true,
  });
  if (!shouldFix) {
    return false;
  }

  params.runtime.log(`Bootstrapping ${params.title} LaunchAgent...`);
  const repair = await repairLaunchAgentBootstrap({ env: params.env });
  if (!repair.ok) {
    params.runtime.error(
      `${params.title} LaunchAgent bootstrap failed: ${repair.detail ?? "unknown error"}`,
    );
    return false;
  }

  const verified = await isLaunchAgentLoaded({ env: params.env });
  if (!verified) {
    params.runtime.error(`${params.title} LaunchAgent still not loaded after repair.`);
    return false;
  }

  note(`${params.title} LaunchAgent repaired.`, `${params.title} LaunchAgent`);
  return true;
}

/** Read /etc/wsl.conf and return true if [boot] systemd=true is already set. */
async function checkWslSystemdEnabled(): Promise<boolean> {
  try {
    const content = await fs.readFile("/etc/wsl.conf", "utf8");
    let inBootSection = false;
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("[")) {
        inBootSection = line.toLowerCase() === "[boot]";
        continue;
      }
      if (!inBootSection) {
        continue;
      }
      const [key, ...rest] = line.split("=");
      if (key?.trim().toLowerCase() === "systemd" && rest.join("=").trim() === "true") {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Append or update [boot] systemd=true in /etc/wsl.conf.
 * Uses execFileUtf8 (no shell injection risk) via a temp file + sudo cp.
 */
async function applyWslSystemdPatch(): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile("/etc/wsl.conf", "utf8");
  } catch {
    // File doesn't exist yet
  }

  const lines = existing.split(/\r?\n/);
  let bootSectionIdx = -1;
  let systemdLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.toLowerCase() === "[boot]") {
      bootSectionIdx = i;
    }
    if (bootSectionIdx !== -1 && i > bootSectionIdx) {
      if (trimmed.startsWith("[") && i !== bootSectionIdx) {
        break;
      }
      const [key] = trimmed.split("=");
      if (key?.trim().toLowerCase() === "systemd") {
        systemdLineIdx = i;
        break;
      }
    }
  }

  let patched: string;
  if (systemdLineIdx !== -1) {
    lines[systemdLineIdx] = "systemd=true";
    patched = lines.join("\n");
  } else if (bootSectionIdx !== -1) {
    lines.splice(bootSectionIdx + 1, 0, "systemd=true");
    patched = lines.join("\n");
  } else {
    patched = (existing.trimEnd() ? `${existing.trimEnd()}\n\n` : "") + "[boot]\nsystemd=true\n";
  }

  const tmpPath = `/tmp/openclaw-wsl-conf-${process.pid}.tmp`;
  try {
    await fs.writeFile(tmpPath, patched, "utf8");
    const result = await execFileUtf8("sudo", ["cp", tmpPath, "/etc/wsl.conf"]);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "sudo cp failed");
    }
    note(
      "Updated /etc/wsl.conf with [boot] systemd=true.\nRun: wsl --shutdown (from PowerShell), then reopen your distro and rerun doctor.",
      "Gateway (WSL)",
    );
  } catch (err) {
    note(
      `Failed to write /etc/wsl.conf: ${String(err)}\nManually add:\n  [boot]\n  systemd=true\n...to /etc/wsl.conf, then run: wsl --shutdown`,
      "Gateway (WSL)",
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function maybeRepairGatewayDaemon(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  prompter: DoctorPrompter;
  options: DoctorOptions;
  gatewayDetailsMessage: string;
  healthOk: boolean;
}) {
  if (params.healthOk) {
    return;
  }

  const service = resolveGatewayService();
  // systemd can throw in containers/WSL; treat as "not loaded" and fall back to hints.
  let loaded = false;
  try {
    loaded = await service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  let serviceRuntime: Awaited<ReturnType<typeof service.readRuntime>> | undefined;
  if (loaded) {
    serviceRuntime = await service.readRuntime(process.env).catch(() => undefined);
  }

  if (process.platform === "darwin" && params.cfg.gateway?.mode !== "remote") {
    const gatewayRepaired = await maybeRepairLaunchAgentBootstrap({
      env: process.env,
      title: "Gateway",
      runtime: params.runtime,
      prompter: params.prompter,
    });
    await maybeRepairLaunchAgentBootstrap({
      env: {
        ...process.env,
        OPENCLAW_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      },
      title: "Node",
      runtime: params.runtime,
      prompter: params.prompter,
    });
    if (gatewayRepaired) {
      loaded = await service.isLoaded({ env: process.env });
      if (loaded) {
        serviceRuntime = await service.readRuntime(process.env).catch(() => undefined);
      }
    }
  }

  if (params.cfg.gateway?.mode !== "remote") {
    const port = resolveGatewayPort(params.cfg, process.env);
    const diagnostics = await inspectPortUsage(port);
    if (diagnostics.status === "busy") {
      note(formatPortDiagnostics(diagnostics).join("\n"), "Gateway port");
    } else if (loaded && serviceRuntime?.status === "running") {
      const lastError = await readLastGatewayErrorLine(process.env);
      if (lastError) {
        note(`Last gateway error: ${lastError}`, "Gateway");
      }
    }
  }

  if (!loaded) {
    if (process.platform === "linux") {
      const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
      if (!systemdAvailable) {
        const wsl = await isWSL();
        if (wsl) {
          const alreadyEnabled = await checkWslSystemdEnabled();
          if (alreadyEnabled) {
            note(
              "wsl.conf already has systemd=true but systemd is not running.\nRun: wsl --shutdown (from PowerShell), then reopen your distro.",
              "Gateway (WSL)",
            );
            return;
          }
          note(
            "WSL2 detected without systemd. The gateway requires systemd for background service operation.",
            "Gateway (WSL)",
          );
          const shouldFix = await params.prompter.confirmSkipInNonInteractive({
            message: "Enable systemd in /etc/wsl.conf? (requires sudo)",
            initialValue: true,
          });
          if (shouldFix) {
            await applyWslSystemdPatch();
          } else {
            note(renderSystemdUnavailableHints({ wsl: true }).join("\n"), "Gateway");
          }
          return;
        }
        note(renderSystemdUnavailableHints({ wsl: false }).join("\n"), "Gateway");
        return;
      }
    }
    note("Gateway service not installed.", "Gateway");
    if (params.cfg.gateway?.mode !== "remote") {
      const install = await params.prompter.confirmSkipInNonInteractive({
        message: "Install gateway service now?",
        initialValue: true,
      });
      if (install) {
        const daemonRuntime = await params.prompter.select<GatewayDaemonRuntime>(
          {
            message: "Gateway service runtime",
            options: GATEWAY_DAEMON_RUNTIME_OPTIONS,
            initialValue: DEFAULT_GATEWAY_DAEMON_RUNTIME,
          },
          DEFAULT_GATEWAY_DAEMON_RUNTIME,
        );
        const tokenResolution = await resolveGatewayInstallToken({
          config: params.cfg,
          env: process.env,
        });
        for (const warning of tokenResolution.warnings) {
          note(warning, "Gateway");
        }
        if (tokenResolution.unavailableReason) {
          note(
            [
              "Gateway service install aborted.",
              tokenResolution.unavailableReason,
              "Fix gateway auth config/token input and rerun doctor.",
            ].join("\n"),
            "Gateway",
          );
          return;
        }
        const port = resolveGatewayPort(params.cfg, process.env);
        const { programArguments, workingDirectory, environment } = await buildGatewayInstallPlan({
          env: process.env,
          port,
          runtime: daemonRuntime,
          warn: (message, title) => note(message, title),
          config: params.cfg,
        });
        try {
          await service.install({
            env: process.env,
            stdout: process.stdout,
            programArguments,
            workingDirectory,
            environment,
          });
        } catch (err) {
          note(`Gateway service install failed: ${String(err)}`, "Gateway");
          note(gatewayInstallErrorHint(), "Gateway");
        }
      }
    }
    return;
  }

  const summary = formatGatewayRuntimeSummary(serviceRuntime);
  const hints = buildGatewayRuntimeHints(serviceRuntime, {
    platform: process.platform,
    env: process.env,
  });
  if (summary || hints.length > 0) {
    const lines: string[] = [];
    if (summary) {
      lines.push(`Runtime: ${summary}`);
    }
    lines.push(...hints);
    note(lines.join("\n"), "Gateway");
  }

  if (serviceRuntime?.status !== "running") {
    const start = await params.prompter.confirmSkipInNonInteractive({
      message: "Start gateway service now?",
      initialValue: true,
    });
    if (start) {
      const restartResult = await service.restart({
        env: process.env,
        stdout: process.stdout,
      });
      const restartStatus = describeGatewayServiceRestart("Gateway", restartResult);
      if (!restartStatus.scheduled) {
        await sleep(1500);
      } else {
        note(restartStatus.message, "Gateway");
      }
    }
  }

  if (process.platform === "darwin") {
    const label = resolveGatewayLaunchAgentLabel(process.env.OPENCLAW_PROFILE);
    note(
      `LaunchAgent loaded; stopping requires "${formatCliCommand("openclaw gateway stop")}" or launchctl bootout gui/$UID/${label}.`,
      "Gateway",
    );
  }

  if (serviceRuntime?.status === "running") {
    const restart = await params.prompter.confirmSkipInNonInteractive({
      message: "Restart gateway service now?",
      initialValue: true,
    });
    if (restart) {
      const restartResult = await service.restart({
        env: process.env,
        stdout: process.stdout,
      });
      const restartStatus = describeGatewayServiceRestart("Gateway", restartResult);
      if (restartStatus.scheduled) {
        note(restartStatus.message, "Gateway");
        return;
      }
      await sleep(1500);
      try {
        await healthCommand({ json: false, timeoutMs: 10_000 }, params.runtime);
      } catch (err) {
        const message = String(err);
        if (message.includes("gateway closed")) {
          note("Gateway not running.", "Gateway");
          note(params.gatewayDetailsMessage, "Gateway connection");
        } else {
          params.runtime.error(formatHealthCheckFailure(err));
        }
      }
    }
  }
}
