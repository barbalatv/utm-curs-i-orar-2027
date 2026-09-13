# MD Publisher operations

[Project overview](../README.md) · [Architecture](architecture.md) · [Application debugging](debugging.md)

MD Publisher supplies official FCIM Page API and PDF bytes to the Cloudflare Broker.
It runs on an operator-managed publisher host with working access to FCIM.
It uploads candidate material; the Render application selects, parses, validates, and
accepts each course's timetable. The publisher is part of the recommended broker
topology, not a requirement for the application's direct FCIM mode.

## Installation and credentials

Use Node.js 22 for the repository build toolchain (matching CI); the standalone
publisher requires Node.js 20 or newer and uses only Node built-ins at runtime.
Install dependencies and build from the repository root, in either a POSIX shell or
PowerShell:

```text
npm ci
npm run build:publisher
```

The executable is `tools/md-publisher/dist/tools/md-publisher/src/index.js`, relative
to the repository root. Keep the checkout at a stable path because external schedulers
record its location. The CLI supports Linux, Windows, and manual invocation; scheduling
is external to publication logic.

Configure the broker with an `MD_PUBLISHER_TOKEN` secret of at least 32 characters.
Configure the publisher host with the **same publisher token**, under the account that
will run the process. Use a distinct value for the application's `SCHEDULE_BROKER_SECRET`.

| Credential | Where configured | Authority |
| --- | --- | --- |
| `MD_PUBLISHER_TOKEN` | Broker secret and publisher process environment | Publication upload/completion, publisher heartbeat, and publication status |
| `MD_PUBLISHER_TOKEN_PREVIOUS` | Broker secret during rotation | Accept the old publisher token temporarily |
| `SCHEDULE_BROKER_SECRET` | Broker secret and Render application environment | Authenticated accepted payload/pointer writes; not publisher uploads |

The publisher reads credentials from its process environment; it does not save the token
in state files or heartbeats. Keep environment files and actual values outside the
repository. Do not place `SCHEDULE_BROKER_SECRET` on the publisher host.

## Current production deployment: Debian user-systemd

The current production publisher runs on a dedicated Debian production host under a
user-level systemd timer. Read-only operational inspection on 2026-09-13 verified Debian
GNU/Linux 13 (trixie), x86-64, user-level systemd under the dedicated runtime account
(`$USER`) with `Linger=yes`, Node.js 20 (v20.19.2 at `/usr/bin/node`), and checkout
under the runtime user's home at `$HOME/utm-curs-i-orar-2027` (`%h/utm-curs-i-orar-2027`).
The primary Windows laptop's publisher execution is disabled. These are deployment
details; the architecture remains **Publisher host → Cloudflare Broker → Render
semantic acceptance**.

The installed model is a timer invoking a oneshot process, which publishes and exits:

```text
user systemd timer → oneshot publisher process → exit → next timer invocation
```

The timer is enabled and active. The service is static (not separately enabled),
`Type=oneshot`, with the default `Restart=no`; being inactive between invocations is
normal. `Linger=yes` lets the user manager run without an active SSH/login session.
Successful candidate publications and repeated `unchanged` runs confirm this deployment
is functional. Cron and a continuously running publisher daemon are not part of it.

### Checkout, environment, and unit installation

Run these commands as the publisher account on the intended host. For a new installation,
clone to the location used by the repository-owned units, then perform the build above:

```sh
git clone https://github.com/barbalatv/utm-curs-i-orar-2027.git "$HOME/utm-curs-i-orar-2027"
cd "$HOME/utm-curs-i-orar-2027"
npm ci
npm run build:publisher
/usr/bin/node --version
test -r tools/md-publisher/dist/tools/md-publisher/src/index.js
```

