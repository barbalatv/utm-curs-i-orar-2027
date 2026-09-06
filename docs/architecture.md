## How auto-update works

```
every SCHEDULE_REFRESH_MINUTES (default 30) + once at startup
  │
  ├─ GET official page ──(403/timeout)──▶ official WordPress REST page
  │                                      └─(failure)──▶ public Wayback copy (optional)
  │        │
  │        ▼
  │  discover "Anul I" PDF link in "Ciclul I … frecvență" (+ academic year, semester, parity note)
  │  and reject archive pages that do not contain the current academic year
  │        │
  │        ▼
  │  conditional GET (If-None-Match / If-Modified-Since) – HTTPS, allow-listed hosts only,
  │  ≤5 redirects, 20 s timeout, ≤25 MB, "%PDF-" magic check
  │        │
  │        ├─ 304 or same SHA-256 (and same parser version) ─▶ record "unchanged", done
  │        ▼
  │  parse ─▶ validate (≥5 groups, all 5 days, ≥30 lessons, times, geometry,
  │           ≤40 % drop vs previous version, uncertain ratio)
  │        │
  │        ├─ ok ─▶ atomic replace: tmp file → fsync → rename  (+ row in PostgreSQL history)
  │        └─ fail ─▶ keep previous schedule, store last_error, result = "rejected"
  │
  ├─ on cold start with no cache and no network ─▶ parse bundled real FCIM PDF (source_kind = "seed")
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

Seed promotion is intentionally asymmetric. A validated packaged seed may replace only a persisted
`source_kind = "seed"` whose parsed academic year, semester, and course year match, and whose
official publication path has an older month/revision. It never replaces `live`, `wayback`, or
authenticated `manual` data. Thus deploying an updated image repairs an obsolete persisted seed
without allowing an older image to roll back a live timetable.

The served schedule provenance and automatic discovery health are separate. An explicit refresh or
seed promotion updates the schedule URL/hash, while a later Cloudflare discovery error remains a
truthful error in SourceState and cannot revert the valid schedule.

`data/metadata.json` keeps: current PDF URL, SHA-256, ETag, Last-Modified, last check,
last success, last error, last result, academic year / semester, parity note.

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
│                storage/ (data/current_schedule.json + metadata.json, atomic;  │
│                          optional PostgreSQL `schedule_versions` history)     │
│                          ▼                                                    │
│  app/api/*  health · status · groups · schedule · schedule/{group}[/today]    │
│             source · admin/refresh                                            │
│                          ▼                                                    │
│  components/ScheduleApp (React, Today / Week / All groups, search, status)    │
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
