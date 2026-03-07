#!/usr/bin/env bash

set -euo pipefail

# Staged upstream cherry-pick helper for main..upstream/main.
# - Applies curated commit queues in stage order (P0..P4).
# - Auto-skips already-ancestor commits.
# - Auto-skips empty cherry-picks.
# - Logs per-commit status and conflict details.

STAGE_ORDER=(
  "P0-security"
  "P1-core"
  "P2-channels"
  "P3-platform"
  "P4-docs-tooling"
)

P0_SECURITY_COMMITS=(
  0d0f4c699
  47c3f742b
  3f0b9dbb3
  e80c803fa
  55cf92578
  dded56962
  c8ebd48e0
  8da8756f7
  21d6d878c
  31c7637e0
  da0e245db
  944abe0a6
  18f8393b6
  c823a8530
  085c23ce5
  3bf19d6f4
  72cf9253f
  806803b7e
  8a4d8c889
  1ab939321
  a49afd25e
  be578b43d
  0e4245063
  132794fe7
  d95cf256e
  17bae9368
  4b17d6d88
  a8dd9ffea
  9af3ec92a
  1f2432358
  92b489212
  a4a490bae
  bdd368533
  fa3fafdde
)

P1_CORE_COMMITS=(
  fee91fefc
  fa6c0e1b4
  ff9719550
  ff334600d
  a939a1560
  9dab15451
  9fed9f130
  5fdcef7cb
  777af476c
  c5828cbc0
  30c0f7e89
  44ec3e411
  a622aee45
  0e2bc588c
  726ef48c2
  6c39616ec
  5d4b04040
  01b20172b
  a65d70f84
  dfe23b9cc
  e11a0775e
  2671f0486
  05fb16d15
  4daaea119
  81b93b9ce
)

P2_CHANNELS_COMMITS=(
  4a80d48ea
  6dfd39c32
  8c2633a46
  ce71fac7d
  1efa7a88c
  d58dafae8
  6a705a37f
  bc66a8fa8
  174eeea76
  995ae73d5
  2972d6fa7
  627b37e34
  89b303c55
  136ca87f7
  e5b6a4e19
  63ce7c74b
  60d33637d
)

P3_PLATFORM_COMMITS=(
  ec0eb9f8c
  6df57d963
  a3112d6c5
  bf7061092
  22e33ddda
  a36ccf415
  2a733a844
  bd25182d5
  4aa548cf7
  46b62c53f
  80efcb75c
  ba50dfaae
  04a8f97c5
  61f7cea48
  4fb40497d
  3a6b412f0
)

P4_DOCS_TOOLING_COMMITS=(
  151f26070
  5470337b1
  7cc3376f0
  eb2eebae2
  f788ba142
  e88f6605e
  ee6f7b1bf
  60849f333
  5d5fa0dac
  4cc293d08
  b02a07655
  2c6616b83
  e93051715
  b1a735829
  cf5702233
  d4ec0ed3c
)

DRY_RUN=0
NO_FETCH=0
ALLOW_DIRTY=0
SELECTED_STAGES=()

usage() {
  cat <<USAGE
Usage:
  scripts/staged-upstream-cherry-pick.sh [options] [stage ...]

Stages:
  P0-security
  P1-core
  P2-channels
  P3-platform
  P4-docs-tooling

If no stage is passed, all stages run in order.

Options:
  --dry-run      Print planned picks and logs, do not cherry-pick.
  --no-fetch     Skip 'git fetch upstream main --prune'.
  --allow-dirty  Allow running with a dirty working tree (not recommended).
  -h, --help     Show this help.

Examples:
  scripts/staged-upstream-cherry-pick.sh --dry-run
  scripts/staged-upstream-cherry-pick.sh P0-security
  scripts/staged-upstream-cherry-pick.sh P1-core P2-channels
USAGE
}

repo_root() {
  git rev-parse --show-toplevel
}

normalize_stage() {
  case "$1" in
    P0|p0|P0-security|p0-security) echo "P0-security" ;;
    P1|p1|P1-core|p1-core) echo "P1-core" ;;
    P2|p2|P2-channels|p2-channels) echo "P2-channels" ;;
    P3|p3|P3-platform|p3-platform) echo "P3-platform" ;;
    P4|p4|P4-docs-tooling|p4-docs-tooling|p4-docs) echo "P4-docs-tooling" ;;
    *) return 1 ;;
  esac
}

is_valid_stage() {
  local stage="$1"
  local s
  for s in "${STAGE_ORDER[@]}"; do
    if [ "$s" = "$stage" ]; then
      return 0
    fi
  done
  return 1
}

stage_commits() {
  local stage="$1"
  case "$stage" in
    P0-security) printf '%s\n' "${P0_SECURITY_COMMITS[@]}" ;;
    P1-core) printf '%s\n' "${P1_CORE_COMMITS[@]}" ;;
    P2-channels) printf '%s\n' "${P2_CHANNELS_COMMITS[@]}" ;;
    P3-platform) printf '%s\n' "${P3_PLATFORM_COMMITS[@]}" ;;
    P4-docs-tooling) printf '%s\n' "${P4_DOCS_TOOLING_COMMITS[@]}" ;;
    *) return 1 ;;
  esac
}

