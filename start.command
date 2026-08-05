#!/bin/bash

set -Eeuo pipefail

WINDUP_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
BACKEND_DIR="$WINDUP_ROOT/backend"
FRONTEND_DIR="$WINDUP_ROOT/frontend"
BACKEND_URL="http://127.0.0.1:8000"
FRONTEND_URL="http://127.0.0.1:5173"
REDIS_ENABLED="${REDIS_ENABLED:-false}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
BACKEND_LOG="${TMPDIR:-/tmp}/windup-backend.log"
FRONTEND_LOG="${TMPDIR:-/tmp}/windup-frontend.log"

print_error() {
  printf '\n[ERROR] %s\n' "$1" >&2
}

pause_on_failure() {
  if [[ -t 0 ]]; then
    printf '\nPress Return to close this window...'
    read -r _
  fi
}

fail() {
  print_error "$1"
  pause_on_failure
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

port_is_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_url() {
  local url="$1"
  local deadline=$((SECONDS + 45))

  while ((SECONDS < deadline)); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_backend() {
  (
    cd "$BACKEND_DIR"
    nohup env \
      SQLITE_PATH="./windup.db" \
      REDIS_ENABLED="$REDIS_ENABLED" \
      REDIS_URL="$REDIS_URL" \
      WINDUP_HOST="127.0.0.1" \
      WINDUP_PORT="8000" \
      uv run python init_db.py >"$BACKEND_LOG" 2>&1 &
  )
}

start_frontend() {
  (
    cd "$FRONTEND_DIR"
    nohup npm run dev -- --host 127.0.0.1 --port 5173 --strictPort \
      >"$FRONTEND_LOG" 2>&1 &
  )
}

printf '%s\n' \
  '============================================' \
  '  Windup local development launcher' \
  '============================================' \
  ''

[[ -f "$BACKEND_DIR/pyproject.toml" ]] || fail "Backend directory not found: $BACKEND_DIR"
[[ -f "$FRONTEND_DIR/package.json" ]] || fail "Frontend directory not found: $FRONTEND_DIR"

require_command uv 'uv was not found in PATH. Install it from https://docs.astral.sh/uv/getting-started/installation/'
require_command npm 'npm was not found in PATH. Install Node.js first.'
require_command curl 'curl was not found. Install the macOS command line tools first.'
require_command lsof 'lsof was not found. Install the macOS command line tools first.'

printf '[Backend] Preparing dependencies...\n'
(cd "$BACKEND_DIR" && uv sync --all-packages) || fail 'Backend dependency setup failed.'

printf '[Frontend] Preparing dependencies...\n'
(cd "$FRONTEND_DIR" && npm install --no-audit --no-fund) || fail 'Frontend dependency setup failed.'

if [[ "${1:-}" == '--check' ]]; then
  printf '\n[OK] Paths, tools, and dependencies are ready.\n'
  printf '     Redis: %s (%s)\n' "$REDIS_ENABLED" "$REDIS_URL"
  printf '     SQLite: %s\n' "$BACKEND_DIR/windup.db"
  exit 0
fi

printf '[Redis] Configured but disabled by default. Local login does not require Redis.\n'

if port_is_listening 8000; then
  printf '[Backend] Port 8000 is already in use. Reusing the running service.\n'
else
  printf '[Backend] Initializing SQLite and starting the API...\n'
  : >"$BACKEND_LOG"
  start_backend
fi

printf '[Backend] Waiting for the API...\n'
if ! wait_for_url "$BACKEND_URL/docs"; then
  printf '\nLast backend log lines:\n' >&2
  tail -n 30 "$BACKEND_LOG" 2>/dev/null || true
  fail "Backend was not ready after 45 seconds. Full log: $BACKEND_LOG"
fi

if port_is_listening 5173; then
  printf '[Frontend] Port 5173 is already in use. Reusing the running service.\n'
else
  printf '[Frontend] Starting the development server...\n'
  : >"$FRONTEND_LOG"
  start_frontend
fi

printf '[Frontend] Waiting for the development server...\n'
if ! wait_for_url "$FRONTEND_URL"; then
  printf '\nLast frontend log lines:\n' >&2
  tail -n 30 "$FRONTEND_LOG" 2>/dev/null || true
  fail "Frontend was not ready after 45 seconds. Full log: $FRONTEND_LOG"
fi

printf '\n%s\n' \
  '============================================' \
  '  Windup is ready' \
  "  Frontend : $FRONTEND_URL" \
  "  Backend  : $BACKEND_URL" \
  "  API docs : $BACKEND_URL/docs" \
  "  Database : $BACKEND_DIR/windup.db" \
  "  Redis    : $REDIS_ENABLED ($REDIS_URL)" \
  "  Logs     : $BACKEND_LOG / $FRONTEND_LOG" \
  '============================================' \
  ''

open "$FRONTEND_URL"
printf 'You may close this window. Both services will keep running.\n'

if [[ -t 0 ]]; then
  printf 'Press Return to close this launcher...'
  read -r _
fi
