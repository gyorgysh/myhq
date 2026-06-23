# Work Playbook

Operational conventions for this machine. The bot loads this file on **every**
turn, so edits take effect immediately — keep it short, accurate, and specific.
Everything below is an editable example; replace it with what's true for your box.

## Ground rules
- This runs unattended over Telegram. Prefer non-interactive commands (no prompts
  that wait for stdin); pass flags like `-y` where appropriate.
- Confirm before anything destructive or irreversible (deleting data, dropping a
  database, `rm -rf`, force-pushing). State exactly what will happen first.
- When a request is ambiguous, ask one short clarifying question rather than guess.

## Services
When asked to start/stop/restart a service, use these exact commands:

- **Apache (httpd)**: `sudo apachectl restart` — config test first with `sudo apachectl configtest`.
  - Logs: `/usr/local/var/log/httpd/` (or `/var/log/apache2/`).
- **nginx**: `sudo nginx -t && sudo nginx -s reload`.
- **PostgreSQL** (Homebrew): `brew services restart postgresql`.
- **Docker containers**: `docker restart <name>`; check with `docker ps`.

## Scheduled jobs / crontab
- View current crontab: `crontab -l`.
- Edit safely (don't open the interactive editor): write the full crontab to a
  file and install it, e.g. `crontab /path/to/new.crontab`. Always show the diff
  vs. `crontab -l` before installing, and keep a backup of the previous one.
- Job format reminder: `min hour day-of-month month day-of-week command`.
- For macOS-native scheduling prefer `launchd` plists in `~/Library/LaunchAgents/`
  when a job must survive reboots or run in a user session.

## Deploys / common tasks
<!-- Add your own recurring tasks here so the bot does them the same way each time. -->
- Example — "deploy the site": `cd /path/to/project && git pull && npm ci && npm run build && sudo apachectl restart`.

## Managing this agent (self-service)
This bot runs as an OS service: **systemd** (`telegram-agent`) on Linux, or a
**launchd** LaunchAgent (`sh.gyorgy.telegram-agent`) on macOS. Prefer the
cross-platform wrapper, run from the project directory:

- **Restart**: `./scripts/agentctl.sh restart`
- **Stop / Start**: `./scripts/agentctl.sh stop` / `./scripts/agentctl.sh start`
- **Status**: `./scripts/agentctl.sh status`
- **Logs**: `./scripts/agentctl.sh logs`

Native equivalents if you need them:
- Linux: `sudo systemctl restart telegram-agent` (logs: `journalctl -u telegram-agent`)
- macOS: `launchctl kickstart -k gui/$(id -u)/sh.gyorgy.telegram-agent`

Notes:
- On Linux the systemctl management commands are passwordless (a scoped sudoers
  rule installed by the installer). On macOS it is a per-user agent, so no sudo.
- **Restarting kills the current process** — the in-flight reply stops and the
  Telegram connection re-establishes automatically. That is expected: run the
  restart command last, and do not try to report back afterward in the same turn.
- To apply code changes: `cd` to the project, `git pull` (if applicable),
  `npm install && npm run build`, then restart the service.

## Conventions
- Where new files go: for one-off creations (a script you were asked to write, a
  generated file, a download, scratch work), write them into the current working
  directory using **relative paths** (e.g. `./png2webp.sh`), not an absolute path
  into the bot's own source tree. The working directory defaults to a gitignored
  `data/` folder, so ad-hoc creations stay out of the project. When the request is
  clearly about an existing project, work inside that project instead.
- Timezone / schedules: assume the machine's local time unless a job says UTC.
