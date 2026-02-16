# Step 5: Backend Security Hardening

**Status:** COMPLETED
**Date:** 2026-02-13
**Phase:** 2 - Skill & Plugin Hardening

---

## Summary

This step closes backend hardening gaps in plugin installation by enforcing install-time source/spec/path/plugin-id policy checks before any package extraction, npm fetch, or copy/install side effects.

## Changes Made

### 1. Added Plugin Install Security Policy Surface

Extended `src/config/types.plugins.ts` with non-breaking optional config:

- `plugins.security.allowedSources?: ("local" | "archive" | "npm" | "any")[]`
- `plugins.security.allowlist?: string[]`
- `plugins.security.blocklist?: string[]`
- `plugins.security.blockedSpecs?: string[]`
- `plugins.security.blockedPaths?: string[]`

No existing behavior changes unless users opt in via config.

### 2. Enforced Policy in Install Entry Points

Updated `src/plugins/install.ts` to enforce policy checks across all install flows:

- `installPluginFromNpmSpec()`
  - Enforces source gating (`npm`)
  - Enforces `blockedSpecs`
- `installPluginFromArchive()`
  - Enforces source gating (`archive`)
  - Enforces `blockedPaths` on archive path
- `installPluginFromDir()` / `installPluginFromFile()`
  - Enforces source gating (`local`)
  - Enforces `blockedPaths`
- `installPluginFromPackageDir()`
  - Enforces plugin-id `allowlist`/`blocklist` after manifest resolution

Policy failures return explicit `InstallPluginResult` errors and abort install safely.

### 3. Wired Policy Through Call Sites

Updated install call sites to pass config policy:

- `src/cli/plugins-cli.ts`
- `src/commands/onboarding/plugin-install.ts`
- `src/plugins/update.ts`

This ensures all user-visible install/update paths honor the same backend security controls.

### 4. Hardened Install Test Harness and Assertions

Updated `src/plugins/install.test.ts`:

- Fixed `npm pack` archive detection to be robust when stdout is empty.
- Updated dangerous-plugin tests for block-by-default behavior.
- Added force-install bypass verification (`forceInstall: true`).
- Added policy gating tests for source/path/plugin-id blocking.

## Validation

Executed and passed:

```bash
pnpm vitest run src/security/skill-scanner.test.ts --reporter=dot
pnpm vitest run src/plugins/install.test.ts --reporter=dot
pnpm vitest run src/commands/onboarding/plugin-install.test.ts --reporter=dot
pnpm build
```

Results:

- `src/security/skill-scanner.test.ts`: 58/58 passed
- `src/plugins/install.test.ts`: 14/14 passed
- `src/commands/onboarding/plugin-install.test.ts`: 5/5 passed
- Build completed successfully

## Files Modified

- `src/config/types.plugins.ts`
- `src/plugins/install.ts`
- `src/plugins/install.test.ts`
- `src/cli/plugins-cli.ts`
- `src/commands/onboarding/plugin-install.ts`
- `src/plugins/update.ts`

## Outcome

Backend install controls now enforce secure defaults and explicit policy-based gating while preserving non-breaking behavior for existing users who do not set `plugins.security`.

## SECURITY.md Control Alignment (Step 5)

- `Operational Guidance > Tool filesystem hardening`: backend policy surfaces enforce restrictive defaults for tool execution boundaries.
- `Security Scanning`: install and update paths are wired to scanner-enforced gate checks.
- `Maintainers: GHSA Updates via CLI`: backend hardening changes are prepared for vulnerability lifecycle updates through maintained advisory workflows.
