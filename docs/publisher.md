# MD Publisher operations

[Project overview](../README.md) · [Architecture](architecture.md) · [Application debugging](debugging.md)

MD Publisher supplies official FCIM Page API and PDF bytes to the Cloudflare Broker.
It runs on a machine with working access to FCIM, currently a Windows laptop in Moldova.
It uploads candidate material; the Render application selects, parses, validates, and
accepts each course's timetable. The publisher is part of the recommended broker
topology, not a requirement for the application's direct FCIM mode.

## Installation and credentials

Use Node.js 22 to match the repository toolchain (the standalone publisher declares
Node.js 20 or newer). Install dependencies from the repository root, then build the tool:

```powershell
npm ci
Set-Location tools\md-publisher
npm run build
```

The executable is `dist/tools/md-publisher/src/index.js`, relative to that directory.
The compiled publisher uses Node built-ins at runtime. Keep the checkout at a stable
path because the scheduled task records the executable's absolute path.

Configure the broker with an `MD_PUBLISHER_TOKEN` secret of at least 32 characters.
Configure the laptop with the **same publisher token**, under the Windows account that
will run the task. Use a distinct value for the application's `SCHEDULE_BROKER_SECRET`.

| Credential | Where configured | Authority |
| --- | --- | --- |
| `MD_PUBLISHER_TOKEN` | Broker secret and publisher process environment | Publication upload/completion, publisher heartbeat, and publication status |
| `MD_PUBLISHER_TOKEN_PREVIOUS` | Broker secret during rotation | Accept the old publisher token temporarily |
| `SCHEDULE_BROKER_SECRET` | Broker secret and Render application environment | Authenticated accepted payload/pointer writes; not publisher uploads |

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

## Windows Task Scheduler

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
The installer records the logon model in the state directory's `config.json`.

Keep the default task name if using `doctor`, which checks that name. For a custom state
directory, persist `MD_PUBLISHER_STATE_DIR` for the task's account **and** supply the same
directory to the installer's `-StateDir`. That parameter alone does not pass a state path
to the scheduled Node process. Verify the reported directory after installation.

Task Scheduler prevents overlap for that task; there is no separate local process lock
for manual invocations. Avoid running two publishers against the same local state directory.
Broker immutable writes and CAS govern publication races, but do not isolate local files.
A terminated run may leave partial uploads that the next run can resume; it does not make
an incomplete snapshot current.

## CLI

Run these commands from `tools/md-publisher`:

```powershell
node .\dist\tools\md-publisher\src\index.js publish
node .\dist\tools\md-publisher\src\index.js publish --dry-run
node .\dist\tools\md-publisher\src\index.js check
node .\dist\tools\md-publisher\src\index.js status
node .\dist\tools\md-publisher\src\index.js doctor
```

| Command | Behavior |
| --- | --- |
| `publish` | Compare FCIM with the broker baseline, resume or open a publication as needed, and attempt a terminal heartbeat |
| `publish --dry-run` | Report the decision or resumable operation without broker mutations or a heartbeat |
| `check` | Check upstream drift against the broker baseline; no broker mutation or heartbeat; a publisher token is not required |
| `status` | Read authenticated broker operational state from `/publication-status` |
| `doctor` | Check configuration, token presence/length, state-directory writability, Windows task logon model, and broker connectivity |

All commands accept `--json` for structured results. `publish` can also emit progress
lines, so do not assume its entire standard output is one JSON document. There is no
publisher `--force`. An unchanged source is a successful run.

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
baseline is the snapshot named by `current.json`; the laptop's last-run record is only
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
| `MD_PUBLISHER_LOGON_MODEL` | Optional override of the reported model; normally read from installer-written config |

The state directory contains:

```text
config.json           optional broker/timeout/state defaults and recorded logon model
state/last-run.json    schema-2 baseline cache, anchored by broker_snapshot_id
run/operation.json    resumable operation
run/page.json         exact Page API bytes used to open that operation
run/tmp/, cache/      transient PDF bodies
```

The token is never read from `config.json`. Environment settings take precedence over
config defaults. Old or unanchored last-run records are ignored. Losing the baseline
cache or resume files does not erase broker freshness: the next run rebuilds its view
from the broker. Removing the entire directory also removes optional configuration and
logon-model information; preserve or recreate those settings when moving machines.

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
3. Update the publisher account's persistent token and refresh the execution environment.
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
retention; it does not download missing PDFs or request them from an egress Worker.
See [candidate publication](architecture.md#candidate-publication) and
[retention](architecture.md#retention-and-maintenance) for limits and transaction ordering.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| Configuration error / exit `2` | Bare broker origin, token length, environment under the task's account, and current shell versus persisted values |
| `401` from publisher routes | Confirm the publisher token matches a current/previous broker token; the accepted-state secret does not authorize these routes |
| `503 publisher_credentials_misconfigured` | Broker current token is missing/short, or a publisher credential equals `SCHEDULE_BROKER_SECRET` |
| FCIM `403`, timeout, or refused redirect | Check FCIM access from the publisher machine; inspect the failed heartbeat; previous broker state is retained |
| Missing/stale heartbeat | Check laptop power/network, task history, account logon model, and broker connectivity |
| `409 stale_page` / `400 future_page` | Inspect uploaded page `modified_gmt` and broker baseline/time; equal timestamps are allowed, but no force bypass exists |
| `409 operation_payload_mismatch` / `410 operation_expired` | Client discards the attempt, creates a new operation, and retries once |
| `409 operation_state_corrupt` | Client stops; inspect broker operation/descriptor/page consistency instead of repeatedly retrying |
| Timeout after upload | Next run can resume and reuse already stored files |
| `superseded` | Another snapshot won CAS; next run compares against the winning broker baseline |
| Candidate published but app unchanged | Inspect application validation, accepted-state writes, and schedule hash; publication alone does not mean acceptance |
| Doctor reports S4U | Review the registration, then explicitly reinstall with a supported logon model and `-Force` |

For publisher development, use `npm run typecheck` and `npm run build` from
`tools/md-publisher`, or `npm run typecheck:publisher` and `npm run build:publisher` from
the repository root. Publisher/broker tests are part of the root Vitest suite and use
in-process transports. A real R2 checksum-rejection check needs separate disposable
infrastructure; local test doubles are not evidence of a live-bucket check.
