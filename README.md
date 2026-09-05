# Orar FCIM UTM · Anul I

Production-ready timetable web app for first-year FCIM UTM students. It discovers the current
"Anul I" PDF on the official page, downloads it, reconstructs the table **geometrically** (not by
regex over linear text), normalises the data, serves a JSON API and a mobile-first UI, and keeps
itself up to date. The last known-good schedule is never lost because of a network or parsing error.

- Source of truth: <https://fcim.utm.md/procesul-de-studii/orar/> → section
  *"Ciclul I, Licență - învățământ cu frecvență"* → row *"Orar Semestrul …"* → link **Anul I**.
- No PDF URL, group list or lesson is hard-coded. Everything comes from the discovered PDF.

> **Stack note.** The task brief suggested FastAPI + Vite. This sandbox provides a Next.js runtime,
> so the *same architecture* is implemented as one deployable Next.js app: TypeScript backend
> (route handlers + background scheduler), React frontend, `pdfjs-dist` for coordinate-level PDF
> extraction, `zod` as the strict model layer (Pydantic equivalent), `vitest` for tests. The
> parser is still a staged pipeline with separated modules, and the debug CLI/overlay exists.

---

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
  └─ on cold start with no cache and no network ─▶ parse bundled real FCIM PDF (source_kind = "seed")
```

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
┌────────────────────────────── Next.js process ───────────────────────────────┐
│ instrumentation.ts ─▶ services/updater.ts (scheduler, mutex, fallback chain) │
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
└──────────────────────────────────────────────────────────────────────────────┘
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

## Run locally

```bash
npm ci
cp .env.example .env            # adjust if needed
npm run dev                      # http://localhost:3000
```

On first start the app fetches the FCIM page, resolves the current Anul I PDF, parses it and
creates `data/current_schedule.json`. Nothing manual is required.

## Run with Docker

```bash
docker build -t fcim-schedule .
docker run -p 8000:8000 fcim-schedule
# → http://localhost:8000
```

`docker compose up --build` does the same with a persistent volume; add `--profile with-db` and
`DATABASE_URL=postgresql://postgres:postgres@db:5432/app_db` to enable the PostgreSQL history.

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | liveness (`ok`, `has_schedule`) |
| `GET /api/status` | schedule stats + updater state (last check, last error, result) |
| `GET /api/groups` | groups discovered in the PDF with lesson counts |
| `GET /api/schedule?group=SI-261&day=Luni&teacher=&subject=&room=&q=` | filtered lessons |
| `GET /api/schedule/{group}` | one group, grouped `by_day` |
| `GET /api/schedule/{group}/today` | today's lessons (Europe/Chisinau) |
| `GET /api/source` | provenance: current PDF URL, hash, ETag, discovery kind |
| `POST /api/admin/refresh[?force=1]` | maintenance re-check; `Authorization: Bearer $SCHEDULE_ADMIN_TOKEN`; no URL parameter (no SSRF) |

## Testing the parser manually

```bash
npm run parser -- parse tests/fixtures/anul_i_semestrul_ii-1.pdf --json out.json   # schedule.json + stats
npm run parser -- stats some-other.pdf                                             # only statistics
npm run parser -- debug some-other.pdf --output debug/                             # debug artefacts
npm test                                                                           # vitest suite
```

`stats` prints groups, lessons, lessons per group, per type, merged cells, uncertain entries and
the validation verdict. Exit code 1 if validation fails. Use it to check any new PDF before it is
published.

### Debugging PDF geometry

`debug/` contains:

- `detected_groups.json` – group columns with X bounds
- `detected_days.json` – day blocks and time-slot rows with Y bounds
- `cells.json` – reconstructed cells (lines, groups, slots, background colour)
- `orphans.json` – text inside the table that mapped to no group/slot (should be empty)
- `lessons.json` – final lessons
- `page_debug.svg` – overlay: blue = group column boundaries + labels, orange dashed = slot rows,
  coloured blocks = days, green boxes = lessons, purple = merged (multi-group) lessons,
  red = uncertain, orange dashed = orphans. Open it in a browser; hover a box for details.

## schedule.json

