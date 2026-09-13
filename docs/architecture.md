# Architecture

[Project overview](../README.md) · [Debugging and operations](debugging.md) · [MD Publisher](publisher.md)

The Next.js application serves a React interface and JSON API from a locally cached,
validated timetable. Cloudflare Broker + R2 is the current recommended production
topology, with MD Publisher supplying official FCIM source bytes. Render remains the
semantic authority. Direct FCIM transport is available when `SCHEDULE_BROKER_URL` is unset.

## Multi-course model

Anul I and Anul II are independent schedule aggregates. Each has its own PDF, parsed
`Schedule`, `SourceState`, conditional-request validators, local files, accepted pointer,
and PostgreSQL history. Updating one course does not replace another course's timetable.

[`src/lib/courses.ts`](../src/lib/courses.ts) defines the course registry and seed descriptors.
`SCHEDULE_COURSES` defaults to `1,2`. Without `SCHEDULE_DEFAULT_COURSE`, the first enabled
course is the default; with the normal ordering, that is Anul I. Configuration rejects
unknown years, empty entries, duplicates, and malformed numeric tokens. Whitespace around
configuration-list entries is trimmed. A nonempty legacy `SCHEDULE_COURSE_YEAR` causes a
startup error with migration guidance.

Public `course` selectors are stricter: only an absent parameter selects the default.
Present values must be exactly an enabled `1` or `2`; whitespace, `01`, empty values, and
repeated parameters return `400`. Internal storage boundaries also check the course.

All courses share the Europe/Chisinau calendar and `SCHEDULE_ODD_WEEK_ANCHOR` (default
`2026-08-31`). Half-cell geometry describes each lesson's parity; the configured anchor
determines the current week's parity. The PDF does not supply that anchor.

## Transport and semantic authority

| Component | Responsibility |
| --- | --- |
| Official FCIM page and PDFs | Upstream timetable material |
| MD Publisher | Fetch the canonical FCIM Page API and official PDF bytes; hash and upload candidates; report run status |
| Cloudflare Broker | Derive publication structure, enforce transport policy, serve immutable snapshots, and store Render's accepted state in R2 |
| Render application | Select a course's PDF from the archived page, reconstruct the timetable, validate it, and decide acceptance |
| Local cache | Serve the currently installed schedule to the UI and API |
| PostgreSQL, if configured | Keep course-scoped version history and recover the current version when local storage has no schedule |

The publisher cannot write accepted state or choose broker storage keys, snapshot IDs,
or filenames. The broker extracts all strictly valid official timetable PDF links from
the supplied page; it does not infer a course or semester from a filename. Render runs
`discoverPdf()` against the snapshot's own archived page and requires the selected PDF
to be present in that snapshot's manifest.

