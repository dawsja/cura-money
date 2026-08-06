#!/usr/bin/env bash
# Local dev helper. Starts Postgres, then runs the Hono app + Vite
# dev server side-by-side. Use Ctrl-C to stop everything.
#
# On Windows: run this in WSL or Git Bash (Docker Desktop is required).
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
  echo ""
  echo "[dev] shutting down..."
  jobs -p | xargs -r kill 2>/dev/null || true
  wait || true
  echo "[dev] done"
}
trap cleanup INT TERM EXIT

echo "[dev] starting Postgres..."
docker compose up db -d

echo "[dev] waiting for Postgres to be healthy..."
for i in {1..30}; do
  if docker compose exec -T db pg_isready -U cura >/dev/null 2>&1; then
    echo "[dev] Postgres ready"
    break
  fi
  sleep 1
done

echo "[dev] running migrations..."
docker compose run --rm app bun run db:migrate || true

echo "[dev] starting API (Hono) on :3000..."
docker compose up app &
APP_PID=$!

echo "[dev] starting UI (Vite) on :5173..."
( cd src/ui && bun run dev ) &
UI_PID=$!

echo ""
echo "================================================================"
echo "  Cura Money dev stack is up"
echo "    API:    http://localhost:3000"
echo "    UI:     http://localhost:5173"
echo "  Press Ctrl-C to stop."
echo "================================================================"

wait "${APP_PID}" "${UI_PID}"