```jsonc
{
  "metadata": {
    "academic_year": "2026/2027", "semester": "Semestrul I", "course_year": 1,
    "source_page_url": "https://fcim.utm.md/procesul-de-studii/orar/",
    "source_pdf_url": "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-5.pdf",
    "source_pdf_hash": "sha256…", "source_kind": "live | wayback | seed | manual",
    "downloaded_at": "…", "parsed_at": "…", "parser_version": "1.1.0",
    "etag": null, "last_modified": null, "pdf_title": "ANUL UNIVERSITAR 2026/2027, ANUL I, SEMESTRUL I"
  },
  "groups": [{ "name": "SI-261", "program": "SI", "x0": 52.6, "x1": 79.8 }],
  "days": ["Luni", "Marți", "Miercuri", "Joi", "Vineri"],
  "time_slots": [{ "index": 0, "start_time": "08:00", "end_time": "09:30", "raw": "8.00-9.30" }],
  "lessons": [{
    "id": "3f2a…", "day": "Luni", "slot_index": 2, "slot_span": 1,
    "start_time": "11:30", "end_time": "13:00",
    "groups": ["TI-251", "TI-252", "TI-253"],
    "subject": "Matematica Discretă și Probabilitatea Statistică", "teacher": "Leahu A.", "room": "6-2",
    "lesson_type": "lecture", "subgroup": null, "week_parity": "both",
    "notes": [], "raw_text": "c. Matematica Discretă … | Leahu A. | 6-2",
    "geometry": { "page": 1, "x0": 43.8, "y0": 195.7, "x1": 207.8, "y1": 211.6 },
    "confidence": 0.95, "uncertain": false
  }],
  "warnings": []
}
```

`lesson_type` ∈ lecture · lab · seminar · practice · physical_education · language · project ·
unknown. `week_parity` ∈ odd · even · both · unknown.

## Environment variables

See `.env.example`. Key ones: `SCHEDULE_PAGE_URL`, `SCHEDULE_REFRESH_MINUTES` (30),
`SCHEDULE_COURSE_YEAR` (1), `SCHEDULE_ALLOWED_HOSTS`, `SCHEDULE_WORDPRESS_FALLBACK`,
`SCHEDULE_WAYBACK_FALLBACK`,
`SCHEDULE_HTTP_TIMEOUT_MS`, `SCHEDULE_MAX_REDIRECTS`, `SCHEDULE_MAX_PDF_MB`, `SCHEDULE_DATA_DIR`,
`SCHEDULE_SEED_PDF`, `SCHEDULE_SEED_PDF_MIRROR_URL`,
`DATABASE_URL` (optional), `SCHEDULE_ADMIN_TOKEN`, `SCHEDULE_DISABLE_SCHEDULER`, `LOG_LEVEL`.

## Security

- PDF URLs are taken only from the FCIM page; downloads require `https` and an allow-listed host
  (`fcim.utm.md`, `utm.md`; `web.archive.org` only for the explicit mirror fallback), every
  redirect hop is re-validated, size/timeout/redirect limits apply, the body must start with `%PDF-`.
- The public API never accepts a URL. React escapes all PDF-derived text.
- Errors are returned as JSON messages; stack traces never reach the client.

## Known limitations

- **Cloudflare.** fcim.utm.md can challenge non-browser clients. The app retries through FCIM's
  official read-only WordPress REST endpoint, then uses the public Wayback copy only as a final
  page-discovery fallback. An archive snapshot from an older academic year is rejected instead of
  being presented as current. If every network source fails and no cache exists, the bundled seed
  remains the last resort; the UI identifies stale or fallback data.
- **Lesson type** is only set when the PDF says so (`c.`, `lab`, `sem.`, `Ed. fizică`, `L. …`).
  Most single-group cells in the spring PDF carry no marker → `unknown` (shown as "Tip nespecificat").
- **Week parity** is derived from the half-cell convention (upper = odd, lower = even). The current
  calendar week's parity is *not* computed – the semester start date is not in the PDF; the
  page's note ("Prima săptămână … este pară/impară") is shown instead.
- Free-form notes inside the table (e.g. a lone "SO" or "MCE MCE MCE" banner) are kept as
  `uncertain` lessons with their raw text rather than dropped or guessed.
- Subject abbreviations (MDPS, SDA, AM…) are shown as written; there is no expansion dictionary.
- OCR fallback is not implemented – the official PDFs have a text layer.

## Deployment

1. Build the image (`docker build -t fcim-schedule .`) or run `npm run build && npm start`.
2. Mount a volume at `/app/data` (Docker) so the cache survives restarts.
3. Optionally set `DATABASE_URL` and run `npx drizzle-kit push` once to create `schedule_versions`.
4. Set `SCHEDULE_ADMIN_TOKEN` to enable `POST /api/admin/refresh`.
5. Put the container behind HTTPS; `/api/health` is the health check.

## Project structure

```
src/app/                 pages + API route handlers
src/components/          React UI (ScheduleApp, DayTimeline, LessonCard, AllGroupsView)
src/lib/config.ts        env-driven configuration
src/lib/models.ts        zod models (Schedule, Lesson, SourceState …)
src/lib/parser/          staged PDF parser + debug overlay
src/lib/source/          discovery + hardened downloader
src/lib/services/        updater (scheduler) + read-side queries
src/lib/storage/         atomic JSON files + optional PostgreSQL history
src/instrumentation.ts   starts the scheduler with the server
scripts/parser-cli.ts    parse / stats / debug CLI
tests/                   vitest suites + real FCIM fixtures (PDFs, page HTML, regression stats)
data/seed/               bundled real FCIM PDF used only as last-resort bootstrap
Dockerfile, docker-compose.yml, Makefile, .env.example
```
