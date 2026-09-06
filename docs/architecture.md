## Courses

One deployment serves several course years at once — `SCHEDULE_COURSES`, `1,2` today. A course year
is a first-class key throughout the stateful half of the app:

```
course 1 ──▶ Schedule (Anul I PDF)  + SourceState + history rows
course 2 ──▶ Schedule (Anul II PDF) + SourceState + history rows
```

The two aggregates are never merged: separate discovery, separate download, separate parse,
separate files (`data/courses/<year>/`), separate `is_current` history row, separate error state.
`src/lib/courses.ts` is the single registry — adding Anul III later is one entry there plus, if a
verified PDF exists, its seed. What *is* shared is the deployment-wide week calendar
(`SCHEDULE_ODD_WEEK_ANCHOR`): FCIM publishes one week-parity announcement for the whole faculty.

Reads are parameterised rather than duplicated: `requireSchedule(courseYear)` and
`buildStatus(courseYear)` are the only course-aware read entry points, and all filtering, sorting
and day handling below them operates on lessons alone.

A course year is only ever accepted, never coerced:

  - **Configuration** is validated at import time. `SCHEDULE_COURSES` / `SCHEDULE_DEFAULT_COURSE`
    must be plain decimal, known, non-duplicated course years, and the default must be one of the
    enabled ones; anything else throws `CourseConfigError` and the process does not start. The
    removed `SCHEDULE_COURSE_YEAR` is a hard stop with a migration message rather than a silent
    ignore.
  - **Public input** is parsed strictly. Only an entirely absent `?course=` means the default; the
    only other accepted values are exactly `1` and `2`. Empty, padded, zero-prefixed, non-numeric,
    unsupported and repeated parameters are 400s. `Number.parseInt` is not used anywhere on a course
    value — it reads `"1x"` as 1, which is the silent resolution all of this exists to prevent.
  - **Internal boundaries** re-check. `assertSupportedCourse` guards every exported storage entry
    point and both read services, and the updater rejects rather than throws (it returns promises).
    An unsupported year can therefore never create a namespace such as `data/courses/3`.

The update coordinator — the serialization queue plus the per-course in-flight map — lives on
`globalThis`, not in module scope. Next.js bundles the instrumentation hook separately from the
route handlers, so this module is evaluated more than once in a single process; module-local state
would give the scheduler and the API separate queues and the serialisation would be a fiction. The
deployment remains single-process: this is shared process state, not a distributed lock.

## How auto-update works

```
every SCHEDULE_REFRESH_MINUTES (default 30) + once at startup
  │
  │  one tick refreshes each supported course in turn; a course that fails keeps its own
  │  last-known-good schedule and its own diagnostics, and the next course is checked anyway
  │
  ├─ GET official page ──(403/timeout)──▶ official WordPress REST page
  │                                      └─(failure)──▶ public Wayback copy (optional)
  │        │
  │        ▼
  │  discover the requested course's PDF link in "Ciclul I … frecvență" (+ academic year,
  │  semester, parity note)
  │  and reject archive pages that do not contain the current academic year
  │        │
  │        ▼
  │  conditional GET (If-None-Match / If-Modified-Since) – HTTPS, allow-listed hosts only,
  │  ≤5 redirects, 20 s timeout, ≤25 MB, "%PDF-" magic check
  │        │
  │        ├─ 304 or same SHA-256 (and same parser version) ─▶ record "unchanged", done
  │        ▼
  │  parse ─▶ course year == requested course ─▶ validate (≥5 groups, all 5 days,
  │           ≥30 lessons, times, geometry, ≤40 % drop vs previous version, uncertain ratio)
  │        │
  │        ├─ ok ─▶ atomic replace: tmp file → fsync → rename  (+ row in PostgreSQL history)
  │        └─ fail ─▶ keep previous schedule, store last_error, result = "rejected"
  │
  ├─ on cold start with no cache and no network ─▶ parse that course's bundled real FCIM PDF
  │    (source_kind = "seed"); a course without a seed stays unavailable and reports the failure
  │    └─ if only the remote mirror exists, require its configured SHA-256 before parsing
  │
  └─ persisted seed only + demonstrably newer same-context packaged seed
       └─ parse + validate packaged PDF ─▶ atomically promote seed before discovery
```

An authenticated `POST /api/admin/refresh` may supply one explicit official FCIM timetable PDF
URL when page discovery is unavailable. It joins the same download → hash → parse → validate →
atomic-replace pipeline; it is not a second parser or storage path. Its URL policy is deliberately
stricter than automatic discovery: exact host `fcim.utm.md`, HTTPS, and
`/wp-content/uploads/sites/24/YYYY/MM/*.pdf`, rechecked on every redirect.

Every candidate schedule — live, Wayback, authenticated `manual`, packaged seed, image seed,
repository mirror seed and seed promotion — passes the same gate: `metadata.course_year` must equal
the course year the update was requested for, or it is rejected and nothing is installed. Storage
repeats the check before writing, so no path can put one course's document in another's slot. Only
Anul I ships a verified seed; a cold start for a course without one therefore keeps its storage
empty and reports the discovery failure together with the reason, instead of silently serving
another year's timetable. The parsed course year comes from the PDF's own title
("ANUL UNIVERSITAR 2026/2027, ANUL II, SEMESTRUL III"), which also outranks anything discovery
inferred: a row labelled only by season ("Orar Semestrul de TOAMNĂ") cannot say which semester a
given course year is in, so it is used only when the document carries no title. Discovery derives
that fallback from the course year itself — autumn = semester 2N-1, spring = 2N.