For an existing installation, use the [safe update procedure](#safe-manual-deployment-update)
below. Provision the environment file outside the checkout; editing it avoids placing
token values in shell command history:

```sh
install -d -m 700 "$HOME/.config/fcim-md-publisher"
(umask 077; touch "$HOME/.config/fcim-md-publisher/env")
chmod 600 "$HOME/.config/fcim-md-publisher/env"
${EDITOR:-vi} "$HOME/.config/fcim-md-publisher/env"
```

Use systemd `EnvironmentFile` assignments (`KEY=value`, without `export`). Configure
`MD_PUBLISHER_BROKER_URL` and `MD_PUBLISHER_TOKEN`. The verified production file also
contains `MD_PUBLISHER_LOGON_MODEL`; preserve its existing operational value during
updates. This optional heartbeat label does not select the scheduler or control linger.
The owner must be the runtime account, the directory mode `700`, and file mode `600`.
Do not copy its contents into git, diagnostic reports, or unit files.

Before copying or replacing anything during initial adoption or unit updates, run a
read-only comparison against the tracked units. Tracked units are canonical repository
examples and the current contract, but the installed deployment must first be compared
against them to see local divergence without blindly overwriting existing production units.
Also check active definitions including any drop-in overrides:

```bash
diff -u \
  ~/.config/systemd/user/fcim-md-publisher.service \
  tools/md-publisher/systemd/fcim-md-publisher.service || true

diff -u \
  ~/.config/systemd/user/fcim-md-publisher.timer \
  tools/md-publisher/systemd/fcim-md-publisher.timer || true

systemctl --user cat fcim-md-publisher.service
systemctl --user cat fcim-md-publisher.timer
```

Install the tracked [service](../tools/md-publisher/systemd/fcim-md-publisher.service)
and [timer](../tools/md-publisher/systemd/fcim-md-publisher.timer) after reviewing differences:

```sh
install -d -m 700 "$HOME/.config/systemd/user"
install -m 644 tools/md-publisher/systemd/fcim-md-publisher.service "$HOME/.config/systemd/user/"
install -m 644 tools/md-publisher/systemd/fcim-md-publisher.timer "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
loginctl enable-linger "$(id -un)"
loginctl show-user "$(id -un)" --property=Linger
```

`loginctl enable-linger <user>` is a one-time requirement for autonomous operation;
host policy may require administrator authorization for it. All `systemctl --user`
and diagnostic commands run as the publisher account without root. Confirm `Linger=yes`.

The service intentionally uses `%h/utm-curs-i-orar-2027` as its working directory,
`%h/.config/fcim-md-publisher/env` as its environment file, and `/usr/bin/node` with the
compiled entry point and `publish`. `%h` resolves to the runtime account's home.
For another checkout or Node location, adjust the installed service paths together;
the shipped paths reproduce the verified production configuration.

### Manual commands using the service environment

An SSH shell does not automatically inherit the service's environment file. This shell
helper runs a CLI command in a separate transient user oneshot with the same working
directory, executable, and environment file. It does not print the token or require
shell-sourcing systemd configuration:

```sh
publisher_cli() {
  systemd-run --user --wait --pipe --collect \
    --property=Type=oneshot \
    --property="WorkingDirectory=$HOME/utm-curs-i-orar-2027" \
    --property="EnvironmentFile=$HOME/.config/fcim-md-publisher/env" \
    /usr/bin/node "$HOME/utm-curs-i-orar-2027/tools/md-publisher/dist/tools/md-publisher/src/index.js" "$@"
}
publisher_cli doctor --json
publisher_cli status --json
```

Before first activation, `doctor` will flag the timer as not enabled/active; verify all
other checks, then enable and start the timer and repeat `doctor`:

```sh
systemctl --user enable --now fcim-md-publisher.timer
publisher_cli doctor --json
systemctl --user is-enabled fcim-md-publisher.timer
systemctl --user is-active fcim-md-publisher.timer
systemctl --user list-timers --all fcim-md-publisher.timer
systemctl --user status fcim-md-publisher.timer fcim-md-publisher.service --no-pager
journalctl --user -u fcim-md-publisher.service --since today --no-pager
```

The timer contains `OnBootSec=2min`, `OnUnitActiveSec=20min`, `Persistent=true`,
`Unit=fcim-md-publisher.service`, and `WantedBy=timers.target`. Enabling it after the
boot deadline can start a run immediately. `Persistent=true` is retained exactly as
deployed, but systemd's missed-run catch-up applies to `OnCalendar` timers; it adds no
catch-up guarantee to this monotonic timer. The next interval supplies the baseline
retry after a transient failure. See [systemd.timer](https://manpages.debian.org/trixie/systemd/systemd.timer.5.en.html).

To request a normal publication manually through the installed service:

```sh
systemctl --user start fcim-md-publisher.service
journalctl --user -u fcim-md-publisher.service -n 80 --no-pager
```

Systemd serializes invocations of that same service. The `publisher_cli` helper creates
separate transient units: before using it for `check` or `publish --dry-run`, stop the
timer and wait for the service to finish as below, because even these commands can alter
local cache files. For a manual `publish`, prefer the installed service. The core CLI
can also run directly with an already configured process environment, without systemd.

### Safe manual deployment update

Deployment updates and timetable publication are separate operations. Never add `git pull`
to the service or timer. Systemd executes compiled JS from `dist`; fetching or updating
source alone does not update that executable.

Read-only inspection on 2026-09-13 found server HEAD `4d47711` and GitHub main `142a693`:
the server was 16 commits behind with no server-only commits. Fetch had refreshed
`origin/main`, while the server's working tree was intentionally left unchanged.
These are dated observations, not revision pins or a claim that an update was deployed.

Perform this procedure interactively as the runtime account. Stop at a failed check;
do not resume scheduling with an unsuccessful build.

1. Enter the checkout and require a clean tree (including untracked files). Inspect any
   output from `git status --porcelain` and resolve it deliberately before proceeding:

   ```sh
   cd "$HOME/utm-curs-i-orar-2027"
   git status --short --branch
   git status --porcelain
   PREVIOUS_COMMIT="$(git rev-parse HEAD)"
   printf 'Previous production commit: %s\n' "$PREVIOUS_COMMIT"
   git fetch origin
   git log --oneline HEAD..origin/main
   git diff --stat HEAD..origin/main
   git merge-base --is-ancestor HEAD origin/main
   ```

   Record the old revision (`$PREVIOUS_COMMIT`) for recovery. The last command must succeed: if histories
   diverge, stop and reconcile them separately; do not reset or force an update.

2. Pause new invocations and let the current oneshot finish. Stopping the timer does
   **not** stop an already running service:

   ```sh
   systemctl --user stop fcim-md-publisher.timer
   systemctl --user show fcim-md-publisher.service --property=ActiveState,SubState,MainPID
   systemctl --user list-jobs --no-pager
   ```

   Continue only when the service is `inactive` or `failed`, `MainPID=0`, and no start
   job for it is pending. If it is `activating`, `active`, or `deactivating`, wait and
   recheck. Ensure no separately launched manual publisher is running. Do not kill an
   in-flight publication just to update code. Avoid other operators starting a run
   during this maintenance window.

3. With the timer stopped and the service idle, recheck the clean tree, fast-forward,
   install the locked build dependencies (including dev dependencies), and rebuild.
   This guarded subshell exits at any failure and leaves the timer stopped:

   ```sh
   (
     set -eu
     test -z "$(git status --porcelain)"
     git merge --ff-only origin/main
     npm ci --include=dev
     npm run typecheck:publisher
     npm run build:publisher
     /usr/bin/node tools/md-publisher/dist/tools/md-publisher/src/index.js --help
   )
   ```

4. Review the tracked units against the installed versions and any local overrides.
   Perform a read-only comparison before copying or replacing anything, and check for
   drop-in overrides:

   ```bash
   diff -u \
     ~/.config/systemd/user/fcim-md-publisher.service \
     tools/md-publisher/systemd/fcim-md-publisher.service || true

   diff -u \
     ~/.config/systemd/user/fcim-md-publisher.timer \
     tools/md-publisher/systemd/fcim-md-publisher.timer || true

   systemctl --user cat fcim-md-publisher.service
   systemctl --user cat fcim-md-publisher.timer
   ```

   Tracked units are canonical repository examples and the current contract, but the
   installed deployment must first be compared against them to see local divergence without
   blindly overwriting production units. If a unit changed, apply the reviewed service/timer
   files using the installation commands above, preserving intentional path customizations,
   then run `systemctl --user daemon-reload`. Preserve the environment file and publisher state.
   Use the `publisher_cli` helper above to run `doctor --json`, `status --json`, and
   `check --json`. While maintenance is active, the timer's inactive check is expected;
   every other diagnostic must pass before resuming. Resolve errors while it is stopped.

5. After successful build and verification, run `systemctl --user start fcim-md-publisher.timer`.
   Confirm `is-enabled`, `is-active`, `list-timers`, and `publisher_cli doctor --json`
   using the status commands above; inspect the next run with `journalctl --user` and
   `publisher_cli status --json`. Starting this timer can immediately invoke the service.
   Leave it stopped if verification fails and investigate/rebuild a reviewed revision
   before scheduling again. There is no automatic code update or rollback.

### Emergency recovery after a failed deployment update

If dependency installation (`npm ci`), compilation (`npm run build:publisher`), or post-update
verification fails:

* The timer must remain stopped.
* The operator must first verify that no unexpected manual or local uncommitted changes
  exist that need to be preserved.
* The operator can then restore the saved known-good revision (`$PREVIOUS_COMMIT`).
* Rebuild the previous publisher build.
* Verify the restored publisher.
* Only then restart the timer.

> [!WARNING]
> `git reset --hard` is permitted here only as a controlled emergency rollback on a dedicated
> production checkout to restore `$PREVIOUS_COMMIT`.
> * Before executing it, run `git status --short` to verify that there are no manual or local
>   uncommitted changes that need to be preserved.
> * This is **not** a regular update mechanism. Normal deployment updates remain strictly
>   fast-forward-only (`git merge --ff-only origin/main`).
> * Never use `git pull`.
> * Do not add automatic rollback or self-update scripts to the service or scheduler.

Explicit emergency recovery workflow:

```bash
git status --short
git reset --hard "$PREVIOUS_COMMIT"
npm ci --include=dev
npm run build:publisher

node tools/md-publisher/dist/tools/md-publisher/src/index.js doctor
node tools/md-publisher/dist/tools/md-publisher/src/index.js status
node tools/md-publisher/dist/tools/md-publisher/src/index.js check

systemctl --user start fcim-md-publisher.timer
systemctl --user status fcim-md-publisher.timer --no-pager
```

## Optional Windows deployment

For persistent Windows configuration, replace the placeholders below:

```powershell
setx MD_PUBLISHER_BROKER_URL "https://<broker-host>"
setx MD_PUBLISHER_TOKEN "<publisher-token-at-least-32-characters>"
```

`setx` updates the account's persistent environment, not the current shell. Open a new
PowerShell session before running the CLI; after an account environment change, sign
out and back in if the task still sees old values. Return to `tools/md-publisher` in the
new session.

The persistent token is stored in that user's registry environment (`HKCU\Environment`),
where processes running as that account can read it. The command can also remain in
shell history. Treat the account and its history as secret-bearing storage. The publisher
reads the process environment; it does not save the token in its state files or heartbeat.
Do not place `SCHEDULE_BROKER_SECRET` on the publisher machine.

### Windows Task Scheduler

From `tools/md-publisher`, choose the logon model explicitly:

```powershell
.\install-task.ps1 -LogonMode Interactive
```

Interactive mode runs while the account is logged on. If the machine needs execution
before logon, use Password mode instead; the installer prompts for the account password:

```powershell
.\install-task.ps1 -LogonMode Password -User "MACHINE\account"
```

The default task is **FCIM MD Publisher**. It runs `publish` every 20 minutes, with a
10-minute execution limit, `RunLevel Limited`, and `MultipleInstances IgnoreNew`.
`-IntervalMinutes` and `-ExecutionTimeLimitMinutes` change the cadence and limit. Keep
the execution limit below the interval so stalled runs do not suppress subsequent ones.

S4U is not supported. If an existing task uses S4U, the installer refuses to replace it
silently. After reviewing that registration, explicitly replace it with the desired model:

```powershell
.\install-task.ps1 -LogonMode Interactive -Force
```

This installer `-Force` replaces the task registration; it is not a publication bypass.
The installer records the logon model and task name in the state directory's `config.json`.
`doctor` reads that `task_name` and identifies the task it checked; absent, empty, or non-string
values fall back to **FCIM MD Publisher**.

For a custom state directory, supply `-StateDir "C:\Publisher state"` to the installer.
It forwards that directory to the scheduled Node process in both logon modes. For manual
commands, use `--state-dir "C:\Publisher state"` (which overrides `MD_PUBLISHER_STATE_DIR`)
or set `MD_PUBLISHER_STATE_DIR`. Use the same directory for `doctor` so it reads the installed
task name, including a custom `-TaskName`. Verify the reported directory after installation.

Task Scheduler prevents overlap for that task; there is no separate local process lock
for manual invocations. Avoid running two publishers against the same local state directory.
Broker immutable writes and CAS govern publication races, but do not isolate local files.
A terminated run may leave partial uploads that the next run can resume; it does not make
an incomplete snapshot current.

## CLI

Run these commands from `tools/md-publisher`:

```text
node dist/tools/md-publisher/src/index.js publish
node dist/tools/md-publisher/src/index.js publish --dry-run
node dist/tools/md-publisher/src/index.js check
node dist/tools/md-publisher/src/index.js status
node dist/tools/md-publisher/src/index.js doctor
```

| Command | Behavior |
| --- | --- |
| `publish` | Compare FCIM with the broker baseline, resume or open a publication as needed, and attempt a terminal heartbeat |
| `publish --dry-run` | Report the decision or resumable operation without broker mutations or a heartbeat |
| `check` | Check upstream drift against the broker baseline; no broker mutation or heartbeat; a publisher token is not required |
| `status` | Read authenticated broker operational state from `/publication-status` |
| `doctor` | Check configuration, token presence/length, state-directory writability, platform scheduler, and broker connectivity |

All commands accept `--json` for structured results. `publish` can also emit progress
lines, so do not assume its entire standard output is one JSON document. There is no
publisher `--force`. An unchanged source is a successful run.

On Linux, `doctor` checks the user service/timer, persistent timer enablement, active
state, service target and oneshot type, linger, expected environment-file reference,
file readability/private permissions, working directory, executable, and compiled entry
point. It uses bounded read-only `systemctl --user show` / `loginctl show-user` probes.
It never reads environment-file contents, outputs raw service arguments or subprocess
errors, starts services, enables linger, or repairs units. It checks the invocation's
token separately; it cannot prove that the file holds the same token. Use the helper
above to diagnose with the service environment.

No installed publisher units (or no `systemctl` and no local units) is reported explicitly
as manual operation being available; scheduling is not a core CLI requirement. A partial
installation, inaccessible user manager, malformed probe response, or unverifiable linger
fails scheduler diagnostics. A static/inactive oneshot or the last run having failed
does not by itself fail scheduler diagnostics; inspect the journal/heartbeat for run
outcomes. On Windows the existing task-name/logon checks, S4U rejection, installer, and
PowerShell BOM-compatible configuration remain supported. Other platforms report scheduler
diagnostics as not applicable. `logon_model` remains `not-applicable` for Linux.

Evaluating fresh work with `check` or dry-run still requires broker reads and FCIM checks:
`current.json` and, as needed, its manifest and `page-api.json`. Both may clear disposable
local cache bodies. Dry-run can refresh the local baseline cache on an unchanged result;
it preserves a valid resumable attempt and reports that attempt without repeating fresh
discovery. Invalid local resume state can be discarded. `doctor` also tests directory writability.

Publish/check outcomes `unchanged`, `published`, `superseded`, and `dry_run` exit `0`;
failed runs exit `1`; usage or configuration errors exit `2`. `status` and `doctor` exit
nonzero when their checks fail. `superseded` means another snapshot won the publication
race, not that this candidate was accepted by Render.

## Freshness, resume state, and uploads

Fresh attempts compare FCIM against what the broker currently serves. The authoritative
baseline is the snapshot named by `current.json`; the publisher's last-run record is only
a cache of that snapshot. An absent baseline or missing manifest digest means the client
cannot prove the source unchanged and needs a publication.

A changed page or a conditional PDF response of `200` can trigger publication even if
the PDF URL is unchanged. With no usable validator, the client downloads and compares
hashes. It never treats an upstream error as an unchanged result. After completion or
a lost CAS race, it rebuilds its cache from the broker's actual current snapshot.

An attempt resumes only when `run/operation.json` and `run/page.json` exist and the
page hash matches the recorded operation. A new attempt uses a new UUIDv4. PDFs are
downloaded one at a time into temporary files, counted, hashed, checked for `%PDF-`, and
streamed to the broker with exact `Content-Length`. A file already marked `stored` in
the broker plan is reused; the next publication can capture any later upstream change.

The canonical Page API URL and official PDF URL policy come from the
[shared policy module](../worker-shared/fcim-policy.ts). The endpoint is not configurable.
The publisher revalidates the broker's planned PDF URLs before requests and on each
redirect. Page API redirects are refused.

## Configuration and local state

| Setting | Requirement / default |
| --- | --- |
| `MD_PUBLISHER_BROKER_URL` | Required unless supplied as `broker_url` in optional config; bare HTTPS origin, no path/query/credentials; HTTP permitted only on localhost or 127.0.0.1 |
| `MD_PUBLISHER_TOKEN` | Required for publish/status; at least 32 characters; process environment only |
| `MD_PUBLISHER_STATE_DIR` | `%LOCALAPPDATA%\fcim-md-publisher`; without LOCALAPPDATA, `.fcim-md-publisher` under the user's home directory |
| `MD_PUBLISHER_TIMEOUT_MS` | `30000` per request |
| `MD_PUBLISHER_LOGON_MODEL` | Optional heartbeat label, or logon model from Windows installer-written config; does not control scheduling |

The state directory contains:

```text
config.json           optional broker/timeout/state defaults, recorded logon model and task name
state/last-run.json    schema-2 baseline cache, anchored by broker_snapshot_id
run/operation.json    resumable operation
run/page.json         exact Page API bytes used to open that operation
run/tmp/, cache/      transient PDF bodies
```

The token is never read from `config.json`. Environment settings take precedence over
config defaults. Old or unanchored last-run records are ignored. Losing the baseline
cache or resume files does not erase broker freshness: the next run rebuilds its view
from the broker. Removing the entire directory also removes optional configuration and
logon-model/task-name information; preserve or recreate those settings when moving machines.

## Status, doctor, and heartbeats

After installation, run `doctor`, then `check`, and use `publish` for normal operation.
Inspect `status` after a publication. It includes current snapshot age, open-publication
count, publisher heartbeat and age, per-course accepted pointers, and warnings.

The broker timestamps heartbeat receipt with its own `received_at`. Normal publish runs
attempt a bounded heartbeat on terminal outcomes, including unchanged and failed runs.
If delivery fails, the result reports `heartbeat: failed` and logs the failure; it does
not change the publication outcome or exit code. No heartbeat is written by check or
dry-run. Heartbeats describe publisher activity, not whether Render accepted a candidate.

Useful warnings include `no_current_snapshot`, `current_pointer_unreadable`,
`no_publisher_heartbeat`, `publisher_heartbeat_stale` (over six hours),
`last_publisher_run_failed`, and course-specific unreadable accepted pointers.
A quiet source should still have recent successful publisher heartbeats.

## Token rotation

1. Set the broker's `MD_PUBLISHER_TOKEN_PREVIOUS` to the old publisher token.
2. Set its `MD_PUBLISHER_TOKEN` to a new token of at least 32 characters, distinct from
   `SCHEDULE_BROKER_SECRET`.
3. Update the publisher environment file on Debian (each new oneshot reads it), or the
   Windows account's persistent token and execution environment. Preserve file permissions.
4. Verify `status` and a normal publisher run with the new token, then remove the broker's
   `MD_PUBLISHER_TOKEN_PREVIOUS` secret.

If a token is compromised, revoke the old value rather than leaving it valid for an
overlap period. Current and previous publisher tokens are never accepted on accepted-state
write routes. A missing/short current token or a publisher token equal to the accepted-state
secret closes publisher routes with `503 publisher_credentials_misconfigured`.

## Trust boundary and recovery limits

The publisher can upload candidate bytes and request completion. It cannot parse or
accept a timetable on Render's behalf, write accepted state, choose storage identifiers,
or write arbitrary R2 keys. The broker derives the catalogue from the supplied page and
checks URL policy, size, integrity, and publication consistency.

These checks do not independently authenticate uploaded content against FCIM. A compromised
publisher can submit fabricated bytes within the transport constraints, and structural
schedule validation is not proof of authenticity. Keep publisher and accepted-state
credentials separate, and rotate publisher credentials if its account is compromised.

If suspect material is only a candidate, restore trusted publisher access and inspect a
new genuine publication and Render's acceptance result. If suspect material has already
become durable accepted state, automatic recovery is not assured: that accepted schedule
participates in validation of its successor. The repository does not provide an operator
accepted-state rollback command. Deleting Render's local cache or invoking its direct
admin refresh does not repair the durable accepted record; synchronization can restore
the same record. Investigate the accepted pointer/payload before planning recovery.

## Broker contract

These are authenticated infrastructure endpoints for the publisher, separate from the
application's public timetable API:

| Route | Purpose |
| --- | --- |
| `POST /publications` | Open or resume a publication from raw Page API bytes |
| `GET /publications/:snapshot_id` | Read broker-derived plan and file state |
| `PUT /publications/:snapshot_id/files/:file_id` | Upload one planned PDF |
| `POST /publications/:snapshot_id/complete` | Finalize a complete candidate; may advance `current.json` |
| `PUT /publisher/heartbeat` | Record bounded publisher status |
| `GET /publication-status` | Read operational state |

The old `POST /publish` endpoint is absent. Cron only schedules reconciliation and
retention; missing PDF uploads are supplied by the publisher process.
See [candidate publication](architecture.md#candidate-publication) and
[retention](architecture.md#retention-and-maintenance) for limits and transaction ordering.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| Configuration error / exit `2` | Bare broker origin, token length, environment under the task's account, and current shell versus persisted values |
| `401` from publisher routes | Confirm the publisher token matches a current/previous broker token; the accepted-state secret does not authorize these routes |
| `503 publisher_credentials_misconfigured` | Broker current token is missing/short, or a publisher credential equals `SCHEDULE_BROKER_SECRET` |
| FCIM `403`, timeout, or refused redirect | Check FCIM access from the publisher machine; inspect the failed heartbeat; previous broker state is retained |
| Missing/stale heartbeat | Check publisher host power/network, Linux user timer/linger/journal or Windows task history/logon model, and broker connectivity |
| `409 stale_page` / `400 future_page` | Inspect uploaded page `modified_gmt` and broker baseline/time; equal timestamps are allowed, but no force bypass exists |
| `409 operation_payload_mismatch` / `410 operation_expired` | Client discards the attempt, creates a new operation, and retries once |
| `409 operation_state_corrupt` | Client stops; inspect broker operation/descriptor/page consistency instead of repeatedly retrying |
| Timeout after upload | Next run can resume and reuse already stored files |
| `superseded` | Another snapshot won CAS; next run compares against the winning broker baseline |
| Candidate published but app unchanged | Inspect application validation, accepted-state writes, and schedule hash; publication alone does not mean acceptance |
| Doctor reports S4U | Review the registration, then explicitly reinstall with a supported logon model and `-Force` |
| Linux doctor cannot query user manager | Run as the publisher account in its user session; inspect user-systemd availability and linger |
| Linux doctor reports a missing compiled entry point | Pause the timer, wait for any run to finish, then follow the update/rebuild procedure |

Operational inspection found isolated `upstream check failed: fetch failed` and
`heartbeat not delivered; the run stands as error` entries interspersed with successful
runs (for example, failure at 2026-09-12 14:44 followed by `unchanged` at 15:05).
Subsequent direct checks from that host returned FCIM Page API HTTP 200, valid TLS,
GitHub HTTP 200, and working DNS. These observations do not indicate a broken Debian
topology; the next timer interval provides basic recovery. Investigate repeated failures
or stale heartbeats rather than changing the deployment model for an isolated error.

A separate observed issue is `MaxListenersExceededWarning` about 11 `error` listeners
on a `WriteStream` during PDF download/upload runs that nevertheless published successfully.
GitHub main `142a693` (checked on 2026-09-13) and the cleanup base `3527d0d` still contain
the per-backpressure `handle.once("error", reject)` in
[`downloadPdf`](../tools/md-publisher/src/upstream.ts), without removing that listener
on `drain`. This is a possible source of the warning, not a confirmed root-cause analysis.
Investigation/fix is deferred; the deployment correction does not change download behavior.

For publisher development, use `npm run typecheck` and `npm run build` from
`tools/md-publisher`, or `npm run typecheck:publisher` and `npm run build:publisher` from
the repository root. Publisher/broker tests are part of the root Vitest suite and use
in-process transports. A real R2 checksum-rejection check needs separate disposable
infrastructure; local test doubles are not evidence of a live-bucket check.
