# RECOVERY_NOTES

Runbook: Split-and-Stabilize Locked v5
Checkpoint: c8646db9b
Recovery branch: recovery/p0-security-clean
Forensic branch: forensics/p0-partial-20260308

Locked replay SHAs:

- ca0eacba2
- 7151083f4
- d01794c01
- 7646b97fd
- 5f240e935
- c5d011376
- 1df33fd5c
- 51b0bfe5e
- 12fdcbb37
- 3fde97185
- 17e5d9d66

Conflict entry format:
<sha> | <file> | <choice upstream|local|manual> | <short rationale> | <timestamp>

CI result format:
<sha> | ci | <pass|fail> | <timestamp> | <ci-job-or-url>

Intent format:
<sha> | intent | <one-line security objective> | <timestamp>

Sign-off format:
signoff | <release-lead> | <security-owner> | <thread-or-pr-url> | <timestamp>

Quarantine format:
<sha> | quarantine | <branch-name> | <reason> | <timestamp>

Dry-run artifact format:
dryrun | <artifact-or-comment-url> | <summary> | <timestamp>

signoff | ProtocolSage | ProtocolSage | https://github.com/ProtocolSage/openclaw/pull/17 | 2026-03-09T04:23:00Z
dryrun | https://gist.github.com/ProtocolSage/f97ffe876f54fac55d2da0c60b872658 | throwaway clone replayed 11/11 locked SHAs cleanly from c8646db9b | 2026-03-09T04:21:06Z
dryrun | https://github.com/ProtocolSage/openclaw/pull/17#issuecomment-4021003079 | dry-run artifacts and sign-off posted in PR thread | 2026-03-09T04:23:00Z
ca0eacba2 | intent | adopt upstream system.run approval cwd hardening with canonical binding semantics | 2026-03-09T05:46:43Z
ca0eacba2 | ci | pass | 2026-03-09T05:46:43Z | local: pnpm check; pnpm tsgo; OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
7151083f4 | intent | preserve system.run wrapper approval semantics while keeping allowlist safety checks | 2026-03-09T05:46:43Z
7151083f4 | ci | pass | 2026-03-09T05:46:43Z | local: pnpm check; pnpm tsgo; OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
ccc133f09 | intent | restore canonical executable pinning and V2 approval-plan typing after replay mismatch surfaced in tests | 2026-03-09T05:46:43Z
ccc133f09 | ci | pass | 2026-03-09T05:46:43Z | local: pnpm check; pnpm tsgo; OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
d01794c01 | intent | escape regex literals in allowlist path matching while preserving canonical executable matching | 2026-03-09T06:19:46Z
d01794c01 | ci | pass | 2026-03-09T06:19:46Z | local: pnpm check; pnpm tsgo; OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
7646b97fd | intent | harden allowlist regex literal handling to eliminate token/character-class bypasses | 2026-03-09T06:44:39Z
7646b97fd | ci | pass | 2026-03-09T06:44:39Z | local: pnpm check; pnpm tsgo; OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
5f240e935 | intent | block quantified ambiguous alternation regex patterns in security checks | 2026-03-09T07:09:47Z
5f240e935 | ci | pass | 2026-03-09T07:09:47Z | local: pnpm check; pnpm tsgo; OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
c5d011376 | intent | adopt prototype-chain account-path hardening while preserving existing recovery-branch i18n/runtime contracts | 2026-03-09T08:12:21Z
c5d011376 | ci | pass | 2026-03-09T08:12:21Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
fddb93e51 | intent | stabilize i18n locale registry test against current recovery baseline without browser-global dependencies | 2026-03-09T08:12:21Z
fddb93e51 | ci | pass | 2026-03-09T08:12:21Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
1df33fd5c | intent | recognize localized Windows SYSTEM account principals in ACL auditing to reduce false negatives/positives in security posture checks | 2026-03-09T08:41:10Z
1df33fd5c | ci | pass | 2026-03-09T08:41:10Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
7dc213181 | intent | replayed upstream ACL-localization hardening commit on recovery branch with deterministic validation gates | 2026-03-09T08:41:10Z
7dc213181 | ci | pass | 2026-03-09T08:41:10Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
51b0bfe5e | intent | harden sandbox writes and atomic file operations while preserving sandbox boundary enforcement semantics | 2026-03-09T10:00:24Z
51b0bfe5e | ci | pass | 2026-03-09T10:00:24Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
6403319ea | intent | replayed upstream sandbox write hardening commit on recovery branch and validated against full low-profile test lanes | 2026-03-09T10:00:24Z
6403319ea | ci | pass | 2026-03-09T10:00:24Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
220a17eeb | intent | stabilize mkdirp boundary checks for existing directories and fail-closed on existing non-directory targets | 2026-03-09T10:00:24Z
220a17eeb | ci | pass | 2026-03-09T10:00:24Z | local: NODE_OPTIONS=--experimental-sqlite pnpm check; NODE_OPTIONS=--experimental-sqlite pnpm tsgo; NODE_OPTIONS=--experimental-sqlite OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
