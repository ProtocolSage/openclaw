# Step 4: Critical Vulnerability Fixes

**Status:** COMPLETED
**Date:** 2026-02-13
**Phase:** 2 - Skill & Plugin Hardening

---

## Summary

This step implemented comprehensive detection rules and blocking mode for the skill scanner to address critical AI agent security vulnerabilities identified in the threat model.

## Changes Made

### 1. Enhanced Detection Rules

Added 13 new detection patterns to `src/security/skill-scanner.ts`:

#### Sleeper Agent Detection (CVSS 8.1)

| Rule ID                       | Severity | Description                                                     |
| ----------------------------- | -------- | --------------------------------------------------------------- |
| `sleeper-agent-timer`         | critical | Detects setTimeout with delays >6 hours (literal or calculated) |
| `sleeper-agent-date-trigger`  | critical | Detects Date-based conditional triggers                         |
| `sleeper-agent-cron`          | critical | Detects cron/scheduling library imports                         |
| `sleeper-agent-promise-delay` | warn     | Detects Promise-based long delay patterns                       |

#### Container Escape Detection (CVSS 9.8)

| Rule ID                       | Severity | Description                                        |
| ----------------------------- | -------- | -------------------------------------------------- |
| `container-escape-docker`     | critical | Detects Docker socket access and dockerode imports |
| `container-escape-mount`      | critical | Detects nsenter, unshare, chroot commands          |
| `container-escape-caps`       | critical | Detects Linux capability manipulation              |
| `container-escape-namespace`  | critical | Detects namespace syscall references               |
| `container-escape-privileged` | critical | Detects --privileged flag usage                    |

#### Credential Harvesting Detection (CVSS 7.5)

| Rule ID                  | Severity | Description                                              |
| ------------------------ | -------- | -------------------------------------------------------- |
| `credential-file-access` | critical | Detects access to .aws/credentials, .ssh/, .gnupg/, etc. |
| `keychain-access`        | critical | Detects keytar, secret-service imports                   |
| `dns-exfiltration`       | critical | Detects DNS-based data exfiltration patterns             |
| `webhook-exfiltration`   | warn     | Detects webhook.site, requestbin, pipedream usage        |

### 2. Blocking Mode Implementation

Added `SecurityScanBlockedError` class that:

- Throws when critical findings are detected during plugin installation
- Provides detailed remediation information in error message
- Lists specific findings with file paths and line numbers
- Documents `--force-install` bypass option (not recommended)

### 3. Install Flow Integration

Modified `src/plugins/install.ts` to:

- Call `scanDirectoryWithSummary()` before installing any plugin
- Block installation if `scanSummary.critical > 0` (unless `--force-install`)
- Log warnings for non-critical findings
- Support `forceInstall` parameter for trusted sources

## Pattern Details

### sleeper-agent-timer (SOURCE_RULES)

Two patterns for comprehensive detection:

1. **Literal large delay:**

   ```regex
   /setTimeout[\s\S]*?,\s*(?:\d{9,}|[3-9]\d{7}|2[2-9]\d{6}|21[6-9]\d{5})/
   ```

   Matches setTimeout with literal delays >= 21600000ms (6 hours, multiline capable)

2. **Calculated delay:**
   ```regex
   /\d+\s*\*\s*\d+\s*\*\s*\d+\s*\*\s*1000\b/
   ```
   Matches patterns like `24 * 60 * 60 * 1000`

### sleeper-agent-cron & keychain-access (LINE_RULES)

Unified pattern supporting both CommonJS and ES module syntax:

```regex
/(?:require\s*\(\s*["']|import\s+(?:\w+\s+from\s+)?["'])(?:package-name)["']/
```

Matches:

- `require("package-name")`
- `import "package-name"`
- `import x from "package-name"`

## Test Coverage

All 58 tests pass in `src/security/skill-scanner.test.ts`:

- 13 scanSource basic tests
- 8 sleeper agent detection tests
- 11 container escape detection tests
- 13 credential harvesting detection tests
- 2 SecurityScanBlockedError tests
- 2 isScannable tests
- 4 scanDirectory tests
- 6 scanDirectoryWithSummary tests

## Files Modified

| File                            | Changes                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `src/security/skill-scanner.ts` | Added 13 detection rules, SecurityScanBlockedError class |
| `src/plugins/install.ts`        | Integrated blocking scan, added forceInstall parameter   |

## Verification Commands

```bash
# Run scanner tests (requires Node 22+)
source ~/.nvm/nvm.sh && nvm use 22
npx vitest run src/security/skill-scanner.test.ts

# Verify TypeScript compiles
npx tsc --noEmit
```

## Next Steps

Step 5 implementation details and backend policy hardening are documented in `.security-hardening/05-backend-hardening.md`.

## SECURITY.md Control Alignment (Step 4)

- `Required in Reports`: each critical fix package must include severity, impact, technical reproduction, and remediation evidence.
- `Security Scanning`: critical scanner detections are promoted from warn-only behavior to enforceable blocking controls.
- `Runtime Requirements > Node.js Version`: fix verification and CI enforcement require Node.js 22.12.0+.
