#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "${CLIENT_PID:-}" ]]; then
    kill "$CLIENT_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

npm run dev:server >"$LOG_DIR/software-ass2-backend.log" 2>&1 &
SERVER_PID=$!

npm run dev:client >"$LOG_DIR/software-ass2-frontend.log" 2>&1 &
CLIENT_PID=$!

echo "Frontend: http://localhost:5173"
echo "Backend: http://localhost:8000"
echo "Docs: http://localhost:8000/docs"
echo "Logs: $LOG_DIR"

# If one process falls over, stop the other one too — chaos is not a feature.
while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$CLIENT_PID" 2>/dev/null; do
  sleep 1
done

wait "$SERVER_PID" || true
wait "$CLIENT_PID" || true
exit 1
