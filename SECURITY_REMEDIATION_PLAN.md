# Comprehensive Security Remediation Plan

**Document Version:** 1.1
**Created:** 2026-02-09
**Updated:** 2026-02-19
**Status:** ACTIVE - Phase 5 implementation plan updated for repository execution

---

## Executive Summary

This plan addresses critical vulnerabilities identified in AI agent ecosystems, specifically targeting:

1. **Sleeper Agents** - Dormant malicious code with delayed activation
2. **Container Escapes** - Sandbox breakout attacks
3. **Malware in Skills Hub** - Infected third-party skills
4. **API Key Leakage** - Credential exposure via chat logs and insecure storage
5. **Prompt Injection** - Semantic attacks via text files
6. **Credential Harvesting** - Exfiltration of secrets
7. **Manipulated Skill Charts** - Social engineering via fake popularity

---

## Phase 1: Immediate Actions (0-24 Hours)

### 1.1 API Key Rotation

**Priority:** CRITICAL
**Owner:** User
**Timeline:** Immediately

| Service       | Action                                  | Verification                                  |
| ------------- | --------------------------------------- | --------------------------------------------- |
| Anthropic     | Rotate API key at console.anthropic.com | Test with `openclaw doctor --probe-providers` |
| OpenAI        | Rotate at platform.openai.com           | Verify via health check                       |
| AWS           | Rotate IAM credentials                  | Run `aws sts get-caller-identity`             |
| Google/Gemini | Rotate at cloud.google.com              | Test API connectivity                         |
| Twilio        | Rotate Auth Token                       | Test WhatsApp connectivity                    |
| Discord       | Regenerate bot token                    | Reconnect bot                                 |
| Telegram      | Regenerate via BotFather                | Verify `/start` works                         |
| Slack         | Rotate bot + app tokens                 | Test slash commands                           |

**Implementation:**

```bash
# Update .env file with new keys
openclaw config set providers.anthropic.apiKey "<NEW_KEY>"
openclaw config set providers.openai.apiKey "<NEW_KEY>"

# Verify rotation worked
openclaw doctor --probe-providers
```

### 1.2 Chat Log Audit & Purge

**Priority:** CRITICAL
**Owner:** User
**Timeline:** Within 2 hours

**Risk:** API keys may have been exposed in chat logs when users pasted them directly.

**Actions:**

```bash
# 1. Locate all session logs
find ~/.openclaw -name "*.jsonl" -type f

# 2. Search for potential key exposure (DO NOT LOG OUTPUT)
grep -r "sk-ant-\|sk-\|xoxb-\|xapp-" ~/.openclaw/agents/*/sessions/ 2>/dev/null | wc -l

# 3. If matches found, delete affected session files
# WARNING: This deletes conversation history
rm -rf ~/.openclaw/agents/*/sessions/*.jsonl

# 4. Clear any cached credentials
openclaw cache clear
```

### 1.3 Security Audit Execution

**Priority:** HIGH
**Owner:** User
**Timeline:** Within 4 hours

```bash
# Run comprehensive security audit
openclaw doctor --security --deep

# Review all findings
openclaw security audit --output json > security-audit-$(date +%Y%m%d).json
```

---

## Phase 2: Skill & Plugin Hardening (24-72 Hours)

### 2.1 Skill Scanning Implementation

**Priority:** CRITICAL
**Owner:** Development Team
**Timeline:** 24 hours

The codebase already has a skill scanner at `src/security/skill-scanner.ts`. We need to:

**A. Enhance Detection Rules**

Add these new detection patterns to `LINE_RULES`:

```typescript
// Add to src/security/skill-scanner.ts

const ENHANCED_LINE_RULES: LineRule[] = [
  // Sleeper agent detection
  {
    ruleId: "sleeper-agent-timer",
    severity: "critical",
    message: "Delayed execution pattern detected (potential sleeper agent)",
    pattern: /setTimeout\s*\(\s*[^,]+,\s*(\d{6,}|[^)]*\*\s*1000\s*\*\s*60\s*\*\s*(60|24))/,
  },
  {
    ruleId: "sleeper-agent-date-trigger",
    severity: "critical",
    message: "Date-based trigger detected (potential sleeper agent)",
    pattern: /new\s+Date\(\)\.get(Month|Date|FullYear|Day)\(\)\s*[=<>!]+/,
  },
  {
    ruleId: "sleeper-agent-cron",
    severity: "warn",
    message: "Scheduled task pattern detected",
    pattern: /node-cron|node-schedule|agenda|bull|later\.parse/,
  },

  // Container escape detection
  {
    ruleId: "container-escape-docker",
    severity: "critical",
    message: "Docker socket access detected (container escape risk)",
    pattern: /\/var\/run\/docker\.sock|dockerode|docker\s+run/,
  },
  {
    ruleId: "container-escape-mount",
    severity: "critical",
    message: "Privileged mount operation detected",
    pattern: /mount\s+-o|nsenter|unshare|chroot/,
  },
  {
    ruleId: "container-escape-caps",
    severity: "critical",
    message: "Capability manipulation detected",
    pattern: /cap_sys_admin|cap_net_raw|setcap|getcap/i,
  },

  // Credential harvesting
  {
    ruleId: "credential-file-access",
    severity: "critical",
    message: "Credential file access pattern detected",
    pattern: /\.aws\/credentials|\.ssh\/|\.gnupg\/|\.netrc|\.npmrc/,
  },
  {
    ruleId: "keychain-access",
    severity: "critical",
    message: "System keychain access detected",
    pattern: /keytar|keychain|credential-manager|secret-service/,
  },

  // Network exfiltration
  {
    ruleId: "dns-exfiltration",
    severity: "critical",
    message: "DNS-based data exfiltration pattern detected",
    pattern: /dns\.resolve|\.dnsimple|\.cloudflare.*txt/i,
  },
  {
    ruleId: "webhook-exfiltration",
    severity: "warn",
    message: "External webhook call detected",
    pattern: /webhook\.site|requestbin|pipedream|hookbin/i,
  },
];
```

