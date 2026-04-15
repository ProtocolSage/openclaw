#!/usr/bin/env bash
# Apply the local Sonoma compatibility adjustments after updating OpenClaw.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '%s\n' "$*"
}

patch_file() {
  local file="$1"
  local before="$2"
  local after="$3"

  if grep -q "$before" "$file" 2>/dev/null; then
    sed -i '' "s/$before/$after/g" "$file"
    log "  Patched ${file#${ROOT_DIR}/}"
  else
    log "  ${file#${ROOT_DIR}/} already patched"
  fi
}

log "==> Applying Sonoma compatibility patches"

patch_file "${ROOT_DIR}/apps/macos/Package.swift" '\.macOS(.v15)' '.macOS(.v14)'
patch_file "${ROOT_DIR}/Swabble/Package.swift" '\.macOS(.v15)' '.macOS(.v14)'
patch_file "${ROOT_DIR}/apps/macos/Package.swift" 'exact: "1\.2\.2"' 'exact: "1.1.3"'
patch_file "${ROOT_DIR}/apps/macos/Sources/OpenClaw/Resources/Info.plist" '<string>15\.0</string>' '<string>14.0</string>'

"${ROOT_DIR}/scripts/vendor-textual.sh"

log ""
log "==> Sonoma compatibility patches applied"
log "Next step: ./scripts/restart-mac.sh --no-sign"
