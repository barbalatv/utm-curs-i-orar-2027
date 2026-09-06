# Orar FCIM UTM · Anul I

Production-ready timetable web app for first-year FCIM UTM students, built for a **single-instance**
deployment — one container, one data volume (see [Known limitations](#known-limitations)). It
discovers the current "Anul I" PDF on the official page, downloads it, reconstructs the table
**geometrically** (not by regex over linear text), normalises the data, serves a JSON API and a
mobile-first UI, and keeps itself up to date. The last known-good schedule is never lost because of
a network or parsing error.

- Source of truth: <https://fcim.utm.md/procesul-de-studii/orar/> → section
  *"Ciclul I, Licență - învățământ cu frecvență"* → row *"Orar Semestrul …"* → link **Anul I**.
- Automatic discovery does not hard-code a current PDF URL, group list, or lesson. The repository
  also carries one verified real PDF as a bootstrap/recovery seed.

> **Stack note.** The task brief suggested FastAPI + Vite. This sandbox provides a Next.js runtime,
> so the *same architecture* is implemented as one deployable Next.js app: TypeScript backend
> (route handlers + background scheduler), React frontend, `pdfjs-dist` for coordinate-level PDF
> extraction, `zod` as the strict model layer (Pydantic equivalent), `vitest` for tests. The
> parser is still a staged pipeline with separated modules, and the debug CLI/overlay exists.

Some datails can be found [here](docs/architecture.md ).

---

## Run locally

```bash
npm ci
cp .env.example .env            # adjust if needed
npm run dev                     # http://localhost:3000
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

Debugging and stuff can be found [here](docs/debugging.md ).

## Security

- Automatically discovered PDF URLs require `https` and an allow-listed host (`fcim.utm.md`,
  `utm.md`; `web.archive.org` only for the archive fallback). The authenticated admin recovery
  endpoint accepts only exact-host `fcim.utm.md` URLs under
  `/wp-content/uploads/sites/24/YYYY/MM/*.pdf`; every redirect is checked against that stricter
  policy. Size/timeout/redirect limits apply and the body must start with `%PDF-`.
- No unauthenticated endpoint accepts a URL. React escapes all PDF-derived text.
- Errors are returned as JSON messages; stack traces never reach the client.

## Known limitations

- **Cloudflare.** fcim.utm.md can challenge non-browser clients. The app retries through FCIM's
  official read-only WordPress REST endpoint, then uses the public Wayback copy only as a final
  page-discovery fallback. An archive snapshot from an older academic year is rejected instead of
  being presented as current. If every network source fails and no cache exists, the bundled seed
  remains the last resort; its remote mirror is accepted only when its SHA-256 matches the configured
  official seed. A newer packaged seed may also promote an older persisted seed from the
  exact same academic context, but never live/Wayback/admin-recovered data. Operators can invoke an
  authenticated explicit official-PDF refresh when page discovery is blocked. This does not bypass
  Cloudflare; if the runtime is also challenged for the PDF, the request fails and last-known-good
  data remains served.
- **Lesson type** is only set when the PDF says so (`c.`, `lab`, `sem.`, `Ed. fizică`, `L. …`).
  Most single-group cells in the spring PDF carry no marker → `unknown` (shown as "Tip nespecificat").
- **Week parity.** Each lesson's parity comes from the half-cell convention (upper = odd, lower =
  even). Which parity the *current* week has is computed: the app counts Monday→Sunday weeks from
  `SCHEDULE_ODD_WEEK_ANCHOR` (default `2026-08-31`) and fades out the lessons of the other week.
  That anchor cannot be derived from the PDF – the semester start date is not in it – so it has to
  be set once per semester; the status footer prints the computed week beside the official page's
  own note ("Prima săptămână … este pară/impară") so the two can be cross-checked.
- Free-form notes inside the table (e.g. a lone "SO" or "MCE MCE MCE" banner) are kept as
  `uncertain` lessons with their raw text rather than dropped or guessed.
- Subject abbreviations (MDPS, SDA, AM…) are shown as written; there is no expansion dictionary.
- OCR fallback is not implemented – the official PDFs have a text layer.
- **Single instance.** The refresh scheduler and the in-flight lock that keeps two checks from
  overlapping both live in the process, and the cache is a pair of files in `SCHEDULE_DATA_DIR`.
  Run one replica: two would each download and re-parse the PDF on their own timer, and on a shared
  volume the atomic rename simply decides who wins. There is no distributed lock or leader
  election – for one faculty's timetable it would cost more than it buys. Scale reads with a cache
  or CDN in front of the app rather than with more replicas.

## Deployment

1. Build the image (`docker build -t fcim-schedule .`) or run `npm run build && npm start`.
2. Mount a volume at `/app/data` (Docker) so the cache survives restarts.
3. Set `SCHEDULE_ODD_WEEK_ANCHOR` to the Monday the university counts as week 1 of the semester —
   the week badge and the fading of the other week's lessons are counted from it.
4. Optionally set `DATABASE_URL` and run `npx drizzle-kit push` once to create `schedule_versions`.
5. Set `SCHEDULE_ADMIN_TOKEN` to enable `POST /api/admin/refresh`.
6. Put the container behind HTTPS; `/api/health` is the health check. Run a single replica.

For the authenticated explicit-PDF recovery command and status verification, see
[Cloudflare discovery failures and recovery](docs/debugging.md#cloudflare-discovery-failures-and-recovery).

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
.github/workflows/ci.yml typecheck · lint · test · build on every push and PR to main
Dockerfile, docker-compose.yml, Makefile, .env.example
```

## License

The code in this repository is released under the [MIT License](LICENSE).

MIT covers **this project's own source code only**. It does not — and cannot — relicense the
underlying timetable data: the official FCIM/UTM schedule PDFs, everything parsed out of them, and
the real PDFs committed under `data/seed/` and `tests/fixtures/` remain the property of
Universitatea Tehnică a Moldovei. They are redistributed here purely so the app can bootstrap
without network access and so the parser's regression fixtures stay reproducible. If you fork this
project, the MIT grant travels with the code; the schedule data does not.
