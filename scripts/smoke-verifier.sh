#!/usr/bin/env bash
# scripts/smoke-verifier.sh
#
# Scripted smoke harness for the verifier stack.
# Runs build, lint, tests, and gateway probe in sequence.
# All output goes to log files — the agent reads logs, shell is source of truth.
#
# Usage:
#   ./scripts/smoke-verifier.sh           # full smoke
#   ./scripts/smoke-verifier.sh --quick   # skip gateway probe

set -uo pipefail

SMOKE_DIR="/tmp/openclaw-smoke"
mkdir -p "$SMOKE_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Colors (if terminal)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

QUICK=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK=true
fi

PASS=0
FAIL=0
SKIP=0

run_step() {
  local name="$1"
  local logfile="$SMOKE_DIR/${TIMESTAMP}-${name}.log"
  shift

  printf "%-30s" "$name..."

  if "$@" > "$logfile" 2>&1; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS++))
  else
    local exit_code=$?
    echo -e "${RED}FAIL${NC} (exit $exit_code) → $logfile"
    ((FAIL++))
    # Show last 10 lines of failure
    echo "  --- last 10 lines ---"
    tail -10 "$logfile" | sed 's/^/  /'
    echo "  ---"
  fi
}

skip_step() {
  local name="$1"
  printf "%-30s" "$name..."
  echo -e "${YELLOW}SKIP${NC}"
  ((SKIP++))
}

echo "=== OpenClaw Verifier Smoke Test ==="
echo "Logs: $SMOKE_DIR/${TIMESTAMP}-*.log"
echo ""

# Step 1: Build
run_step "build" pnpm build

# Step 2: Lint/format check
run_step "check" pnpm check

# Step 3: Verifier unit tests
run_step "test:verifier" pnpm test -- src/verifier/

# Step 4: Full test suite (optional, slower)
# run_step "test:full" pnpm test

# Step 5: Gateway probe (skip in quick mode)
if [[ "$QUICK" == "false" ]]; then
  # Check if gateway is running
  if ss -ltnp 2>/dev/null | grep -q ":18789"; then
    run_step "gateway:status" pnpm openclaw gateway status --deep
  else
    skip_step "gateway:status (not running)"
  fi
else
  skip_step "gateway:status (--quick)"
fi

echo ""
echo "=== Summary ==="
echo -e "  ${GREEN}PASS${NC}: $PASS"
if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}FAIL${NC}: $FAIL"
fi
if [[ $SKIP -gt 0 ]]; then
  echo -e "  ${YELLOW}SKIP${NC}: $SKIP"
fi
echo "  Logs: $SMOKE_DIR/${TIMESTAMP}-*.log"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
