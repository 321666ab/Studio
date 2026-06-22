#!/usr/bin/env bash
#
# build_and_run.sh — local run / debug / package / verify helper for Studio.
#
# This is an UNSIGNED local build. The app is not code-signed and not notarized.
#
# Usage:
#   script/build_and_run.sh run         Build, package (or reuse), and launch Studio.app
#   script/build_and_run.sh --debug     Launch via electron-vite dev (or lldb if app exists)
#   script/build_and_run.sh --logs      Tail the most recent Studio log output
#   script/build_and_run.sh --telemetry Print basic process/resource info for running Studio
#   script/build_and_run.sh --verify    Build, package, launch, then pgrep-verify it is running
#
set -euo pipefail

# Resolve repo root from this script's location (script/ lives at repo root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

APP_NAME="Studio"
APP_PATH="dist/mac-arm64/${APP_NAME}.app"
APP_PROC="${APP_NAME}.app/Contents/MacOS/${APP_NAME}"
LOG_DIR="${HOME}/Library/Logs/${APP_NAME}"

# Stable mirrors for environments where GitHub release downloads are slow.
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

log() { printf '[build_and_run] %s\n' "$1"; }

stop_studio() {
  # Stop any running Studio.app (packaged) instances. Match the packaged binary
  # path so we do not kill unrelated processes or this script.
  if pgrep -f "${APP_PROC}" >/dev/null 2>&1; then
    log "Stopping existing ${APP_NAME} process..."
    pkill -f "${APP_PROC}" || true
    sleep 1
  fi
}

build_bundles() {
  log "Building renderer/main/preload bundles (npm run build)..."
  npm run build
}

package_app() {
  log "Packaging ${APP_NAME}.app with electron-builder (unsigned, local)..."
  rm -rf "${APP_PATH}"
  if [[ ! -x "node_modules/.bin/electron-builder" ]]; then
    log "ERROR: electron-builder is not installed; run npm install"
    exit 1
  fi
  node_modules/.bin/electron-builder --mac --arm64 --dir --config electron-builder.yml

  if [[ ! -d "${APP_PATH}" ]]; then
    log "ERROR: expected packaged app not found at ${APP_PATH}"
    exit 1
  fi
}

launch_app() {
  log "Launching ${APP_PATH} (new instance)..."
  open -n "${APP_PATH}"
}

verify_running() {
  # Give the app a moment to spin up, then confirm via pgrep.
  log "Verifying ${APP_NAME} is running..."
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if pgrep -f "${APP_PROC}" >/dev/null 2>&1; then
      log "OK: ${APP_NAME} is running (pid: $(pgrep -f "${APP_PROC}" | tr '\n' ' '))"
      return 0
    fi
    sleep 1
  done
  log "ERROR: ${APP_NAME} did not start within timeout"
  exit 1
}

cmd_run() {
  stop_studio
  build_bundles
  package_app
  launch_app
}

cmd_debug() {
  stop_studio
  if [[ -d "${APP_PATH}" ]]; then
    # Packaged app exists: attach lldb to the launched binary for native debugging.
    log "Launching packaged ${APP_NAME} under lldb..."
    lldb -o run -- "${ROOT_DIR}/${APP_PATH}/Contents/MacOS/${APP_NAME}"
  else
    # No package yet: run the dev server with Electron for fast iteration.
    log "No packaged app found; starting electron-vite dev..."
    npm run dev
  fi
}

cmd_logs() {
  if [[ -d "${LOG_DIR}" ]]; then
    log "Tailing logs in ${LOG_DIR}"
    # shellcheck disable=SC2012
    latest="$(ls -t "${LOG_DIR}"/*.log 2>/dev/null | head -n 1 || true)"
    if [[ -n "${latest}" ]]; then
      tail -n 100 -f "${latest}"
    else
      log "No .log files found in ${LOG_DIR}"
    fi
  else
    log "No log directory at ${LOG_DIR} (app may not have produced logs yet)"
  fi
}

cmd_telemetry() {
  if pgrep -f "${APP_PROC}" >/dev/null 2>&1; then
    log "${APP_NAME} process/resource info:"
    ps -o pid,ppid,%cpu,%mem,rss,etime,command -p "$(pgrep -f "${APP_PROC}" | tr '\n' ',' | sed 's/,$//')"
  else
    log "${APP_NAME} is not running; no telemetry available"
  fi
}

cmd_verify() {
  stop_studio
  build_bundles
  package_app
  launch_app
  verify_running
}

main() {
  local action="${1:-run}"
  case "${action}" in
    run)         cmd_run ;;
    --debug)     cmd_debug ;;
    --logs)      cmd_logs ;;
    --telemetry) cmd_telemetry ;;
    --verify)    cmd_verify ;;
    -h|--help|help)
      grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      ;;
    *)
      log "Unknown action: ${action}"
      log "Use one of: run | --debug | --logs | --telemetry | --verify"
      exit 2
      ;;
  esac
}

main "$@"