**B. Mandatory Skill Scanning**

Add pre-install hook in `src/plugins/install.ts`:

```typescript
// Before installing any skill/plugin
async function validateSkillSecurity(skillPath: string): Promise<void> {
  const scanResult = await scanDirectoryWithSummary(skillPath);

  if (scanResult.critical > 0) {
    throw new SecurityError(
      `BLOCKED: Skill contains ${scanResult.critical} critical security issues:\n` +
        scanResult.findings
          .filter((f) => f.severity === "critical")
          .map((f) => `  - ${f.ruleId}: ${f.message} (${f.file}:${f.line})`)
          .join("\n"),
    );
  }

  if (scanResult.warn > 0) {
    console.warn(
      `WARNING: Skill contains ${scanResult.warn} security warnings. ` +
        `Review before proceeding.`,
    );
  }
}
```

### 2.2 Skill Allowlist Implementation

**Priority:** HIGH
**Owner:** Development Team
**Timeline:** 48 hours

**Config Schema Update** (`src/config/types.plugins.ts`):

```typescript
export type PluginSecurityConfig = {
  /** Only allow skills from these sources */
  allowedSources?: ("local" | "verified" | "any")[];

  /** Explicit skill allowlist by ID or hash */
  allowlist?: string[];

  /** Block skills matching these patterns */
  blocklist?: string[];

  /** Require cryptographic signature verification */
  requireSignature?: boolean;

  /** Maximum age of skills before re-verification (days) */
  maxAgeBeforeRescan?: number;
};
```

### 2.3 Skill Integrity Verification

**Priority:** HIGH
**Owner:** Development Team
**Timeline:** 72 hours

Create `src/security/skill-integrity.ts`:

```typescript
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type SkillIntegrityRecord = {
  skillId: string;
  version: string;
  contentHash: string;
  scanHash: string;
  verifiedAt: number;
  scanResult: "clean" | "warning" | "blocked";
};

/**
 * Compute SHA-256 hash of all skill files
 */
export async function computeSkillHash(skillPath: string): Promise<string> {
  const files = await collectAllFiles(skillPath);
  const hasher = crypto.createHash("sha256");

  for (const file of files.sort()) {
    const content = await fs.readFile(file);
    hasher.update(file.replace(skillPath, ""));
    hasher.update(content);
  }

  return hasher.digest("hex");
}

/**
 * Verify skill hasn't been modified since last scan
 */
export async function verifySkillIntegrity(
  skillPath: string,
  record: SkillIntegrityRecord,
): Promise<{ valid: boolean; reason?: string }> {
  const currentHash = await computeSkillHash(skillPath);

  if (currentHash !== record.contentHash) {
    return {
      valid: false,
      reason: "Skill content has been modified since last verification",
    };
  }

  const ageMs = Date.now() - record.verifiedAt;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  if (ageMs > maxAgeMs) {
    return {
      valid: false,
      reason: "Skill verification has expired, rescan required",
    };
  }

  return { valid: true };
}
```

---

## Phase 3: Container Security Hardening (72 Hours - 1 Week)

### 3.1 Enhanced Sandbox Configuration

**Priority:** HIGH
**Owner:** Development Team
**Timeline:** 72 hours

Update default sandbox settings in `src/config/defaults.ts`:

