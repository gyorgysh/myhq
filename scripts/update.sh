#!/usr/bin/env bash
#
# update.sh — pull the latest code, reinstall deps, rebuild, and restart the
# service if one is installed. Safe to run whether you run as a service or by
# hand (it only restarts when a service is actually present).
#
# Usage: ./scripts/update.sh [git-ref]   (defaults to the current branch)

set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

say() { printf '• %s\n' "$*"; }
ok()  { printf '✓ %s\n' "$*"; }

REF="${1:-$(git rev-parse --abbrev-ref HEAD)}"

# `npm install` can rewrite package-lock.json (lockfile version, platform-
# specific optional deps, npm version differences). That drift is noise, not a
# real edit, and would otherwise block every update — so discard it first.
if ! git diff --quiet -- package-lock.json 2>/dev/null; then
  say "Discarding local package-lock.json drift (npm regenerates it)…"
  git checkout -- package-lock.json 2>/dev/null || git restore -- package-lock.json
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✖ You have uncommitted changes. Commit or stash them first." >&2
  git status --short
  echo "  (Tip: these are real source edits, not lockfile drift.)" >&2
  exit 1
fi

say "Fetching…"
git fetch --prune origin
BEFORE="$(git rev-parse HEAD)"
say "Updating to origin/$REF…"
git pull --ff-only origin "$REF"
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  ok "Already up to date ($(git rev-parse --short HEAD))."
else
  ok "Updated $(git rev-parse --short "$BEFORE")..$(git rev-parse --short "$AFTER")."
fi

say "Installing dependencies…"
npm install
say "Building…"
npm run build

# Restart only if a service is installed for this machine.
restart_if_service() {
  case "$(uname -s)" in
    Darwin)
      local plist="$HOME/Library/LaunchAgents/sh.gyorgy.telegram-agent.plist"
      [ -f "$plist" ] || return 1 ;;
    Linux)
      command -v systemctl >/dev/null 2>&1 || return 1
      systemctl list-unit-files 2>/dev/null | grep -q '^telegram-agent\.service' || return 1 ;;
    *) return 1 ;;
  esac
  say "Restarting the service…"
  "$APP_DIR/scripts/agentctl.sh" restart
  ok "Service restarted."
}

if restart_if_service; then :; else
  ok "Build complete. No service installed — restart your manual run to pick up changes."
fi
