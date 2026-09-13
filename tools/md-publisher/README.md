# MD Publisher

Transport-only client for publishing official FCIM timetable bytes to the Cloudflare
Broker. It fetches the canonical Page API and PDFs, hashes and uploads candidates, and
reports run status. The Render application selects, parses, validates, and accepts the
schedule.

The current production publisher runs on a dedicated Debian host under a user-level
systemd timer. See [MD Publisher operations](../../docs/publisher.md) for that deployment,
credentials, optional Windows Task Scheduler, safe updates, and troubleshooting.

## Build

Use Node.js 22 to match the repository toolchain. From the repository root:

```text
npm ci
npm run build:publisher
```

The standalone publisher supports Node.js 20 or newer and uses only Node built-ins at
runtime. Configure `MD_PUBLISHER_BROKER_URL` and `MD_PUBLISHER_TOKEN` for the account that
will run it, following [installation and credentials](../../docs/publisher.md#installation-and-credentials).
The publisher token must be at least 32 characters and differ from
`SCHEDULE_BROKER_SECRET`.

## Commands

From `tools/md-publisher`:

```text
node dist/tools/md-publisher/src/index.js publish
node dist/tools/md-publisher/src/index.js publish --dry-run
node dist/tools/md-publisher/src/index.js check
node dist/tools/md-publisher/src/index.js status
node dist/tools/md-publisher/src/index.js doctor
```

`publish` is the normal scheduled command. `check` and dry-run do not mutate the broker
or send heartbeats. Evaluating fresh work still requires network reads; local cache files
may be cleared or refreshed. Dry-run preserves and reports a valid resumable attempt.
`status` reads broker operational state; `doctor` checks configuration, state-directory
access, the platform scheduler, and broker connectivity. On Linux it diagnoses the
user-systemd deployment; on Windows it retains task registration and logon-model checks.

All commands accept `--json` and `--state-dir <path>` (overrides `MD_PUBLISHER_STATE_DIR`).
There is no publication `--force`. Normal publish/check
outcomes (`unchanged`, `published`, `superseded`, `dry_run`) exit `0`; failed runs exit
`1`; usage/configuration errors exit `2`. A successful publication does not mean Render
accepted its timetable.

## Current production: Debian user-systemd

The tracked [service](systemd/fcim-md-publisher.service) and
[timer](systemd/fcim-md-publisher.timer) reproduce production: user timer → oneshot
`publish` → exit, every 20 minutes after an initial boot delay of two minutes.
The service uses `/usr/bin/node`, the checkout at `%h/utm-curs-i-orar-2027`, and the
private environment file `%h/.config/fcim-md-publisher/env`. Enable linger for autonomous
operation. The timer is enabled/active; a static service with `Restart=no` is expected.

Follow the [Debian installation and status commands](../../docs/publisher.md#current-production-deployment-debian-user-systemd),
including running diagnostics with the service environment. For an update, pause the
timer, wait for the service to finish, verify a clean tree, fetch, fast-forward only,
install dependencies, rebuild, and verify before resuming. The
[safe update procedure](../../docs/publisher.md#safe-manual-deployment-update) covers
failures and local unit customizations. Source updates alone do not rebuild `dist`.

## Optional Windows deployment

After configuring credentials, choose a logon model explicitly:

```powershell
.\install-task.ps1 -LogonMode Interactive
```

For execution before logon, use `-LogonMode Password -User "MACHINE\account"` instead.
Defaults are every 20 minutes with a 10-minute execution limit. S4U is not supported.
`-StateDir "C:\Publisher state"` is forwarded to the scheduled process. The installer records
`-TaskName` in that directory's `config.json`; run `doctor --state-dir "C:\Publisher state"`
to check the recorded task. The default task name remains **FCIM MD Publisher**.
See [Task Scheduler details](../../docs/publisher.md#windows-task-scheduler) for account,
state-directory, and registration behavior.

## State and development

`MD_PUBLISHER_STATE_DIR` defaults to `%LOCALAPPDATA%\fcim-md-publisher` when LOCALAPPDATA
is set (normally Windows), otherwise `~/.fcim-md-publisher` (including Debian).
The broker's `current.json` is the freshness authority; local last-run state is only
usable while it names that snapshot. Resume files and cached PDF bodies are disposable,
but preserve optional `config.json` settings when moving or resetting the state directory.

From this directory:

```text
npm run typecheck
npm run build
```

From the repository root, the equivalents are `npm run typecheck:publisher` and
`npm run build:publisher`. Publisher and broker tests run in the root Vitest suite with
in-process transports; see the [test tiers](../../README.md#testing).
