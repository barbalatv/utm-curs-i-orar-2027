# Debugging and operations

[Project overview](../README.md) · [Architecture](architecture.md) · [MD Publisher operations](publisher.md)

Commands below run from the repository root unless a different directory is stated.
PowerShell examples use `Invoke-RestMethod` to avoid differences between the Windows
`curl` alias and `curl.exe`.

## Check availability, provenance, and update health

Inspect the course you are diagnosing; Anul I and Anul II have separate state.

```powershell
$appUrl = 'https://utm-curs-i-orar-2027.onrender.com'
$course = 1
Invoke-RestMethod "$appUrl/api/health" | ConvertTo-Json -Depth 6
$status = Invoke-RestMethod "$appUrl/api/status?course=$course"
$status | ConvertTo-Json -Depth 8
$source = Invoke-RestMethod "$appUrl/api/source?course=$course"
$source | ConvertTo-Json -Depth 6
```

`/api/health` reports process liveness and per-course availability. Its `ok: true` does
not establish schedule freshness: it remains true even when no course has data.
`/api/status` reports the selected course's availability, schedule counts, parser version,
last check, last result, and source errors. `source.last_error` may describe an earlier
failed update while a valid schedule remains installed; compare timestamps and served
provenance rather than treating one error string as a complete health verdict.

The current parser version is **1.4.0**. Full schedule metadata, including transport
provenance, is available from the schedule endpoint:

```powershell
$schedule = Invoke-RestMethod "$appUrl/api/schedule?course=$course"
$schedule.metadata | Select-Object course_year, parser_version, source_kind, source_transport, source_snapshot_id, source_pdf_url, source_pdf_hash, downloaded_at, parsed_at
```

| Metadata field | Meaning |
| --- | --- |
| `source_kind` | `live`, `wayback`, `seed`, or `manual`: how the source was selected |
| `source_transport` | `broker` or `direct`; older records default to `direct` when decoded |
| `source_snapshot_id` | Broker candidate snapshot associated with the installed schedule, or `null` for a non-broker source |
| `source_pdf_url`, `source_pdf_hash` | Original PDF provenance and SHA-256 of parsed bytes |
| `parser_version` | Parser that produced this installed schedule; an older recovered schedule can retain an older version until refreshed |
| `downloaded_at`, `parsed_at` | Processing timestamps, not proof that FCIM has published nothing newer |

`/api/status` and `/api/source` currently omit `source_transport` and
`source_snapshot_id`. Read `/api/schedule` metadata or the local schedule JSON for those
fields. A seed uses its original publication URL with `source_kind: seed`; that URL does
not mean the file was fetched live during this run. An unchanged candidate can leave the
installed schedule's snapshot ID unchanged even after the broker publishes another snapshot.

## Public API behavior

All read routes below except health accept `?course=1` or `?course=2`, restricted to the
courses enabled by the deployment. Omission selects `SCHEDULE_DEFAULT_COURSE`, or the
first enabled course if no explicit default is set. With default configuration this is
Anul I. Empty, padded, zero-prefixed, unsupported, or repeated selectors return `400`
with `supported_courses`.

| Route | Response and filters |
| --- | --- |
| `GET /api/health` | `ok`, `status`, `has_schedule`, `courses[]`, and `time`; no per-course error text |
| `GET /api/status` | `has_schedule`, schedule summary, source diagnostics, supported courses, server time, and timezone; `schedule: null` when unavailable |
| `GET /api/source` | PDF URL/hash, source kind, title, academic context, timestamps, validators, and update state; some values can be null |
| `GET /api/groups` | `groups[]` with `name`, `program`, and lesson count, plus total count and update time |
| `GET /api/schedule` | Metadata, groups, days, time slots, sorted lessons, count, and warnings; filters: `group`, `day`, `teacher`, `subject`, `room`, `q` |
| `GET /api/schedule/{group}` | One group's lessons and `by_day`; optional `day` filter |
| `GET /api/schedule/{group}/today` | Current weekday in Europe/Chisinau, lessons, and `is_weekend`; weekends have `day: null` and an empty lesson list |

`groups` and schedule routes try to initialize missing data, then return `503` if the
course still has no schedule. Status and source can return `200` with unavailable/null
schedule information. Group-specific routes return `404` for an unknown group; the
collection route's unknown `group` filter returns an empty match list. A nonempty
unrecognized `day` filter returns `400`.

