#!/usr/bin/env bash
#
# install-service.sh — install the bot as an OS service. Dispatches to the
# platform implementation: systemd on Linux, launchd on macOS.

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -s)" in
  Darwin) exec "$DIR/macos/install-service.sh" "$@" ;;
  Linux)  exec "$DIR/linux/install-service.sh" "$@" ;;
  *) echo "✖ Unsupported OS: $(uname -s) (Linux and macOS only)." >&2; exit 1 ;;
esac
