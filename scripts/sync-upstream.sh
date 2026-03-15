#!/usr/bin/env bash
set -euo pipefail

# scripts/sync-upstream.sh
# Automated upstream sync for OpenClaw fork (ProtocolSage/openclaw <- openclaw/openclaw)

REPO_ROOT="$(git rev-parse --show-toplevel)"
HARDENING_COMMITS=(
  "fix(exec): add deterministic toolchain preflight"
  "fix(coding-agent): make lifecycle reporting truthful and backward-compatible" 
  "fix(exec): enforce scope-labeled verification reporting"
  "fix(exec): make runtime outcomes explicitly typed"
  "fix(exec): persist structured verification artifacts"
  "fix(gateway): prefer paired device identity for local CLI operator calls"
  "fix(runtime): reduce environment-sensitive detection paths"
  "fix(test): normalize hoisted Vitest mocks"
  "refactor(plugin-sdk): simplify lazy root alias loading"
)

echo "=== 1. Safety Checks ==="
if git status --porcelain | grep -q .; then
  echo "❌ ERROR: Working tree is dirty. Commit or stash changes first."
  exit 1
fi
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "❌ ERROR: Not on main branch ($(git branch --show-current))."
  exit 1
fi
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "❌ ERROR: 'upstream' remote missing. Run: git remote add upstream https://github.com/openclaw/openclaw.git"
  exit 1
fi

CURRENT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "no-tag")
UPSTREAM_LATEST=$(git ls-remote --tags --refs --sort=version:refname upstream main | tail -n1 | cut -d/ -f3 | sed 's/^v//')
echo "✅ Current: $CURRENT_TAG"
echo "   Upstream latest: $UPSTREAM_LATEST"

echo "=== 2. Fetch Upstream ==="
git fetch upstream
BEHIND_COUNT=$(git rev-list --count ^main upstream/main 2>/dev/null || echo 0)
echo "✅ Fetched. $BEHIND_COUNT commits behind upstream/main."

if [[ $BEHIND_COUNT -eq 0 ]]; then
  echo "✅ Already up-to-date. Nothing to merge."
  exit 0
fi

echo "=== 3. Conflict Prediction ==="
git merge --no-commit --no-ff -q upstream/main || true
CONFLICTED=$(git diff --name-only --diff-filter=U | wc -l)
CONFLICT_FILES=$(git diff --name-only --diff-filter=U)
git merge --abort
echo "Predicted conflicts: $CONFLICTED files"
if [[ $CONFLICTED -gt 0 ]]; then
  echo "Conflicted files:"
  echo "$CONFLICT_FILES"
  read -p "Proceed with merge? (y/N): " -r PROCEED
  if [[ ! "$PROCEED" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "=== 4. Execute Merge ==="
git merge --no-ff upstream/main
if git diff --name-only --diff-filter=U | grep -q .; then
  CONFLICTED_POST=$(git diff --name-only --diff-filter=U)
  echo "❌ MERGE CONFLICTS DETECTED:"
  echo "$CONFLICTED_POST"
  echo ""
  echo "Resolve manually:"
  echo "  - Edit files"
  echo "  - git add <files>"
  echo "  - git merge --continue"
  echo "  - Rerun this script after resolution"
  exit 1
fi
echo "✅ Merge completed (no conflicts)."

echo "=== 5. Post-Merge Verification ==="
echo "Targeted tests:"
TEST_PASSED=0
TEST_FAILED=0

pnpm exec vitest run src/infra/toolchain-preflight.test.ts && TEST_PASSED=$((TEST_PASSED+1)) || TEST_FAILED=$((TEST_FAILED+1))
pnpm exec vitest run src/infra/verification-scope.test.ts && TEST_PASSED=$((TEST_PASSED+1)) || TEST_FAILED=$((TEST_FAILED+1))
pnpm exec vitest run src/agents/cli-runner.test.ts && TEST_PASSED=$((TEST_PASSED+1)) || TEST_FAILED=$((TEST_FAILED+1))
pnpm exec vitest run src/gateway/call.test.ts && TEST_PASSED=$((TEST_PASSED+1)) || TEST_FAILED=$((TEST_FAILED+1))

echo "  Targeted tests: $TEST_PASSED passed / $TEST_FAILED failed"

TSC_PASSED="passed"
NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsc --noEmit || TSC_PASSED="failed"

echo "  Full tsc: $TSC_PASSED"
echo "  Full lint: not run"
if [[ $TEST_FAILED -eq 0 && "$TSC_PASSED" == "passed" ]]; then
  REPO_HEALTH="established"
else
  REPO_HEALTH="unknown"
fi
echo "  Repo-wide health: $REPO_HEALTH"

echo "=== 6. Verify Hardening Commits Survived ==="
MISSING=()
for commit in "${HARDENING_COMMITS[@]}"; do
  if ! git log main --format="%s" | grep -qF "$commit"; then
    MISSING+=("$commit")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "❌ MISSING HARDENING COMMITS:"
  printf '  - %s\n' "${MISSING[@]}"
  exit 1
fi
echo "✅ All 9 hardening commits present."

echo "=== 7. Summary ==="
MERGED_COUNT=$(git rev-list --count upstream/main..main)
NEW_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "no-tag")
echo "✅ Merged $MERGED_COUNT commits."
echo "   New version: $NEW_TAG"
echo ""
echo "Scope-labeled verification:"
echo "  Targeted tests: $TEST_PASSED passed / $TEST_FAILED failed"
echo "  Full tsc: $TSC_PASSED"
echo "  Full lint: not run"
echo "  Repo-wide health: $REPO_HEALTH"
echo "  Hardening commits: verified (9/9)"
echo ""
echo "To complete: git push origin main"
echo "✅ SYNC COMPLETE."