# OPERATOR_CHECKLIST

## Pre-Phase-C Gates

- [ ] `RECOVERY_NOTES.md` contains sign-off URL entry:
      `signoff | <release-lead> | <security-owner> | <thread-or-pr-url> | <timestamp>`
- [ ] Required checks configured on `recovery/p0-security-clean`:
      `recovery/pnpm-check`, `recovery/tsgo`, `recovery/low-profile-tests`
- [ ] Branch protections active on:
      `forensics/p0-partial-20260308`, `recovery/p0-security-clean`
- [ ] Dry-run artifact is attached/linked in sign-off thread and recorded in `RECOVERY_NOTES.md`

## Replay Loop (Per SHA)

- [ ] `git cherry-pick -x <sha>`
- [ ] Resolve conflicts per policy
- [ ] Append conflict line to `RECOVERY_NOTES.md` immediately
- [ ] If empty: `git cherry-pick --skip` and record rationale
- [ ] Local gates:
  - [ ] `pnpm check`
  - [ ] `pnpm tsgo`
  - [ ] `OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test`
- [ ] Push branch after local green
- [ ] Wait for required CI checks to pass
- [ ] Commit metadata line updates in `RECOVERY_NOTES.md`
- [ ] Push metadata commit

## Post-Replay

- [ ] Update `scripts/staged-upstream-cherry-pick.sh` to reflect absorbed/deferred entries
- [ ] Commit and push script sync
- [ ] Open promotion PR to `main`
- [ ] Confirm final acceptance criteria and sign-offs
