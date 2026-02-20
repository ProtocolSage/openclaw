# Step 9: Credential Protection (Phase 5)

**Status:** COMPLETED — Full Integration
**Date:** 2026-02-19
**Phase:** 5 - Credential Protection

---

## Summary

This phase implements comprehensive credential protection to address CVSS 7.5 threats:

- API key leakage via chat logs
- Credential file access by malicious skills
- System keychain harvesting
- Environment variable exposure

Phase 5 is fully integrated end-to-end: vault storage, auth profile migration, CLI commands, audit wiring, startup scanner, and full-log redaction.

---

## Core Components

### 1. Credential Vault (`src/security/credential-vault.ts`)

**Scoped credential storage with audit wiring.**

| Feature                  | Description                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- |
| **Scope Isolation**      | `provider`, `channel`, `integration`, `internal` scopes enforced                 |
| **Keychain Integration** | macOS Keychain via `security` CLI (`execFileSync`), file fallback on Linux/Win   |
| **Audit Integration**    | Every vault op calls `safeLogCredentialAccess()` for tamper-evident audit trail  |
| **Hash Verification**    | SHA-256 hash prefix stored with each credential for identity verification        |
| **Rotation Support**     | `rotateCredential()` with full audit trail; `getCredentialsDueForRotation()` API |

### 2. Auth Profile Vault Integration (`src/agents/auth-profiles/vault.ts` + `store.ts`)

**Vault-backed auth profiles replacing plaintext credential storage.**

| Feature        | Description                                                                |
| -------------- | -------------------------------------------------------------------------- |
| **Vault Refs** | Auth profiles store `vault://scope/name` refs instead of plaintext secrets |
| **Migration**  | `migratePlaintextAuthProfileSecretsToVault()` for seamless migration       |
| **Dry-Run**    | `{ dryRun: true }` mode counts pending plaintext secrets without mutating  |
| **Resolver**   | `resolveAuthProfileSecret()` auto-resolves vault refs at runtime           |

### 3. Credential Audit (`src/security/credential-audit.ts`)

**Tamper-evident audit trail with hash chain verification.**

| Feature              | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| **Hash Chain**       | Each entry links to previous via SHA-256 hash              |
| **Tamper Detection** | `verifyAuditLogIntegrity()` detects any modification       |
| **Query Filtering**  | Filter by credential, scope, action, requestor, time range |
| **Export Formats**   | JSON and CSV export for forensics                          |

### 4. Environment Scanner (`src/security/credential-env-scan.ts`)

**Startup scan for exposed credentials with migration support.**

25+ detection patterns across LLM providers, messaging channels, cloud, databases, and integrations.

### 5. Redaction Enhancement (`src/logging/redact.ts` + `console.ts`)

**Full-log redaction mode added alongside existing tool-summary mode.**

| Mode    | Description                                                        |
| ------- | ------------------------------------------------------------------ |
| `off`   | No redaction                                                       |
| `tools` | Redact tool/status output only (existing behavior)                 |
| `all`   | Redact ALL console and file log output via `shouldRedactAllLogs()` |

`console.ts` forward() function checks `shouldRedactAllLogs()` and applies redaction to all log lines before output.

### 6. Security CLI Credentials (`src/cli/security-cli.ts`)

**Three new subcommands under `openclaw security credentials`:**

| Command   | Description                                                                   |
| --------- | ----------------------------------------------------------------------------- |
| `status`  | Show vault entry counts, audit integrity, pending plaintext secrets, env scan |
| `migrate` | Migrate auth profile plaintext + optionally env credentials to vault          |
| `rotate`  | Rotate a specific vault credential by name/scope with new value               |

### 7. Security Audit Vault Checks (`src/security/audit.ts`)

`collectCredentialVaultFindings()` added to `runSecurityAudit()`:

- Vault directory permission checks (0o700 required)
- Vault file permission checks (credentials.json, registry.json, audit.jsonl — 0o600)
- Plaintext auth profile detection across all agent dirs
- Invalid vault ref detection
- Missing vault entry detection
- macOS file fallback warning

### 8. Security Fix Vault Hardening (`src/security/fix.ts`)

`fixSecurityFootguns()` extended with:

- `chmodCredentialVaultState()` — 0o700 vault dir, 0o600 all vault files
- `migrateAuthProfileSecretsForAllAgents()` — runs migration across all agent dirs

### 9. Startup Env Scanner (`src/index.ts`)

`maybeWarnOnExposedEnvCredentials()` called before CLI parse when running as main:

- Scans `process.env` for high-risk credential patterns
- Warns with provider names and migration command
- Skippable via `OPENCLAW_SECURITY_ENV_SCAN=0`

---

## Test Coverage

**5244 tests passing (626 test files):**

| Test File                            | Tests | Coverage Focus                                  |
| ------------------------------------ | ----- | ----------------------------------------------- |
| `credential-vault.test.ts`           | 29    | Store/get/rotate/delete, scope isolation, perms |
| `credential-audit.test.ts`           | 26    | Hash chain, tamper detection, query, export     |
| `session-files.test.ts`              | 3     | lineMap tracking in session JSONL entries       |
| `manager.watcher-config.test.ts`     | 1     | Memory watcher globs + ignored dependency dirs  |
| `auth-choice.apply.huggingface.test` | 3     | Vault ref written to auth profile on setup      |

---

## SECURITY.md Control Alignment (Step 9)

- **Tool filesystem hardening**: vault scopes prevent cross-tool credential access; `security fix` now chmods vault dir/files

- **Security Scanning**: audit trail integrates with security audit pipeline; `security credentials status` shows audit integrity inline

- **Maintainers: GHSA Updates via CLI**: `rotateCredential()` supports immediate remediation with audit trail; `security credentials rotate` exposes this via CLI

---

## Verification Commands

```bash
# Run credential module tests
pnpm vitest run src/security/credential-vault.test.ts src/security/credential-audit.test.ts

# Run redaction tests
pnpm vitest run src/logging/redact.test.ts

# Run full test suite
pnpm test:fast

# Security CLI
openclaw security credentials status
openclaw security credentials migrate --env --risk high
openclaw security credentials rotate <name> --value <new-value> --scope provider

# Full security audit with vault checks
openclaw security audit
```

---

## Next Steps

- Phase 6: Monitoring & Detection
- Phase 7: User Education