Transport checks establish permitted URLs, bounded bodies, integrity, and publication
consistency. They do not prove that submitted material is authentic or that a timetable
is semantically correct. The broker does not independently refetch FCIM to authenticate
an upload. See [publisher trust and recovery limits](publisher.md#trust-boundary-and-recovery-limits).

## Candidate publication

MD Publisher runs on a machine with access to FCIM, currently a Moldova laptop. Its
freshness baseline is the snapshot named by the broker's `current.json`. Local
`state/last-run.json` is usable only while it names that same snapshot. Otherwise the
publisher rebuilds the baseline from the broker's manifest and archived Page API bytes.

The publisher conditionally checks the page and each PDF. A conditional PDF request
returning `200` triggers publication even when the page and URL are unchanged. When no
usable validator exists, it downloads and compares hashes. An upstream failure is an
error, not an unchanged result. Files already stored in a resumed publication are reused;
a later run checks for subsequent upstream revisions.

Publication has three stages:

1. **Open or resume.** `POST /publications` supplies raw Page API bytes, their SHA-256,
   and a client-generated UUIDv4 operation ID. The broker validates the page and derives
   the PDF catalogue, snapshot ID, file IDs, safe filenames, and upload paths. An immutable
   `operations/<id>.json` binds the attempt before snapshot state is written.
2. **Upload.** Each PDF is streamed to its planned file endpoint. The broker checks
   descriptor membership, content type, `%PDF-`, exact byte count, and the size limit,
   and supplies the declared SHA-256 to R2's create-only write. Completion markers are
   separate immutable objects per file.
3. **Complete.** The broker verifies page/descriptor consistency and file completion,
   writes the immutable manifest, then advances `current.json` with compare-and-swap
   (CAS) against the predecessor observed at open. A completed snapshot that loses this
   race is `superseded`; an incomplete snapshot cannot become current.

Snapshots contain `page-api.json`, `manifest.json`, and `pdfs/<filename>`. Pending
descriptors and completion markers live under `pending/<snapshot-id>/`. Children are
create-only: retries reuse matching content and reject conflicting content. The shared
[FCIM policy](../worker-shared/fcim-policy.ts) constrains official URLs and filenames;
duplicate basenames receive broker-derived qualification.

Operation identity is independent of the page hash, so an in-place PDF change under an
unchanged page can create a new publication. A reused operation with different page bytes
returns `409 operation_payload_mismatch`; expired work returns `410 operation_expired`;
inconsistent stored operation state returns `409 operation_state_corrupt`.

The broker rejects page timestamps older than the current baseline, and missing timestamps
when the baseline has one. Equal timestamps are allowed. A timestamp more than
`MAX_PAGE_FUTURE_SKEW_HOURS` ahead of broker time is rejected (default 26 hours). There is
no publisher force override. Page bodies are limited to 1 MiB, PDFs to 25 MiB, and open
publications to eight.

Publisher-observed ETags and Last-Modified values are recorded separately from trusted
upstream validators. MD-published manifests set `upstream_etag` and
`upstream_last_modified` to `null`; Render does not skip downloads on a laptop's claim
of unchanged validators. It hashes the downloaded bytes before deciding they are unchanged.

The upload path supplies R2's checksum option. In-process R2 test doubles exercise rejection
behavior; they do not establish that behavior against a real bucket. A disposable-bucket
checksum-rejection check is a separate infrastructure verification.

## Application updates and accepted state

The application checks each enabled course at startup and every
`SCHEDULE_REFRESH_MINUTES` (default 30 minutes). Updates are serialized, with per-course
in-flight tracking shared through `globalThis` across Next.js bundles. This coordinates
one process; it is not a distributed lock. Deploy one application replica.

In broker mode, each automatic check first reads durable accepted state. If its PDF hash
differs from local state, the application synchronizes the local schedule before evaluating
the next candidate. Failure to install that recovered state stops that course's update.
If the durable read itself fails, the code logs it and may continue candidate evaluation;
installing a new broker candidate still requires a successful durable write.

Render then reads `current.json`, its manifest, and its archived page; selects the course's
PDF; downloads and hashes it; parses it; and validates it against the current schedule.
A changed parser version, source URL, or transition to broker transport requires applying
the candidate even if its PDF hash matches.

Accepted state uses an immutable payload at
`accepted-payloads/course-<year>/<accepted-id>` and a small pointer at
`accepted/course-<year>`. For a newly validated broker candidate, the order is:

1. Write the immutable accepted payload.
2. CAS the accepted pointer using `expected_previous_accepted_id`.
3. Only after durable success, replace the local schedule and update local source state.

A durable-write failure or CAS conflict leaves the previous local schedule installed.
If durable storage succeeds but the local write fails, a later check can recover from
accepted state. The broker validates payload/pointer consistency and stream limits;
the application supplies the semantic decision.

`SCHEDULE_BROKER_SECRET` authenticates accepted-state writes and must be configured on
both the application and broker for that topology's update flow. It is not a universal
startup requirement. The separate `MD_PUBLISHER_TOKEN` authorizes only publisher routes.

## Direct FCIM transport

When `SCHEDULE_BROKER_URL` is unset or empty, automatic discovery tries the official
rendered timetable page, the official WordPress REST representation, then an optional
Wayback page fallback. Archive discovery rejects a page without the current academic year.
The selected PDF goes through bounded HTTPS download, hashing, parsing, and validation.

Direct download defaults are 20 seconds, five redirects, and 25 MiB. Automatic downloads
use the configured host allow-list; the Wayback host is added for archive transport.
Every response must be a PDF rather than a challenge page.

A configured broker failure does **not** automatically switch the updater to direct FCIM.
It retains existing data, or attempts its verified seed if no schedule is available.
Broker routes, cron, and queue handlers themselves make no FCIM requests. The retained
`worker-egress/` implementation, egress binding, and older fetch helpers are not invoked
by current broker routes or maintenance; their presence is not evidence of an active path.

The authenticated application admin endpoint also retains an explicit official-PDF
refresh path, including when broker mode is configured. It uses direct transport and
local acceptance, without updating broker accepted state. A later broker synchronization
can replace it. It is therefore not a durable broker rollback mechanism. See
[admin refresh](debugging.md#authenticated-refresh).

## Parser and validation

The current parser version is **1.4.0**, defined in [`config.ts`](../src/lib/config.ts).
[`src/lib/parser/`](../src/lib/parser/) contains the stages:

1. Extract positioned text and filled rectangles using `pdfjs-dist`.
2. Reconstruct table lines, group columns, day blocks, and time-slot rows.
3. Form cells from surrounding borders, including merged group/slot spans and half-cell
   odd/even week patterns.
4. Interpret subject, teacher, room, subgroup, and lesson type; normalize the result into
   the Zod schedule model and retain source geometry and raw text.
5. Validate the candidate before installing it.

The PDF title supplies course year and academic context when present. Explicit lesson
markers take priority; special lessons have dedicated types. An ordinary structured
lesson with a teacher or room but no type marker is a Seminar. Unresolved entries retain
`raw_text`, uncertainty, and the `unknown` type instead of receiving a guessed type.
Confirmed subject aliases and spelling variants are normalized through the
[subject alias tables](../src/lib/parser/subject-aliases.ts); unrecognized abbreviations
stay as printed, and `raw_text` preserves source wording. There is no OCR fallback.

Validation checks schema, at least five groups, all five weekday blocks, at least 30
lessons, at least four time slots, time ordering, group assignment, geometry, and the
uncertain-entry ratio. More than 50% uncertain entries is an error; more than 15% is a
warning. A candidate with fewer than 60% of the previous lesson count is rejected.
Collisions and some broad or empty-group patterns produce warnings. These checks detect
structural problems; they do not establish perfect transcription fidelity.

Every newly parsed source—including live, archive, manual, and seed material—must match
the requested course year. Storage repeats that check before writing. A parser-version
change causes the next update to reparse the source even when the PDF bytes are unchanged.

## Storage and cold-start precedence

The effective recovery order is:

**In-memory/current cache → scoped local schedule → compatible legacy cache adoption
→ PostgreSQL current/history recovery → broker durable accepted state → verified bundled seed.**

[`getCurrentSchedule()`](../src/lib/storage/index.ts) handles the first four layers.
[`bootstrapScheduleState()`](../src/lib/services/updater.ts) then attempts broker accepted
state and the seed for a course still without a schedule. This is recovery precedence,
not a claim that a bundled PDF is newer than a live candidate. Background refresh follows.
Courses bootstrap concurrently under a shared time budget; a deadline or exhausted
fallback can leave a course temporarily unavailable.

The scoped layout is `<SCHEDULE_DATA_DIR>/courses/<year>/current_schedule.json` plus
`metadata.json`. The default root is `data`. Reads use shared in-memory state and file
modification checks. Each file write uses a unique temporary file, `fsync`, and rename;
the schedule and metadata are separate writes, not one atomic two-file transaction.

Legacy `data/current_schedule.json` is copied only into the course its metadata names
when no scoped schedule is available. Legacy source state accompanies it only when its
hash, or URL if no hash exists, matches. Original legacy files remain in place.

With `DATABASE_URL` configured, installed schedules are also recorded in PostgreSQL.
Recovery reads that course's most recent `is_current` row and checks its schema and
course year; it does not scan older non-current rows for a usable payload. The history
table is not the primary browser/API read path. A database recording failure is logged
without undoing the local install. Checked-in [migrations](../drizzle/) enforce at most
one current row per course, and writes retain the newest 20 versions per course.

## Bundled seeds and provenance

**Normal deployment requires zero `SCHEDULE_SEED_*` variables.** The release-owned
descriptors in [`courses.ts`](../src/lib/courses.ts) pair each course's file, original
URL, and SHA-256. All seed byte sources—local, container copy, and remote mirror—must
match that descriptor before parsing and validation.

The [Dockerfile](../Dockerfile) copies seeds to `/app/seed`, outside the writable
`/app/data` cache mount. If a local file is absent, the loader can try the image copy
and then the repository mirror. A present file with a hash mismatch fails; it is not
silently ignored in favor of another source. A course never borrows another course's seed.

| Course | Bundled PDF and original FCIM publication | SHA-256 |
| --- | --- | --- |
| Anul I | [Bundled PDF](../data/seed/anul_i_semestrul_i-18.pdf) · [FCIM source](https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-18.pdf) | `a4c610d24dd53bbf87c5da312ffebf7aabc112c7f28338587e18e1eb0526b79a` |
| Anul II | [Bundled PDF](../data/seed/anul_ii_semestrul_iii-11.pdf) · [FCIM source](https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_ii_semestrul_iii-11.pdf) | `3728f5ab165b6fe5095609d9aeff54da687c8312ed0ec1e89a9a951807a0a23b` |

Earlier official PDF revisions and archived page copies in [test fixtures](../tests/fixtures/)
support parser, discovery, and seed-promotion regression checks. Tests are excluded from
the container build context by [`.dockerignore`](../.dockerignore). The repository's
[MIT license](../LICENSE) applies to source code, not these third-party PDFs or timetable data.

Before direct automatic discovery, a newer bundled seed can replace an older persisted
`source_kind: seed` schedule only when parsed course, academic year, and semester match
and official URL publication ordering demonstrates a newer revision. It does not promote
over live, Wayback, or manual data. This promotion uses the release-owned descriptor,
independent of environment overrides; broker-mode updates use accepted-state synchronization
instead. See [advanced seed overrides](debugging.md#advanced-seed-overrides) for custom descriptors.

## Retention and maintenance

Broker cron runs every 20 minutes and enqueues reconciliation only. Queue handlers run
`finalize` or `reconcile`, one message per invocation, with at most three retries and a
300-second retry delay; exhausted jobs go to the configured dead-letter queue.
Reconciliation can finalize already uploaded material and run retention. It cannot fetch
missing PDFs; those require a publisher run.

| Policy | Current implementation |
| --- | --- |
| Publication and repair deadline | Six hours; finalize checks again before pointer CAS |
| Reconciliation eligibility | At least five minutes old, within deadline, and still able to publish against its observed predecessor |
| Reconciliation scan | Up to three pages of 100 prefixes; at most three repairs per invocation |
| Retention eligibility | Strictly older than 24 hours |
| Protected snapshot history | Current plus two predecessors traced through immutable manifests |
| Snapshot/pending sweep | Eight prefixes per namespace; at most four prefix deletions of up to 64 objects each |
| Operation-record sweep | Up to 64 expired records per invocation, aged by R2 upload time |

Continuation cursors under `maintenance/` keep later work reachable as the catalogue grows.
Retention derives snapshot age from validated structured IDs, stops if the current pointer
changes before deletion, and fails closed when it cannot read the pointer or required history
chain. Current pending metadata is protected; accepted pointers and payloads are outside
this collector. Partial prefix deletions can finish on later sweeps.

The gap between the six-hour publication deadline and 24-hour deletion threshold prevents
expired publication work from competing with cleanup. These are bounded maintenance
budgets, not a byte quota: sustained publication beyond cleanup throughput can create a
backlog. Accepted-payload retention is not implemented by this collector. The policy and
cursor handling live in [`maintenance.ts`](../worker/src/maintenance.ts) and
[`publisher.ts`](../worker/src/publisher.ts).
