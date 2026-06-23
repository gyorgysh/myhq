#!/usr/bin/env bash
#
# agentctl.sh — manage the bot service. Dispatches to the platform
# implementation: systemd on Linux, launchd on macOS.
#
# Usage: ./scripts/agentctl.sh {start|stop|restart|status|logs}

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -s)" in
  Darwin) exec "$DIR/macos/agentctl.sh" "$@" ;;
  Linux)  exec "$DIR/linux/agentctl.sh" "$@" ;;
  *) echo "✖ Unsupported OS: $(uname -s) (Linux and macOS only)." >&2; exit 1 ;;
esac
