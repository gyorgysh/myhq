#!/usr/bin/env bash
#
# Linux/systemd manager.
# Usage: agentctl.sh {start|stop|restart|status|logs|enable|disable}

set -euo pipefail
SERVICE=telegram-agent

command -v systemctl >/dev/null 2>&1 || { echo "✖ systemd not found." >&2; exit 1; }

cmd="${1:-status}"
case "$cmd" in
  start|stop|restart|enable|disable) sudo systemctl "$cmd" "$SERVICE" ;;
  status) systemctl status "$SERVICE" --no-pager ;;
  logs)   journalctl -u "$SERVICE" -n 100 -f ;;
  *) echo "Usage: $0 {start|stop|restart|status|logs|enable|disable}" >&2; exit 1 ;;
esac