Group matching is normalized to uppercase. Day filters accept Romanian or English weekday
names; text filters are case- and accent-insensitive. The today endpoint selects the
weekday, **not the current week parity**: it can return odd and even lessons together.
Clients use `week_parity` to distinguish them. API responses use `Cache-Control: no-store`.
Unexpected errors are returned as JSON without stack traces.

Lesson types are `lecture` (Curs), `seminar` (Seminar), `lab` (Laborator), `practice`,
`physical_education`, `language`, `project`, `individual_group_activity`
(Activități Individuale/În Grup), and `unknown`. Week parity is `odd`, `even`, `both`,
or `unknown`. Geometry, raw text, confidence, and uncertainty remain available on lessons;
see the [models](../src/lib/models.ts) for the full schema.

## Configuration and deployment

Basic local startup works with `npm ci` followed by `npm run dev`. An `.env` file is
optional. Use [`.env.example`](../.env.example) as a reference for overrides; application
defaults are in [`config.ts`](../src/lib/config.ts) and [`courses.ts`](../src/lib/courses.ts).

| Variable | Default / purpose |
| --- | --- |
| `SCHEDULE_COURSES` | `1,2`; independent course years to serve |
| `SCHEDULE_DEFAULT_COURSE` | First enabled course; must itself be enabled |
| `SCHEDULE_REFRESH_MINUTES` | `30`; application update interval |
| `SCHEDULE_ODD_WEEK_ANCHOR` | `2026-08-31`; Monday of a university-designated odd week; check each semester |
| `SCHEDULE_DATA_DIR` | `data`; writable root for `courses/<year>/` cache files |
| `DATABASE_URL` | Empty; optional PostgreSQL history/recovery |
| `SCHEDULE_BROKER_URL` | Empty; direct automatic FCIM transport. Set the broker URL for broker mode |
| `SCHEDULE_BROKER_SECRET` | Empty; accepted-state write credential when using the broker |
| `SCHEDULE_BROKER_TIMEOUT_MS` | `3000`; broker metadata/bootstrap and accepted-write request budget |
| `SCHEDULE_ADMIN_TOKEN` | Empty; admin refresh disabled until configured |
| `SCHEDULE_DISABLE_SCHEDULER` | Unset; set `1` to disable automatic scheduler/bootstrap initialization |
| `LOG_LEVEL` | `info`; application log level |

Direct-source options include `SCHEDULE_PAGE_URL`, `SCHEDULE_ALLOWED_HOSTS`,
`SCHEDULE_WORDPRESS_FALLBACK`, `SCHEDULE_WORDPRESS_API_URL`, `SCHEDULE_WAYBACK_FALLBACK`,
`SCHEDULE_HTTP_TIMEOUT_MS` (20000), `SCHEDULE_MAX_REDIRECTS` (5), and
`SCHEDULE_MAX_PDF_MB` (25). WordPress and Wayback fallbacks default to enabled.
These settings do not change the publisher's fixed upstream policy.

Course-list configuration trims whitespace around entries, but rejects empty entries,
unknown years, duplicates, and malformed numbers. Remove the nonempty obsolete
`SCHEDULE_COURSE_YEAR` and use `SCHEDULE_COURSES` instead. Normal deployments require
**zero `SCHEDULE_SEED_*` variables**.