```typescript
export const HARDENED_SANDBOX_DEFAULTS: SandboxDockerSettings = {
  // Use minimal base image
  image: "openclaw/sandbox:hardened",

  // Read-only root filesystem
  readOnlyRoot: true,

  // Isolated network
  network: "none",

  // Drop ALL capabilities
  capDrop: ["ALL"],

  // Strict resource limits
  pidsLimit: 100,
  memory: "512m",
  memorySwap: "512m",
  cpus: 0.5,

  // Seccomp profile blocks dangerous syscalls
  seccompProfile: "openclaw-strict",

  // AppArmor confinement
  apparmorProfile: "openclaw-sandbox",

  // No DNS (prevents DNS exfiltration)
  dns: [],

  // Strict ulimits
  ulimits: {
    nofile: { soft: 1024, hard: 2048 },
    nproc: { soft: 50, hard: 100 },
    core: 0, // Disable core dumps
  },
};
```

### 3.2 Container Escape Detection

**Priority:** CRITICAL
**Owner:** Development Team
**Timeline:** 1 week

Create `src/security/container-monitor.ts`:

```typescript
import { spawn } from "node:child_process";

export type ContainerEscapeIndicator = {
  type: "process" | "file" | "network" | "mount";
  severity: "critical" | "warn";
  description: string;
  evidence: string;
};

/**
 * Monitor for container escape attempts
 */
export async function detectContainerEscape(
  containerId: string,
): Promise<ContainerEscapeIndicator[]> {
  const indicators: ContainerEscapeIndicator[] = [];

  // Check for processes outside container namespace
  const hostProcesses = await checkHostProcessAccess(containerId);
  if (hostProcesses.length > 0) {
    indicators.push({
      type: "process",
      severity: "critical",
      description: "Container process accessing host namespace",
      evidence: hostProcesses.join(", "),
    });
  }

  // Check for sensitive file access
  const fileAccess = await checkSensitiveFileAccess(containerId);
  if (fileAccess.length > 0) {
    indicators.push({
      type: "file",
      severity: "critical",
      description: "Container accessing host files",
      evidence: fileAccess.join(", "),
    });
  }

  // Check for network escape (container talking to host)
  const networkEscape = await checkNetworkEscape(containerId);
  if (networkEscape) {
    indicators.push({
      type: "network",
      severity: "critical",
      description: "Container established connection to host",
      evidence: networkEscape,
    });
  }

  return indicators;
}

/**
 * Kill container immediately if escape detected
 */
export async function emergencyContainerKill(containerId: string): Promise<void> {
  await spawn("docker", ["kill", "--signal=SIGKILL", containerId]);
  await spawn("docker", ["rm", "-f", containerId]);

  // Log security incident
  console.error(`[SECURITY] Container ${containerId} killed due to escape attempt`);
}
```

### 3.3 Seccomp Profile for Sandbox

