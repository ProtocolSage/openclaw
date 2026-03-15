# Upstream Sync Workflow

## Overview

\`scripts/sync-upstream.sh\` automates syncing from upstream \`openclaw/openclaw\` while preserving local hardening commits.

## When to Run

- Weekly maintenance.
- When \`git log upstream/main..main\` shows many commits behind (run script for count).
- Before major releases.

Run from repo root (\`~/dev/openclaw\`):
\`\`\`bash
./scripts/sync-upstream.sh
\`\`\`

## Workflow Steps

1. **Safety**: Clean tree, on \`main\`, \`upstream\` remote exists. Prints current/upstream versions.
2. **Fetch**: \`git fetch upstream\`. Reports commits behind.
3. **Predict**: Dry-run merge, lists conflicts, confirms if any (>0).
4. **Merge**: \`git merge --no-ff upstream/main\`. Exits on conflicts (manual resolve).
5. **Verify**:
   - Targeted Vitest for hardening areas.
   - Full \`tsc --noEmit\`.
   - Confirms all 9 hardening commits survive (\`git log main --grep\`).
6. **Summary**: Merged count, new tag, scope-labeled verification, push command (manual).

## Handling Conflicts

- **Predicted**: Lists files, \`read -p\` confirm (y/N).
- **Post-merge**: Lists conflicted, exits 1.
  ```
  Edit files → git add -u → git merge --continue → rerun script
  ```

## Post-Merge Fixes

- **TS errors/tests fail**: Script reports but exits 0 if hardening OK. Fix separately, rerun verification.
- **Hardening lost**: \`git reset --hard ORIG_HEAD\`, reapply commits.

## Verification Format

\`\`\`
Targeted tests: 4 passed / 0 failed
Full tsc: passed | failed | not run
Full lint: not run
Repo-wide health: established | unknown
\`\`\`

- \`established\`: Targeted + tsc pass.
- \`unknown\`: Any fail.

## Manual Checks

**Hardening commits:**
\`\`\`bash
git log main --oneline | grep -E 'toolchain-preflight|coding-agent lifecycle|verification-scope|cli-runner|gateway/call|hoisted Vitest|lazy root alias'
\`\`\`

**Upstream setup (one-time):**
\`\`\`bash
git remote add upstream https://github.com/openclaw/openclaw.git
git fetch upstream
\`\`\`

**Versions:**
\`\`\`bash
git describe --tags --abbrev=0 # local
git ls-remote --tags --sort=version:refname upstream main | tail -1 # upstream
\`\`\`
