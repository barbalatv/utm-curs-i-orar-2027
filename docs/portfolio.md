# Engineering case study: Orar FCIM UTM

[Live application](https://utm-curs-i-orar-2027.onrender.com/) · [Project overview](../README.md) · [Screenshot provenance](images/README.md)

## Problem

FCIM publishes timetables as wide PDF tables. Students need a readable schedule for
their group, but the documents encode meaning through position: columns identify
groups, borders divide time slots, merged cells span groups or lessons, and half-height
cells distinguish alternating weeks. Flattening the text loses those relationships.
An upstream document can also change format, disappear, or contain incomplete data.
A successful download alone is insufficient reason to replace a working timetable.

## Solution

Orar FCIM UTM is an independent, unofficial application for first- and second-year
students. Its Next.js/React interface supports group selection, day and week views,
all-groups browsing, and search. TypeScript services turn official PDFs into a shared
[Zod schedule model](../src/lib/models.ts) served through JSON endpoints.

[Discovery](../src/lib/source/discovery.ts) selects the course's document from the
official full-time timetable page, including its embedded data and historical table
layout. The [publisher](../tools/md-publisher/src/publish.ts) can acquire the canonical
WordPress Page API and PDFs from a separate host and upload raw candidates to a
Cloudflare Broker/R2 snapshot. The application, rather than the publisher, selects,
parses, validates, and accepts the timetable. With no broker URL configured, it uses
direct FCIM transport, with an optional archive discovery fallback.

## Engineering challenges

### 1. Recovering structure from PDF geometry

The [parser pipeline](../src/lib/parser/index.ts) uses `pdfjs-dist` to extract positioned
text and filled rectangles. It detects group headers, day blocks, and time-slot rows,
then reconstructs cells from borders. [Cell construction](../src/lib/parser/cell-builder.ts)
resolves group and time spans; the [interpreter](../src/lib/parser/lesson-interpreter.ts)
derives week parity from half-cell placement and extracts subjects, teachers, rooms,
and lesson types. Raw text, geometry, and uncertainty remain available for diagnosis.
This is rule-based reconstruction, without OCR or an AI model. The
[parser regression suite](../tests/parser.test.ts) checks real PDF fixtures, geometry,
merged cells, and normalized lessons against expected results.

### 2. Separating a candidate from an accepted schedule

The [validator](../src/lib/parser/validator.ts) checks the schema, weekday coverage,
time ordering, group assignment, geometry, and structural minimums. Current defaults
require five groups and 30 lessons; four time slots are required. More than 50% uncertain
lessons is an error; more than 15% produces a warning. A candidate below 60% of the
previous lesson count is rejected. The [updater](../src/lib/services/updater.ts) also
rejects a parsed document belonging to another course year.

In broker mode, a validated candidate must be written durably before replacing local
state. The application writes an immutable accepted payload and advances its pointer
using compare-and-swap. A failed write or conflict preserves the previous local
schedule. [Accepted-state tests](../tests/accepted-state-sync.test.ts) exercise this
ordering, restart recovery, and rejection of a bad successor. These checks reduce
structural mistakes; they do not prove perfect transcription or source authenticity.

### 3. Recovering without confusing availability with freshness

The [storage layer](../src/lib/storage/index.ts) serves the current in-memory/local
schedule, adopting compatible legacy files when necessary. If configured, PostgreSQL
can restore the course's current version from its history table. For a course still
empty, [bootstrap](../src/lib/services/updater.ts) next tries broker accepted state,
then a bundled seed whose bytes must match its release-owned SHA-256 descriptor.
[Seed tests](../tests/seed-cold-start.test.ts) cover missing sources, hash mismatches,
and course isolation.

An update failure retains available accepted data and records diagnostics. A configured
broker failure does not silently select direct FCIM transport. Recovery has a deadline
and can fail; recovered data can be older than the latest publication. The UI exposes
source links and update/check times so readers can inspect that distinction.

## Architecture

The [architecture diagram](../README.md#architecture) shows both transport paths.
The core is one Next.js application, its parser/updater, and local schedule storage;
browser and API reads do not require a database. Broker/R2 and a publisher host are
optional infrastructure, recommended by the existing production topology. PostgreSQL
is optional history/recovery storage. Update coordination is process-local, so the
documented deployment uses one application replica rather than claiming distributed
high availability.

## Reliability and verification

Tests span real-PDF regressions, mocked discovery/updater/API integration, and
[PostgreSQL integration](../tests/db-integration/schedule-versions.test.ts).
[Chromium E2E tests](../tests/e2e/schedule.spec.ts) cover course isolation, group
selection, view switching, and restored preferences using controlled API fixtures;
they do not verify the live university source. The [CI workflow](../.github/workflows/ci.yml)
uses Node 22, disposable PostgreSQL 16, committed migrations, tests, typechecks, lint,
application/publisher builds, and a Worker dry run. Reproduction commands remain in
the [README](../README.md#testing). This case study describes coverage, not a new
production acceptance or uptime result.

## My contribution

I (Vladimir Barbalat, `barbalatv`) implemented and integrated the application and parser,
with subsequent work visible in merged PRs: [publisher tooling #28](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/28),
[PostgreSQL tests #36](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/36),
[seed provenance #38](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/38),
[source migration #57](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/57), and
[bounded map API access #58](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/58).
The [initial release](https://github.com/barbalatv/utm-curs-i-orar-2027/commit/f2b6cc849cf16c41a9d3bb89479ceec2e459456f)
and later parser commits provide implementation history. AntyElo contributed the
[documentation split](https://github.com/barbalatv/utm-curs-i-orar-2027/commit/03e4ee68fbbb352af21d9b97b108c2cb0d847cdb)
and [README restructuring](https://github.com/barbalatv/utm-curs-i-orar-2027/commit/e46ef4094d22b70ca2539661c1eafb4241e319de).
Official PDFs and timetable content originate from FCIM, not from me.

## Current limitations

There is no university endorsement or guaranteed source freshness. Unmapped or ambiguous
PDF cells can remain; structural acceptance is not a manual audit of every lesson.
Week parity uses a configured calendar anchor. Optional infrastructure need not be
enabled in every deployment. Screenshots document an observed public interface, not
verified current classes, live attendance, or a production-grade availability guarantee.

## Further information

[Architecture and seed provenance](architecture.md) · [Deployment, recovery, testing, and debugging](debugging.md) · [Publisher operations and trust limits](publisher.md) · [Source migration runbook](fcim-source-migration-01.md) · [Map integration contract](map-02b-integration.md)