Create `docker/seccomp/openclaw-strict.json`:

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "archMap": [{ "architecture": "SCMP_ARCH_X86_64", "subArchitectures": ["SCMP_ARCH_X86"] }],
  "syscalls": [
    {
      "names": [
        "read",
        "write",
        "open",
        "close",
        "stat",
        "fstat",
        "lstat",
        "poll",
        "lseek",
        "mmap",
        "mprotect",
        "munmap",
        "brk",
        "rt_sigaction",
        "rt_sigprocmask",
        "ioctl",
        "access",
        "pipe",
        "dup",
        "dup2",
        "nanosleep",
        "getpid",
        "socket",
        "connect",
        "sendto",
        "recvfrom",
        "shutdown",
        "bind",
        "getsockname",
        "getpeername",
        "socketpair",
        "setsockopt",
        "getsockopt",
        "clone",
        "fork",
        "vfork",
        "execve",
        "exit",
        "wait4",
        "kill",
        "uname",
        "fcntl",
        "flock",
        "fsync",
        "fdatasync",
        "getcwd",
        "chdir",
        "rename",
        "mkdir",
        "rmdir",
        "unlink",
        "readlink",
        "chmod",
        "chown",
        "umask",
        "gettimeofday",
        "getrlimit",
        "getrusage",
        "times",
        "getuid",
        "getgid",
        "geteuid",
        "getegid",
        "setuid",
        "setgid",
        "getgroups",
        "setgroups",
        "getpgrp",
        "setpgid",
        "setsid",
        "getppid",
        "arch_prctl",
        "futex",
        "epoll_create",
        "epoll_ctl",
        "epoll_wait",
        "clock_gettime",
        "exit_group",
        "openat",
        "newfstatat",
        "readlinkat",
        "faccessat",
        "pread64",
        "pwrite64",
        "getrandom",
        "memfd_create",
        "copy_file_range"
      ],
      "action": "SCMP_ACT_ALLOW"
    },
    {
      "names": [
        "ptrace",
        "process_vm_readv",
        "process_vm_writev",
        "mount",
        "umount2",
        "pivot_root",
        "chroot",
        "setns",
        "unshare",
        "keyctl",
        "add_key",
        "request_key",
        "init_module",
        "finit_module",
        "delete_module",
        "kexec_load",
        "kexec_file_load",
        "reboot",
        "swapon",
        "swapoff",
        "acct",
        "settimeofday",
        "adjtimex",
        "clock_adjtime",
        "lookup_dcookie",
        "perf_event_open",
        "fanotify_init",
        "name_to_handle_at",
        "open_by_handle_at",
        "bpf",
        "userfaultfd"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
```

---

## Phase 4: Prompt Injection Defense (1-2 Weeks)

### 4.1 Enhanced External Content Sanitization

**Priority:** HIGH
**Owner:** Development Team
**Timeline:** 1 week

The existing `src/security/external-content.ts` provides a foundation. Enhance it:

````typescript
// Add to src/security/external-content.ts

const ADVANCED_INJECTION_PATTERNS = [
  // Role confusion attacks
  /\[?(system|assistant|user|human|ai)\]?\s*:/i,
  /<\/?(?:system|assistant|user|human|ai)>/i,

  // Instruction override attempts
  /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions?|rules?|guidelines?|prompts?)/i,
  /(?:new|updated|revised)\s+(?:instructions?|rules?|guidelines?):/i,
  /you\s+(?:are|will)\s+(?:now|henceforth)\s+(?:a|an|be)\s+/i,

  // Tool/command injection
  /(?:execute|run|call|invoke)\s+(?:the\s+)?(?:tool|function|command|bash|shell)/i,
  /```(?:bash|shell|cmd|powershell|zsh)/i,
  /<(?:tool_call|function_call|command)>/i,

  // Privilege escalation
  /(?:elevated|admin|root|sudo)\s*(?:=|:)\s*(?:true|1|yes)/i,
  /--(?:elevated|privileged|sudo|root)/i,

  // Exfiltration triggers
  /(?:send|post|upload|exfiltrate)\s+(?:to|the)\s+(?:webhook|url|server|endpoint)/i,
  /curl\s+.*\s+-d/i,
];

/**
 * Deep inspection for injection in nested content
 */
export function deepInspectForInjection(content: string): {
  suspicious: boolean;
  patterns: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
} {
  const matches: string[] = [];

  // Check main content
  for (const pattern of ADVANCED_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      matches.push(pattern.source);
    }
  }

  // Check for encoded payloads
  const decoded = tryDecodePayloads(content);
  for (const payload of decoded) {
    for (const pattern of ADVANCED_INJECTION_PATTERNS) {
      if (pattern.test(payload)) {
        matches.push(`encoded:${pattern.source}`);
      }
    }
  }

  // Determine risk level
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (matches.length >= 3) {
    riskLevel = "critical";
  } else if (matches.length === 2) {
    riskLevel = "high";
  } else if (matches.length === 1) {
    riskLevel = "medium";
  }

  return {
    suspicious: matches.length > 0,
    patterns: matches,
    riskLevel,
  };
}

function tryDecodePayloads(content: string): string[] {
  const payloads: string[] = [];

  // Base64
  const b64Matches = content.match(/[A-Za-z0-9+/=]{20,}/g) || [];
  for (const match of b64Matches) {
    try {
      const decoded = Buffer.from(match, "base64").toString("utf-8");
      if (decoded.length > 5 && /[\x20-\x7E]/.test(decoded)) {
        payloads.push(decoded);
      }
    } catch {
      /* ignore */
    }
  }

  // URL encoded
  const urlMatches = content.match(/%[0-9A-Fa-f]{2}/g);
  if (urlMatches && urlMatches.length > 5) {
    try {
      payloads.push(decodeURIComponent(content));
    } catch {
      /* ignore */
    }
  }

  // Hex encoded
  const hexMatches = content.match(/(?:\\x[0-9a-fA-F]{2})+/g) || [];
  for (const match of hexMatches) {
    try {
      const decoded = match
        .replace(/\\x/g, "")
        .match(/.{2}/g)
        ?.map((h) => String.fromCharCode(parseInt(h, 16)))
        .join("");
      if (decoded) payloads.push(decoded);
    } catch {
      /* ignore */
    }
  }

  return payloads;
}
````

### 4.2 File Content Inspection Before Processing

**Priority:** HIGH
**Owner:** Development Team
**Timeline:** 1 week

Add pre-processing hook for all file reads:

```typescript
// Add to src/tools/file-read.ts

import { deepInspectForInjection } from "../security/external-content.js";

export async function safeReadFile(
  filePath: string,
  options?: { allowUntrusted?: boolean },
): Promise<{ content: string; warnings: string[] }> {
  const content = await fs.readFile(filePath, "utf-8");
  const warnings: string[] = [];

  // Inspect for injection patterns
  const inspection = deepInspectForInjection(content);

  if (inspection.riskLevel === "critical") {
    if (!options?.allowUntrusted) {
      throw new SecurityError(
        `File contains critical security risk patterns: ${inspection.patterns.join(", ")}`,
      );
    }
    warnings.push(
      `CRITICAL: File may contain prompt injection. Patterns: ${inspection.patterns.join(", ")}`,
    );
  } else if (inspection.riskLevel === "high") {
    warnings.push(`WARNING: File contains suspicious patterns: ${inspection.patterns.join(", ")}`);
  }

  return { content, warnings };
}
```

---

## Phase 5: Credential Protection (1 Week)

**Priority:** CRITICAL  
**Owner:** Development Team  
**Status (as of 2026-02-19):** In progress - core implementation landed; full-suite validation + channel-wide runtime verification pending  
**Goal:** eliminate plaintext credential persistence paths where feasible, tighten read/write access controls, and guarantee redaction coverage across logs, status surfaces, and transcript-derived outputs.

### 5.1 Current Baseline (Already Implemented)

The repository already contains foundational protections that this phase must extend rather than replace:

- `src/agents/auth-profiles/store.ts` persists credentials in `auth-profiles.json` with lock-based writes.
- `src/security/audit-extra.async.ts` checks filesystem permissions for credentials and session stores.
- `src/security/fix.ts` applies chmod/ACL tightening for state, credentials, auth profiles, and sessions.
- `src/logging/redact.ts` provides token/pattern redaction with configurable modes and patterns.
- `src/security/audit.ts` flags `logging.redactSensitive="off"` and several secrets-in-config findings.

### 5.2 Scope of Phase 5

1. Introduce a credential vault abstraction for runtime secret material.
2. Migrate on-disk credential records from plaintext payloads to references where supported.
3. Expand redaction coverage so sensitive strings do not leak through log, gateway, or transcript-adjacent outputs.
4. Add explicit audit and fix support for credential migration state and stale secret hygiene.

### 5.2.1 Implementation Snapshot (Current Branch)

Implemented:

- Vault-backed auth profile writes + resolution paths (`src/agents/auth-profiles/profiles.ts`, `src/agents/auth-profiles/oauth.ts`, `src/agents/auth-profiles/order.ts`, `src/agents/auth-profiles/vault.ts`).
- Auth-profile plaintext migration utility (`migratePlaintextAuthProfileSecretsToVault` in `src/agents/auth-profiles/store.ts`).
- Credential vault audit trail wiring for read/write/rotate/delete/list (`src/security/credential-vault.ts` + `src/security/credential-audit.ts`).
- `openclaw security credentials` CLI surface:
  - `status`
  - `migrate`
  - `rotate`
    (`src/cli/security-cli.ts`)
- Security audit checks for plaintext auth-profile secrets, vault ref integrity, and vault permission posture (`src/security/audit.ts`).
- Security fix extensions for vault chmod hardening + auth-profile secret migration (`src/security/fix.ts`).
- Redaction mode expansion to include `all`, plus full-log redaction wiring through console capture/file logger (`src/config/types.base.ts`, `src/config/zod-schema.ts`, `src/logging/redact.ts`, `src/logging/console.ts`, `src/logging/logger.ts`).
- Startup environment credential exposure warning path (`src/index.ts` + `src/security/credential-env-scan.ts`).

Remaining from this phase plan:

1. Run full validation on a Node 22.12+ runtime with the full repo dependency set:
   - `pnpm check`
   - `pnpm build`
   - `pnpm test`
2. Perform explicit cross-channel runtime verification (core + extension channels) for credential resolution and redaction behavior.
3. Add/expand dedicated tests for new security CLI commands and new audit findings if gaps remain after full-suite execution.

### 5.3 Workstream A: Credential Vault Architecture

Create `src/security/credential-vault.ts` and `src/security/credential-vault.backends.ts` with:

- `CredentialScope`: `provider`, `channel`, `integration`, `internal`
- `VaultRef`: stable reference object persisted in config/auth stores (no raw secret)
- API:
  - `storeCredential(scope, name, value)`
  - `getCredential(scope, name, requestor)`
  - `deleteCredential(scope, name)`
  - `rotateCredential(scope, name, nextValue)`
  - `listCredentialMetadata()`

Backend strategy:

- macOS: system keychain via existing `security` CLI pattern already used in `src/agents/cli-credentials.ts`.
- Linux/Windows fallback: encrypted local vault file in the credentials dir with strict perms (`0600` file, `0700` dir), using process-local key material and explicit warning if OS keyring is unavailable.
- No secret values in logs; only scope/name and hashed IDs for observability.

### 5.4 Workstream B: Auth Store Refactor and Migration

Primary files:

- `src/agents/auth-profiles/types.ts`
- `src/agents/auth-profiles/store.ts`
- `src/agents/model-auth.ts`
- onboarding/auth command flows under `src/commands/`

Plan:

1. Extend auth profile types to support a vault reference payload.
2. Implement read compatibility for both legacy plaintext and new vault-ref records.
3. Implement one-way writes to vault-ref once migration is enabled.
4. Add migration routine:
   - scan `auth-profiles.json`
   - store secrets in vault
   - replace plaintext with refs atomically
   - preserve non-secret metadata
5. Keep rollback path: if migration fails mid-run, keep original file intact and emit actionable error.

Migration policy:

- Default: explicit command (`openclaw security credentials migrate`) in first rollout.
- Optional follow-up release: automatic migration on startup after soak period.

### 5.5 Workstream C: Redaction Hardening

Primary files:

- `src/logging/redact.ts`
- `src/logging/console.ts`
- `src/gateway/ws-log.ts`
- `src/memory/session-files.ts`
- `src/config/redact-snapshot.ts`

Tasks:

1. Expand default redaction patterns for provider/channel/integration token formats already used by OpenClaw.
2. Add redaction mode extension (`off`, `tools`, `all`) and wire config schema/types/defaults.
3. Apply redaction consistently before file log writes and gateway WS diagnostic formatting.
4. Validate that redacted config snapshots and session-derived previews never expose raw credentials.

### 5.6 Workstream D: Security Audit, Fix, and CLI Operations

Primary files:

- `src/security/audit.ts`
- `src/security/audit-extra.sync.ts`
- `src/security/fix.ts`
- `src/cli/security-cli.ts`

Additions:

- New audit checks:
  - plaintext credentials present in auth profile store
  - vault backend unavailable/degraded
  - migrated vs non-migrated credential ratio
  - optional credential age warnings
- Fix path:
  - run migration
  - enforce permissions for any vault artifacts
- CLI commands:
  - `openclaw security credentials status`
  - `openclaw security credentials migrate`
  - `openclaw security credentials rotate --scope <scope> --name <name>`

### 5.7 Cross-Channel and Extension Impact

Any shared credential loading or redaction changes must be validated across:

- Core channels: Telegram, Discord, Slack, Signal, iMessage, Web/WhatsApp (`src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`)
- Channel/plugin framework surfaces in `src/channels` and `src/routing`
- Installed extension channels under `extensions/*` that consume shared auth/redaction helpers

### 5.8 Testing and Acceptance Gates

Required tests:

1. Unit tests for vault APIs, backend fallback behavior, and migration routines.
2. Regression tests for redaction patterns and config snapshot redaction.
3. E2E tests for auth resolution after migration (`resolveApiKeyForProvider` paths).
4. Security audit tests for new findings and fix behavior.

Required CI commands before merge:

```bash
pnpm check
pnpm build
pnpm test
```

Success criteria for Phase 5:

- 0 plaintext API keys/tokens in migrated `auth-profiles.json` files.
- 0 audit critical findings related to credential file permissions.
- Redaction enabled by default and verified on log + WS diagnostic paths.
- Migration and rotation operations are idempotent and recoverable.

### 5.9 Execution Plan (One-Week Breakdown)

- Day 1: vault interfaces + backend scaffolding + schema/type updates.
- Day 2: auth profile read/write compatibility + migration engine.
- Day 3: model auth and onboarding integration + migration tests.
- Day 4: redaction mode/pattern expansion + gateway/log wiring.
- Day 5: audit/fix/CLI commands + cross-channel validation + final test pass.

---

## Phase 6: Monitoring & Alerting (2-4 Weeks)

### 6.1 Security Event Logging

```typescript
// src/security/security-events.ts

export type SecurityEvent = {
  type:
    | "skill_scan_failed"
    | "container_escape_attempt"
    | "credential_access"
    | "injection_detected"
    | "unauthorized_network"
    | "suspicious_process";
  severity: "info" | "warn" | "critical";
  timestamp: number;
  details: Record<string, unknown>;
  remediation?: string;
};

const securityEventLog: SecurityEvent[] = [];

export function logSecurityEvent(event: Omit<SecurityEvent, "timestamp">): void {
  const fullEvent: SecurityEvent = {
    ...event,
    timestamp: Date.now(),
  };

  securityEventLog.push(fullEvent);

  // Console output for immediate visibility
  const prefix =
    event.severity === "critical"
      ? "[CRITICAL SECURITY]"
      : event.severity === "warn"
        ? "[SECURITY WARN]"
        : "[SECURITY]";

  console.log(`${prefix} ${event.type}: ${JSON.stringify(event.details)}`);

  // If critical, trigger immediate notification
  if (event.severity === "critical") {
    triggerSecurityAlert(fullEvent);
  }
}

async function triggerSecurityAlert(event: SecurityEvent): Promise<void> {
  // Desktop notification
  const { Notification } = await import("node-notifier");
  new Notification().notify({
    title: "OpenClaw Security Alert",
    message: `${event.type}: ${JSON.stringify(event.details).slice(0, 100)}`,
    sound: true,
    urgency: "critical",
  });
}
```

### 6.2 Periodic Security Scans

```typescript
// src/security/scheduled-scans.ts

export async function runScheduledSecurityScan(): Promise<void> {
  console.log("[security] Starting scheduled security scan...");

  // 1. Scan all installed skills
  const skillsDir = path.join(await resolveStateDir(), "extensions");
  const skillScan = await scanDirectoryWithSummary(skillsDir);

  if (skillScan.critical > 0) {
    logSecurityEvent({
      type: "skill_scan_failed",
      severity: "critical",
      details: {
        findings: skillScan.findings.filter((f) => f.severity === "critical"),
      },
      remediation: "Remove or quarantine affected skills immediately",
    });
  }

  // 2. Check credential age
  const credentials = await listStoredCredentials();
  for (const cred of credentials) {
    const ageMs = Date.now() - cred.createdAt;
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

    if (ageMs > maxAgeMs) {
      logSecurityEvent({
        type: "credential_access",
        severity: "warn",
        details: {
          credential: cred.name,
          ageHours: Math.round(ageMs / 3600000),
        },
        remediation: "Rotate this credential",
      });
    }
  }

  // 3. Run full security audit
  const auditResult = await runSecurityAudit({
    config: await loadConfig(),
    includeFilesystem: true,
    includeChannelSecurity: true,
    deep: false,
  });

  console.log(
    `[security] Scan complete: ${auditResult.summary.critical} critical, ` +
      `${auditResult.summary.warn} warnings`,
  );
}
```

---

## Phase 7: User Education & Process (Ongoing)

### 7.1 Security Documentation

Create `docs/security/best-practices.md`:

```markdown
# OpenClaw Security Best Practices

## API Key Management

1. **NEVER paste API keys in chat**
   - Use environment variables: `export ANTHROPIC_API_KEY=...`
   - Or config file: `openclaw config set providers.anthropic.apiKey`

2. **Rotate keys regularly**
   - Monthly rotation recommended
   - Immediate rotation if any exposure suspected

3. **Set spending limits**
   - Configure low API limits initially
   - Use prepaid/limited cards for testing

## Skill Safety

1. **Build your own skills** when possible
2. **Always scan before installing**: `openclaw skill scan <path>`
3. **Review code manually** for any downloaded skills
4. **Check skill signatures** and publisher reputation
5. **Use allowlists** to restrict which skills can run

## Chat Log Hygiene

1. **Enable log redaction**: `openclaw config set logging.redactSensitive on`
2. **Clear old logs**: `openclaw logs prune --older-than 30d`
3. **Never share raw session files**

## Container Security

1. **Keep sandbox enabled**: `openclaw config set agents.defaults.sandbox.mode all`
2. **Use network isolation**: `openclaw config set sandbox.docker.network none`
3. **Limit container resources**
```

### 7.2 Pre-flight Security Checklist

Create `docs/security/checklist.md`:

```markdown
# Security Checklist

## Before First Use

- [ ] All API keys stored in .env or config (not chat)
- [ ] `logging.redactSensitive` is `on`
- [ ] Sandbox mode is enabled
- [ ] Security audit passes: `openclaw doctor --security`

## Weekly

- [ ] Review security audit output
- [ ] Check for unusual skill activity
- [ ] Verify no credentials in chat logs

## Monthly

- [ ] Rotate all API keys
- [ ] Update OpenClaw to latest version
- [ ] Re-scan all installed skills
- [ ] Prune old session logs
```

---

## Implementation Timeline

| Phase                       | Priority | Timeline     | Status                            |
| --------------------------- | -------- | ------------ | --------------------------------- |
| 1. Immediate Actions        | CRITICAL | 0-24 hours   | Pending                           |
| 2. Skill Hardening          | CRITICAL | 24-72 hours  | **COMPLETED**                     |
| 3. Container Security       | HIGH     | 72h - 1 week | **COMPLETED**                     |
| 4. Prompt Injection Defense | HIGH     | 1-2 weeks    | Pending                           |
| 5. Credential Protection    | CRITICAL | 1 week       | Planned (spec updated 2026-02-19) |
| 6. Monitoring & Alerting    | MEDIUM   | 2-4 weeks    | Pending                           |
| 7. User Education           | MEDIUM   | Ongoing      | Pending                           |

---

## Phase 2 Implementation Details (COMPLETED)

**Implemented:** 2026-02-11
**Files Modified:**

- `src/security/skill-scanner.ts`
- `src/plugins/install.ts`
- `src/security/skill-scanner.test.ts`

### 2.1 Enhanced Detection Rules (13 New Rules)

#### Sleeper Agent Detection (4 Rules)

| Rule ID                       | Severity | Description                                                     |
| ----------------------------- | -------- | --------------------------------------------------------------- |
| `sleeper-agent-timer`         | CRITICAL | Detects setTimeout with delays >6 hours (86400000ms+)           |
| `sleeper-agent-date-trigger`  | CRITICAL | Detects Date().getMonth/getDate/getFullYear comparisons         |
| `sleeper-agent-cron`          | CRITICAL | Detects cron libraries (node-cron, node-schedule, agenda, bull) |
| `sleeper-agent-promise-delay` | WARN     | Detects Promise-based long delay patterns                       |

#### Container Escape Detection (5 Rules)

| Rule ID                       | Severity | Description                                                     |
| ----------------------------- | -------- | --------------------------------------------------------------- |
| `container-escape-docker`     | CRITICAL | Detects Docker socket access or dockerode package               |
| `container-escape-mount`      | CRITICAL | Detects nsenter, unshare, chroot, pivot_root commands           |
| `container-escape-caps`       | CRITICAL | Detects capability manipulation (setcap, getcap, CAP_SYS_ADMIN) |
| `container-escape-namespace`  | CRITICAL | Detects namespace syscall references (CLONE_NEWNS, setns)       |
| `container-escape-privileged` | CRITICAL | Detects --privileged flag or privileged: true config            |

#### Credential Harvesting Detection (4 Rules)

| Rule ID                  | Severity | Description                                                              |
| ------------------------ | -------- | ------------------------------------------------------------------------ |
| `credential-file-access` | CRITICAL | Detects access to .aws/credentials, .ssh/, .gnupg/, .npmrc, .kube/config |
| `keychain-access`        | CRITICAL | Detects keytar, secret-service, credential-manager packages              |
| `dns-exfiltration`       | CRITICAL | Detects DNS-based data exfiltration patterns                             |
| `webhook-exfiltration`   | WARN     | Detects webhook.site, requestbin, pipedream endpoints                    |

### 2.2 Blocking Mode Implementation

**Previous Behavior:** Warn-only, never blocked installation
**New Behavior:** Critical findings BLOCK installation by default

#### SecurityScanBlockedError

New error class thrown when critical findings are detected:

```typescript
export class SecurityScanBlockedError extends Error {
  public readonly findings: SkillScanFinding[];
  public readonly pluginId: string;
}
```

#### Force Install Bypass

All installation functions now accept `forceInstall?: boolean` parameter:

- `installPluginFromArchive()`
- `installPluginFromDir()`
- `installPluginFromNpmSpec()`
- `installPluginFromPath()`

When `forceInstall: true`:

- Logs SECURITY BYPASS warning
- Continues installation despite critical findings
- Recommends running security audit after install

### 2.3 Test Coverage

Added 35+ new test cases covering:

- All 13 new detection rules
- SecurityScanBlockedError behavior
- False positive prevention for legitimate code

### Expected Detection Rates

| Threat Category       | Target Detection Rate | Coverage |
| --------------------- | --------------------- | -------- |
| Sleeper Agents        | 80-95%                | 4 rules  |
| Container Escape      | 85-95%                | 5 rules  |
| Credential Harvesting | 75-90%                | 4 rules  |

---

## Success Metrics

| Metric                              | Target    | Measurement                  |
| ----------------------------------- | --------- | ---------------------------- |
| Critical findings in security audit | 0         | `openclaw doctor --security` |
| Skills with unscanned status        | 0         | Skill registry check         |
| API keys older than 30 days         | 0         | Credential age audit         |
| Chat logs with unredacted secrets   | 0         | Log scan                     |
| Container escape incidents          | 0         | Security event log           |
| Prompt injection detections         | Monitored | Security event log           |

---

## Appendix A: Emergency Response

### If Credential Exposure Detected

```bash
# 1. Immediately rotate all keys
openclaw security rotate-all-credentials

# 2. Clear all session logs
rm -rf ~/.openclaw/agents/*/sessions/*.jsonl

# 3. Run deep security audit
openclaw doctor --security --deep

# 4. Check for unauthorized usage
# (Check provider dashboards for unusual activity)
```

### If Sleeper Agent Detected

```bash
# 1. Kill all running agents
pkill -9 -f openclaw

# 2. Disable all skills
mv ~/.openclaw/extensions ~/.openclaw/extensions.quarantine

# 3. Run skill scan on quarantined directory
openclaw security scan ~/.openclaw/extensions.quarantine

# 4. Only restore verified-clean skills
```

### If Container Escape Detected

```bash
# 1. Stop all containers
docker stop $(docker ps -q --filter "name=openclaw-sandbox")

# 2. Remove potentially compromised containers
docker rm -f $(docker ps -aq --filter "name=openclaw-sandbox")

# 3. Consider full system audit/wipe if host compromise suspected
```

---

**Document prepared by:** Security Remediation Task Force
**Review required by:** Development Lead, Security Lead
**Next review date:** 30 days after implementation