Seed promotion is intentionally asymmetric. A validated packaged seed may replace only a persisted
`source_kind = "seed"` whose parsed academic year, semester, and course year match, and whose
official publication path has an older month/revision. It never replaces `live`, `wayback`, or
authenticated `manual` data. Thus deploying an updated image repairs an obsolete persisted seed
without allowing an older image to roll back a live timetable.

The served schedule provenance and automatic discovery health are separate. An explicit refresh or
seed promotion updates the schedule URL/hash, while a later Cloudflare discovery error remains a
truthful error in SourceState and cannot revert the valid schedule.

`data/courses/<year>/metadata.json` keeps, per course: current PDF URL, SHA-256, ETag,
Last-Modified, last check, last success, last error, last result, academic year / semester, parity
note. A write for one course never touches another's file, cache entry or history row — including
its conditional-request validators, so course 2 activity can never make course 1 answer 304 for a
document it does not have.

A data directory in the pre-multi-course layout (`data/current_schedule.json` + `data/metadata.json`)
is adopted once, by the course whose year the cached schedule declares, and copied into the scoped
layout; the legacy files stay on disk. A legacy cache is never adopted by a course whose metadata
does not match. The legacy `metadata.json` travels only when it demonstrably describes the adopted
schedule — its `current_pdf_hash` must match, or, if it never recorded one, its `current_pdf_url`.
Both files being well-formed proves nothing: an unrelated state would hand the schedule someone
else's ETag and the next check would answer 304 for a document this course does not hold. Unproven
identity means the schedule is adopted bare, with empty conditional metadata.

File writes are serialized per destination path, so two overlapping writers cannot race their
renames onto the same file, and each write uses a unique temporary name (pid + UUID) rather than a
shared one.

Raising `config.parserVersion` invalidates the cache: the next check re-downloads and
re-parses the PDF even when it is byte-identical, so a parser fix reaches users without
waiting for the university to publish a new file.

## Odd / even weeks

Half-height cells in the PDF alternate weekly, so every lesson carries `week_parity`
(`odd` / `even` / `both`). The UI counts semester weeks from `SCHEDULE_ODD_WEEK_ANCHOR`
(the Monday of an odd week, `2026-08-31` for autumn 2026/2027) and fades out the lessons
belonging to the other week. Weeks run Monday→Sunday; on Saturday and Sunday the teaching
week is over, so the schedule already shows the week that starts on Monday.

## Architecture

```
┌────────────────────────────── Next.js process ────────────────────────────────┐
│ instrumentation.ts ─┐                                                        │
│ admin/refresh ───────┴─▶ services/updater.ts (queue, scheduler, fallbacks)    │
│                          │  source/discovery.ts   (cheerio, section → link)   │
│                          │  source/downloader.ts  (hardened fetch, SSRF guard)│
│                          ▼                                                    │
│                       parser/                                                 │
│   pdf-extract.ts  text items + fill rects with coordinates (pdf.js)           │
│   geometry.ts     rects → grid lines / backgrounds, enclosingCell()           │
│   table-detector  group columns · day blocks · time-slot rows                 │
│   cell-builder    text → drawn cell → colspan/rowspan → groups[] / slots[]    │
│   lesson-interp.  lines → subject / teacher / room / type / subgroup / parity │
│   normalizer      08:00, "Costaș A.", "D01-03", "0.5 gr."                     │
│   validator       sanity checks (never replace prod data on failure)          │
│   debug.ts        detected_*.json, cells.json, lessons.json, page_debug.svg   │
│                          ▼                                                    │
│                storage/ (data/courses/<year>/{current_schedule,metadata}.json,│
│                          atomic; optional per-course PostgreSQL history)      │
│                          ▼                                                    │
│  app/api/*  health · status · groups · schedule · schedule/{group}[/today]    │
│             source · admin/refresh          (all course-scoped via ?course=)  │
│                          ▼                                                    │
│  components/ScheduleApp (React, course switcher, Today / Week / All groups,   │
│                          search and status, all within the active course)     │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Parser pipeline (per PDF)

1. **Extraction** – every text item with `x0,y0,x1,y1,page` (top-left origin) and every filled
   rectangle with colour. Excel-exported PDFs draw borders as thin fills.
2. **Grid** – fills thinner than 1.5 pt become vertical/horizontal line segments (merged when
   collinear); wider fills are cell backgrounds (grey/orange highlights).
3. **Layout** – header cells matching `^[A-Z]{1,5}-\d{3}` → group columns with X bounds; day labels
   in the left margin (`Luni`, `Marţi`/`Marți`, …) → Y blocks; `8.00-9.30`-style labels inside a
   day → slot rows (`08:00`–`09:30` normalised).
4. **Cells** – for every text item find the nearest drawn borders on 4 sides
   (`enclosingCell`). Items sharing a rectangle form one cell; items on the same baseline form one
   line. The cell rectangle is intersected with column bounds (colspan → `groups[]`) and row
   bounds (rowspan → `slot_span`). Half-height cells map to **odd** (upper) / **even** (lower)
   week; full-height cells are `both`.
5. **Interpretation** – line roles are classified (room pattern, "Surname I." teacher pattern,
   subgroup marker `0,5 gr.`, type prefixes `c.`/`lab`/`sem.`), stacked lessons in one cell are
   split, `Ed. fizică` / `L. Engleză` get their types. Anything else is `unknown` – no guessing.
   Unresolvable cells are kept with `uncertain: true` and the `raw_text`.
6. **Validation** – see above.
