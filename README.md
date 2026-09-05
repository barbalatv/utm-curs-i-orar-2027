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