require_clean_if_needed() {
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    return 0
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is dirty. Refusing to run without --allow-dirty."
    git status --short --branch
    exit 1
  fi
}

init_logs() {
  local root="$1"
  local run_id
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  LOG_DIR="$root/.local/cherry-pick-staged/$run_id"
  mkdir -p "$LOG_DIR"
  STATUS_LOG="$LOG_DIR/status.log"
  CONFLICT_LOG="$LOG_DIR/conflicts.log"
  SUMMARY_LOG="$LOG_DIR/summary.log"
  : > "$STATUS_LOG"
  : > "$CONFLICT_LOG"
  : > "$SUMMARY_LOG"
}

log_status() {
  local stage="$1"
  local commit="$2"
  local status="$3"
  local subject="$4"
  local line
  line="$(date -u +%FT%TZ) | $stage | $commit | $status | $subject"
  echo "$line" | tee -a "$STATUS_LOG" >/dev/null
}

log_conflict() {
  local stage="$1"
  local commit="$2"
  local subject="$3"
  {
    echo "=== $(date -u +%FT%TZ) ==="
    echo "stage: $stage"
    echo "commit: $commit"
    echo "subject: $subject"
    echo "status: conflict"
    echo "git status --short:"
    git status --short
    echo
  } >> "$CONFLICT_LOG"
}

fetch_upstream_if_needed() {
  if [ "$NO_FETCH" -eq 1 ]; then
    return 0
  fi
  git fetch upstream main --prune
}

pick_one() {
  local stage="$1"
  local commit="$2"
  local subject
  subject="$(git show -s --format=%s "$commit" 2>/dev/null || echo "<missing commit>")"

  if ! git cat-file -e "$commit^{commit}" 2>/dev/null; then
    log_status "$stage" "$commit" "SKIP_MISSING" "$subject"
    return 0
  fi

  if git merge-base --is-ancestor "$commit" HEAD; then
    log_status "$stage" "$commit" "SKIP_ANCESTOR" "$subject"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log_status "$stage" "$commit" "PLAN" "$subject"
    return 0
  fi

  if git cherry-pick -x "$commit"; then
    log_status "$stage" "$commit" "APPLIED" "$subject"
    return 0
  fi

  if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null 2>&1; then
    if git ls-files -u | grep -q .; then
      log_status "$stage" "$commit" "CONFLICT" "$subject"
      log_conflict "$stage" "$commit" "$subject"
      return 2
    fi

    if git diff --cached --quiet && git diff --quiet; then
      git cherry-pick --skip
      log_status "$stage" "$commit" "SKIP_EMPTY" "$subject"
      return 0
    fi
  fi

  log_status "$stage" "$commit" "FAILED" "$subject"
  return 3
}

run_stage() {
  local stage="$1"
  local commit
  local rc

  echo "Running stage: $stage"
  while IFS= read -r commit; do
    [ -n "$commit" ] || continue
    if ! pick_one "$stage" "$commit"; then
      rc=$?
      if [ "$rc" -eq 2 ]; then
        echo "Conflict in $stage at $commit. Resolve manually, then continue or abort cherry-pick."
      else
        echo "Failed in $stage at $commit. See $STATUS_LOG"
      fi
      return "$rc"
    fi
  done < <(stage_commits "$stage")

  return 0
}

print_summary() {
  {
    echo "Log directory: $LOG_DIR"
    echo "Status log: $STATUS_LOG"
    echo "Conflict log: $CONFLICT_LOG"
    echo
    echo "Counts by status:"
    awk -F"|" '{gsub(/^ +| +$/, "", $4); c[$4]++} END {for (k in c) printf "%s: %d\n", k, c[k]}' "$STATUS_LOG" | sort
  } | tee -a "$SUMMARY_LOG"
}

main() {
  local arg normalized root

  while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      --no-fetch) NO_FETCH=1 ;;
      --allow-dirty) ALLOW_DIRTY=1 ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        if ! normalized="$(normalize_stage "$arg")"; then
          echo "Unknown stage or option: $arg"
          usage
          exit 1
        fi
        SELECTED_STAGES+=("$normalized")
        ;;
    esac
    shift
  done

  root="$(repo_root)"
  cd "$root"

  if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null 2>&1; then
    echo "A cherry-pick is already in progress. Resolve with git cherry-pick --continue/--abort first."
    exit 1
  fi

  require_clean_if_needed
  init_logs "$root"
  fetch_upstream_if_needed

  if [ "${#SELECTED_STAGES[@]}" -eq 0 ]; then
    SELECTED_STAGES=("${STAGE_ORDER[@]}")
  fi

  local stage
  for stage in "${SELECTED_STAGES[@]}"; do
    if ! is_valid_stage "$stage"; then
      echo "Invalid stage: $stage"
      exit 1
    fi
    if ! run_stage "$stage"; then
      print_summary
      exit 1
    fi
  done

  print_summary
}

main "$@"
