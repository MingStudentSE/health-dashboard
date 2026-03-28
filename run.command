#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3030}"
URL="http://127.0.0.1:${PORT}"

echo ""
echo "Health Dashboard"
echo "Workspace: $SCRIPT_DIR"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed or not in PATH."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is not installed or not in PATH."
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "Error: sqlite3 is not installed or not in PATH."
  exit 1
fi

echo "Building latest dashboard assets..."
npm run build:standalone

echo ""
echo "Opening browser at ${URL}"
open "$URL" >/dev/null 2>&1 || true

echo "Starting local app on ${URL}"
echo "Press Ctrl+C to stop."
echo ""

npm run start
