# Orar FCIM UTM

An independent, unofficial timetable app for **FCIM students at the Technical University
of Moldova**. Choose **Anul I or Anul II** and your group to read official PDF timetables
on desktop or mobile, with day/week views, search, and source/update information.

Built with **Next.js, React, and TypeScript**. The engineering work is turning PDF table
geometry into validated lessons and keeping accepted schedules available when updates fail.

**[Live demo](https://utm-curs-i-orar-2027.onrender.com/)** · [Engineering case study](docs/portfolio.md) · [Architecture](#architecture) · [Run locally](#local-development)

[![CI](https://github.com/barbalatv/utm-curs-i-orar-2027/actions/workflows/ci.yml/badge.svg)](https://github.com/barbalatv/utm-curs-i-orar-2027/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Preview

Desktop: Anul I, FAF-261, Friday selected; lesson cards and source/update details.

<a href="docs/images/timetable-desktop.webp"><img src="docs/images/timetable-desktop.webp" alt="Desktop Orar FCIM timetable for Anul I, FAF-261, showing Friday lessons and source/update details" width="880"></a>

<details>
<summary>Mobile preview: day navigation and timetable cards</summary>

<a href="docs/images/timetable-mobile.webp"><img src="docs/images/timetable-mobile.webp" alt="Mobile Orar FCIM timetable at 390 pixels wide with FAF-261 Friday lessons and bottom view navigation" width="260"></a>

</details>

Captured from the public application on **22 October 2026 (Europe/Chisinau)**.
These are observed timetable views, not a claim that the displayed lessons are current.
The UI reports data updated on 9 October; the deployment SHA was not established.
[Capture provenance and full-resolution images](docs/images/README.md).

## Engineering highlights

- **PDF table reconstruction:** positioned text and borders resolve group columns,
  day blocks, merged cells, and alternating weeks; no OCR or AI model.
- **Controlled updates:** schema, course-year, geometry, and completeness checks
  separate a downloaded candidate from an accepted timetable.
- **Recovery with provenance:** local accepted data, optional PostgreSQL/broker recovery,
  and hash-verified bundled seeds; recovered data can be older than upstream.
- **Inspectable verification:** PDF regression fixtures, updater/API tests, database
  integration, Chromium E2E, and CI. [Read the case study](docs/portfolio.md).

## What it does

The app turns FCIM's PDF tables into a searchable timetable. Each course year has its
own schedule and update status. You can follow the source link and check when the
displayed timetable was last updated.

## Features

- Switch between **Anul I** and **Anul II** and select a group.
- Browse **Today**, **Week**, or **all-groups** views.
- Search by group, teacher, subject, or room.
- See odd/even week lessons and labels such as **Curs**, **Seminar**, **Laborator**,
  and **Activități Individuale/În Grup**.
- Keep your selected course year and each course's group preference in your browser.
- Use a responsive interface designed for phones as well as larger screens.

## How schedule updates work

Official FCIM PDFs are transformed into structured timetable data. The parser reconstructs
table geometry—group columns, day blocks, merged cells, and half-cell week patterns—rather
than treating the PDF as one stream of text. New candidates pass course and schedule
validation before replacing the currently accepted timetable.

The app checks for updates periodically (every 30 minutes by default). If fetching or
validation fails, it can continue serving the last accepted schedule. Local storage,
optional PostgreSQL recovery, broker accepted state, and verified bundled seeds provide
layers of recovery across restarts. A recovered timetable may be older than the latest
FCIM publication; check its source and update status when freshness matters.

The source acquisition migration is documented in the
[migration verification and deployment runbook](docs/fcim-source-migration-01.md).

## Local development

Use **Node.js 22**, matching CI and the application container. From the repository root:

```text
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). These commands work in PowerShell and POSIX
shells. Basic startup does not require an `.env` file, a database, or broker credentials.
Both course years are enabled by default. Startup attempts recovery before background updates.

[`.env.example`](.env.example) is optional configuration. To customize it in PowerShell:

```powershell
Copy-Item .env.example .env
```

Normal deployments require **zero `SCHEDULE_SEED_*` variables**: the release supplies the
verified seeds. Configure `SCHEDULE_ODD_WEEK_ANCHOR` for the semester's odd-week calendar
when needed. See [configuration and deployment](docs/debugging.md#configuration-and-deployment)
for storage, Docker, and broker setup.

## Testing

Run the checks appropriate to the change; the [CI workflow](.github/workflows/ci.yml)
combines these tiers with linting and builds.

| Tier | Commands and prerequisites |
| --- | --- |
| Application types and unit/parser tests | `npm run typecheck`, `npm test` (Vitest with local fixtures and mocked upstream requests) |
| PostgreSQL 16 integration | Set `DATABASE_URL` to a disposable test database; run `npm run db:migrate`, then `npm run test:db` |
| Browser E2E | `npm run build`, `npx playwright install chromium`, then `npm run test:e2e` (Playwright) |
| Worker | `npm run typecheck:worker`, `npm run check:worker` (Wrangler dry runs; no deployment) |
| MD Publisher | `npm run typecheck:publisher`, `npm run build:publisher` |

See [testing and parser diagnostics](docs/debugging.md#testing-and-parser-diagnostics)
for PowerShell database setup and PDF inspection commands.

## Architecture

The application uses **Next.js, React, and TypeScript**, with `pdfjs-dist` for PDF extraction
and Zod for structured data validation. **Cloudflare Broker + R2 is the current recommended
production topology**. MD Publisher supplies raw official source material; the Render
application remains the semantic authority that selects, parses, and validates it.

```mermaid
flowchart LR
    FCIM[Official FCIM sources] --> Publisher[Publisher host / MD Publisher]
    Publisher --> Broker[Cloudflare Broker / R2]
    Broker --> App[Render application]
    App -->|Accepted state| Broker
    FCIM -.->|Direct when broker URL is unset| App
    Seed[Verified bundled seeds] -.->|Fallback| App
    App <-->|Optional history / recovery| DB[(PostgreSQL)]
    App --> Readers[Web UI / JSON API]
```

The broker is optional: when `SCHEDULE_BROKER_URL` is unset, automatic updates use the
direct FCIM transport. `SCHEDULE_BROKER_SECRET` is needed for authenticated accepted-state
writes in broker mode, not for universal application startup. PostgreSQL is optional
history and recovery storage; browser/API reads use the current local schedule.

The effective cold-start recovery order is:

**In-memory/current cache → scoped local schedule → compatible legacy cache adoption
→ PostgreSQL current/history recovery → broker durable accepted state → verified bundled seed.**

The scheduler and cache coordination run within one process; deploy one application replica.
See [architecture](docs/architecture.md) for update ordering, recovery, and maintenance.
The current production publisher runs on a dedicated Debian host under a user-level
systemd timer; Windows Task Scheduler remains an optional deployment. See
[publisher operations](docs/publisher.md#current-production-deployment-debian-user-systemd)
for installation, diagnostics, and the manual update/rebuild procedure.

## API

Read endpoints return JSON. Except for health, each accepts `?course=1` or `?course=2`
when that course is enabled. Omitting it uses the configured default (Anul I with default
settings); invalid or repeated selectors return `400`.

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | Process liveness and per-course schedule availability |
| `GET /api/status?course=1` | Schedule summary and update diagnostics |
| `GET /api/groups?course=2` | Available groups and lesson counts |
| `GET /api/schedule?course=2` | Lessons and metadata; filters: `group`, `day`, `teacher`, `subject`, `room`, `q` |
| `GET /api/schedule/{group}?course=2` | A group's lessons, also grouped by day |
| `GET /api/schedule/{group}/today?course=2` | Lessons for today's weekday in Europe/Chisinau |
| `GET /api/source?course=2` | Source PDF URL, hash, timestamps, and update state |

See [API behavior](docs/debugging.md#public-api-behavior) for response details and errors.

## Documentation

- [Engineering case study](docs/portfolio.md): the problem, implementation tradeoffs, verification, and contributions.
- [Architecture](docs/architecture.md): course model, transport, validation, persistence, and retention.
- [Debugging and operations](docs/debugging.md): diagnostics, configuration, recovery, and testing.
- [MD Publisher operations](docs/publisher.md): installation, credentials, scheduling, and troubleshooting.
- [Publisher quick reference](tools/md-publisher/README.md): build and CLI commands.

## License and data sources

Repository source code is licensed under the [MIT License](LICENSE). Timetable PDFs and
data originate from [UTM/FCIM sources](https://fcim.utm.md/orar-sectia-zi-2/);
these third-party materials are **not licensed under this project's MIT license**.
Bundled PDF provenance and hashes are recorded in [architecture](docs/architecture.md#bundled-seeds-and-provenance).
## Indoor map integration

Optional bounded CORS for the FCIM map is documented in
[docs/map-02b-integration.md](docs/map-02b-integration.md).
The default allowlist is empty; existing API JSON and clients remain compatible.