For broker mode, configure the broker URL and matching accepted-state secret on the
application and broker, and operate the publisher with its separate credential. A broker
secret is required for accepting new broker candidates, not for basic startup or direct
mode. See [publisher setup](publisher.md#installation-and-credentials).

Run one application replica. For a local production build:

```text
npm run build
npm start
```

For the container, including a persistent named cache volume:

```text
docker build -t fcim-schedule .
docker run -p 8000:8000 -v fcim-schedule-data:/app/data fcim-schedule
```

Open [localhost:8000](http://localhost:8000). `docker compose up --build` also creates a
persistent cache volume. The checked-in Compose file forwards only its explicitly listed
environment values; an `.env` value is not automatically a container environment variable.
In particular, do not assume a broker URL in `.env` enables broker mode in Compose.

For hosted deployments, provide a writable persistent cache directory where available,
configure environment values on the hosting service, and use `/api/health` for liveness.
Optional PostgreSQL setup uses the checked-in [migrations](../drizzle/):

```powershell
$env:DATABASE_URL = 'postgresql://user:password@host:5432/database'
npm run db:migrate
```

The migrations create/adopt `schedule_versions`, scope rows by course, and enforce one
current row per course. The application records history after local installation and
recovers from the current row when local storage has no usable schedule. Normal API
reads do not query version history for every request.

## Recovery and source failures

The effective cold-start recovery order is:

**In-memory/current cache → scoped local schedule → compatible legacy cache adoption
→ PostgreSQL current/history recovery → broker durable accepted state → verified bundled seed.**

Recovery can display older data while background checks try the configured transport.
Startup is bounded; a missing or invalid source at every layer can leave one course
unavailable without preventing the other course from serving its data. See
[storage and recovery](architecture.md#storage-and-cold-start-precedence).

In direct mode, a blocked FCIM page can lead to the official WordPress fallback, then
optional Wayback discovery. Archive material must match the current academic year.
If downloading or parsing a new source fails, the previous accepted timetable remains.
Cloudflare challenges can affect both discovery and PDFs; an explicit PDF URL does not
bypass those challenges.

In broker mode, a failed broker check retains local data, or attempts a verified seed
when no schedule exists. It does **not** switch automatically to direct FCIM. New
candidates must pass validation and a durable accepted-state write before local replacement.

## Broker and publisher diagnostics

First compare application metadata with the broker's current candidate and accepted pointer.
The broker URL below comes from your deployment configuration:

```powershell
$brokerUrl = $env:SCHEDULE_BROKER_URL.TrimEnd('/')
Invoke-RestMethod "$brokerUrl/health" | ConvertTo-Json
$current = Invoke-RestMethod "$brokerUrl/current.json"
$current | ConvertTo-Json -Depth 6
Invoke-RestMethod "$brokerUrl/snapshots/$($current.snapshot_id)/manifest.json" | ConvertTo-Json -Depth 8
Invoke-RestMethod "$brokerUrl/accepted/course-$course" | ConvertTo-Json -Depth 6
```

These are infrastructure read routes, not the application's student API. A healthy broker
process may still have no current snapshot or accepted pointer (`404`). A new candidate
snapshot does not imply Render accepted it; check the application's result, PDF hash, and
parser metadata. Rejected candidates leave the accepted pointer unchanged. Accepted-write
errors commonly require checking the matching `SCHEDULE_BROKER_SECRET` or a CAS conflict;
a `Durable to local resync failed` message calls for checking cache write access.

On the publisher machine, from `tools/md-publisher`:

```powershell
node .\dist\tools\md-publisher\src\index.js status --json
node .\dist\tools\md-publisher\src\index.js doctor --json
node .\dist\tools\md-publisher\src\index.js check --json
```

`status` reads authenticated `/publication-status`: current snapshot age, open publications,
publisher heartbeat and age, accepted pointers, and warnings. `doctor` checks configuration,
state-directory writability, Windows task registration, and broker connectivity; it is
not an upstream FCIM connectivity test. `check` compares FCIM with the broker baseline
without publishing. See [publisher troubleshooting](publisher.md#troubleshooting).

## Authenticated refresh

`POST /api/admin/refresh` is an operator endpoint. It returns `404` when
`SCHEDULE_ADMIN_TOKEN` is unset and `401` for an invalid bearer token. A valid request can
return HTTP `200` with `outcome: error` or `rejected`: inspect the JSON outcome.

For a normal check using the configured transport, with an existing admin token in the
environment:

```powershell
$headers = @{ Authorization = "Bearer $env:SCHEDULE_ADMIN_TOKEN" }
$body = @{ course = $course; force = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$appUrl/api/admin/refresh" -Headers $headers -ContentType 'application/json' -Body $body
```

`force` requests reprocessing; it does not bypass course or timetable validation. The
body may contain numeric `course`, boolean `force`, and `pdf_url`. Course can alternatively
come from the query string; the body takes precedence. A plain refresh without a selector
uses the configured default. Supplying `pdf_url` requires an explicit course selector.

For direct recovery, supply a verified official PDF URL for that course:

```powershell
$pdfUrl = 'https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-18.pdf'
$body = @{ course = 1; pdf_url = $pdfUrl; force = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$appUrl/api/admin/refresh" -Headers $headers -ContentType 'application/json' -Body $body
Invoke-RestMethod "$appUrl/api/status?course=1" | ConvertTo-Json -Depth 8
```

That URL is a known bundled Anul I publication, **not a claim about the latest timetable**.
Choose the intended official revision before using this recovery operation. Accepted URLs
require HTTPS, exact host `fcim.utm.md`, and
`/wp-content/uploads/sites/24/YYYY/MM/*.pdf`, with no query or fragment; each redirect is
revalidated. The parsed PDF must also match the selected course.

This path remains callable with a broker configured. It writes a locally accepted manual
schedule, not durable broker accepted state, so later broker synchronization can replace
it. Clearing the cache or invoking this endpoint is not a durable accepted-state rollback.
Explicit refresh also leaves automatic discovery error diagnostics intact. See the
[publisher recovery limits](publisher.md#trust-boundary-and-recovery-limits).

## Advanced seed overrides

These are operator-controlled exceptions. **Do not set seed variables for a normal
installation or release upgrade.** Bundled file paths, provenance, mirrors, and hashes
are release-managed.

Course 1 uses the unsuffixed names below; Anul II appends `_2` to each name:

| Variable | Meaning |
| --- | --- |
| `SCHEDULE_SEED_PDF` | Alternate local PDF path |
| `SCHEDULE_SEED_PDF_URL` | Provenance URL claimed by the descriptor, not an automatic download location |
| `SCHEDULE_SEED_PDF_MIRROR_URL` | HTTPS mirror byte source |
| `SCHEDULE_SEED_PDF_SHA256` | Expected 64-character hexadecimal SHA-256 for **every** local or remote byte source |

If the provenance URL is unset or equals the current bundled URL, path and mirror
overrides only relocate the current bundled document. They retain its release-owned
hash; an explicitly supplied different hash is a configuration error.

Changing the provenance URL creates a custom descriptor. It requires an explicit hash
and at least one explicit local path or mirror. It cannot inherit the packaged image
copy or repository mirror. URLs must be absolute HTTPS URLs without embedded credentials.
Empty/whitespace-only seed values are treated as unset.

Every readable local file is hashed before parsing. A missing file can lead to the next
configured source; a present but mismatching file fails rather than falling through to a
mirror. Mirror bytes are checked too. After integrity checks, parsing, course matching,
and schedule validation still apply. A custom descriptor does not disable the separate,
release-owned promotion of an older persisted seed in direct mode.

## Testing and parser diagnostics

Use the test tiers in the [README](../README.md#testing). Vitest unit/parser suites use
bundled fixtures and mocked upstream requests. PostgreSQL integration tests need a
**disposable PostgreSQL 16 database** because they manipulate test database state:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/app_db_test'
$env:SCHEDULE_DATA_DIR = '.test-data/db-integration'
npm run db:migrate
npm run test:db
```

Use a dedicated shell for those test settings. For browser tests, build the application,
install Chromium, then run Playwright:

```text
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts the production server on port 3000 with the scheduler disabled; an
existing local server can be reused outside CI. Worker checks use the separate typecheck
and Wrangler dry-run scripts in [package.json](../package.json); the dry runs do not deploy.

Inspect a PDF without installing it into the application:

```text
npm run parser -- stats data/seed/anul_i_semestrul_i-18.pdf
npm run parser -- parse data/seed/anul_i_semestrul_i-18.pdf --json out.json
npm run parser -- debug data/seed/anul_i_semestrul_i-18.pdf --output debug/
```

The CLI reports lesson/group/type counts, uncertain entries, orphans, warnings, and
validation. Exit code `1` indicates a parse/read/validation failure; `2` indicates usage.
CLI validation does not compare against a currently served timetable's lesson count.

Debug output includes `detected_groups.json`, `detected_days.json`, `cells.json`,
`orphans.json`, `lessons.json`, and `page_debug.svg`. Open the SVG in a browser to inspect
group boundaries, day/slot rows, merged lessons, uncertain entries, and unassigned text.
Compare these with the source PDF before changing parser behavior. See
[parser architecture](architecture.md#parser-and-validation) for interpretation rules.
