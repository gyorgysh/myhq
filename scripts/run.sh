#!/usr/bin/env bash
#
# run.sh — launcher for the bot. Builds if needed, then runs dist/index.js.
# Used both by the systemd unit (ExecStart) and for manual runs.
#
# Override the node binary with NODE_BIN (the installer bakes this into the
# unit so systemd's minimal PATH still finds the right node).

set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

NODE="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  echo "✖ node not found. Install Node 20+ or set NODE_BIN." >&2
  exit 1
fi

if [ ! -f dist/index.js ]; then
  echo "• Building…"
  npm run build
fi

exec "$NODE" dist/index.js
