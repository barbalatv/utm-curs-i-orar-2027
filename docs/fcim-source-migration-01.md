# FCIM-SOURCE-MIGRATION-01

Local implementation and deployment runbook. No commit, push, merge or production deployment
was performed. Production observations below were read-only on 2026-10-09 (Europe/Chisinau).

## Evidence and root cause

The [new official page](https://fcim.utm.md/orar-sectia-zi-2/) and its
[WordPress API](https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar-sectia-zi-2&context=view)
identify page **28642**, `modified_gmt=2026-10-06T08:54:47`.
The HTML contains `window.ORAR_FCIM_EXCEL`, the `orar-fcim-root` shadow-DOM host,
a JSON string assigned to `root.innerHTML`, and JSON data assigned to `const D`.
The embedded header explicitly identifies full-time study and academic year **2026/2027**;
`D.years` identifies semesters **I, III, V, VII** for Anul I–IV. There is no static
legacy section/table for server-side discovery. Exact upstream rendered HTML is archived in
`tests/fixtures/orar-sectia-zi-2-2026-10-09.html`; it is parsed as data, never executed.

| Course | Official path under `/wp-content/uploads/sites/24/` | Semester |
| --- | --- | --- |
| Anul I | `2026/10/anul_i_semestrul_i-4.pdf` | I |
| Anul II | `2026/10/anul_ii_semestrul_iii-1.pdf` | III |
| Anul III | `2026/10/anul_iii_semestrul_v-2.pdf` | V |
| Anul IV | `2026/10/anul_iv_semestrul_vii-1.pdf` | VII |

Read-only [broker current](https://fcim-schedule-broker.barbalatv.workers.dev/current)
confirmed snapshot `2026-09-26T08-39-29-959Z-3fd88da3`, page **1739**, timestamp
**2026-09-26T08:29:31**, ten PDFs. Its immutable manifest and archived Page API agree.
The baseline includes the obsolete `2026/09/orar_ses_toamna_fr-1-10.pdf`.
The October 7 timestamp supplied in the incident is the old page's *later live* timestamp,
not the timestamp of this September 26 snapshot. The new page is newer than the actual
production baseline; ordinary timestamp comparison would pass for that specific state.
An identity-scoped migration is still necessary if the old page's later state was published.

Production Render source endpoints still report September PDFs: Anul I `-35`, Anul II `-24`,
with the obsolete page URL. This is a pre-deployment observation, not proof of restored updates.

Root causes and implementation locations:

* `worker-shared/fcim-policy.ts`: publisher and broker previously approved only `slug=orar`.
  The canonical source is now `slug=orar-sectia-zi-2`; the legacy URL is historical identity
  evidence only and is refused for new acquisition/publication configuration.
* `tools/md-publisher/src/publish.ts`, `detectChange`: every baseline PDF was checked even
  after a changed page removed it, so a retired PDF's 404 blocked a valid new inventory.
  A changed page must have the canonical ID, readable rendered content, and nonempty official
  inventory before absent old URLs are retired. Retained missing PDFs and unchanged-source
  missing PDFs still fail, with or without validators. New PDFs must all pass download/upload
  integrity validation before the snapshot can win the current-pointer CAS.
* `tools/md-publisher/src/{baseline,broker,types}.ts`: cached HTTP validators now carry their
  source endpoint. Old/unscoped caches are rebuilt from broker current; validators from the
  old endpoint never condition a request to the new endpoint. Snapshot anchoring remains intact.
* `worker/src/publisher.ts`: publication requires page ID 28642. Only an immutable manifest
  identifying legacy endpoint + ID 1739, with a matching current-pointer identity when present,
  permits the one-way transition. Its minimum acceptable incoming timestamp is the verified
  new-page timestamp `2026-10-06T08:54:47`. Missing/older timestamps and excessive future
  timestamps remain refused. Once page 28642 is current, its own timestamp becomes the baseline;
  older same-page material and reverse migration are refused. Legacy four-field pointers use
  immutable manifest identity. No force flag or environment bypass is added.
* `src/lib/source/discovery.ts`: reads the new embed's JSON literals, full-time heading,
  academic year, and explicit per-course semesters; checks the official PDF URL and filename
  against the course and semester. Malformed, ambiguous, reduced-attendance, wrong-year,
  wrong-course and wrong-semester embeds fail. The legacy table parser remains available
  for legitimate archived fixtures and snapshots.
* `src/lib/source/revision.ts` and `src/lib/services/updater.ts`: within the same document
  family, compare upload year/month before numeric suffix. October `-4` outranks September
  `-35`; suffixes compare only within the same publication directory. Unrelated families
  retain page order. Packaged seed promotion already compared publication periods correctly.
* `worker-shared/pdf-inventory.ts`: moves the existing strict transport-only extractor into
  a dependency-free shared module so publisher retirement uses the same inventory as broker
  planning. `worker/src/extractor.ts` reexports it. URL, redirect, SSRF and filename rules
  remain unchanged; Worker acquires no FCIM data and interprets no timetable semantics.

Other changed files: `.env.example`, `worker/wrangler.toml`, `src/lib/config.ts`, `README.md`,
`docs/architecture.md`, `docs/publisher.md`, the new migration regression suite and HTML fixture.
Existing acquisition test routes were updated to the new canonical URL/ID; historical
snapshot metadata and timetable fixtures remain historical. No dependency, schema, R2 key,
accepted-state format, database migration, service unit, timer or CI workflow changes are required.

## Verification

The migration suite runs the real publisher, Worker routes, snapshot finalization and Render
updater together with in-process R2/transport doubles. Its two-course acceptance test uses
genuine historical PDF fixtures under the new URL inventory: **recorded fixture replay**,
not a live publication of the October PDFs. Outbound production writes are never performed.
Coverage includes observed September baseline metadata, a later October legacy baseline,
scoped validator caches, legacy pointers, orphan retirement, retained/new missing PDFs,
invalid inventories, migration timestamp/identity failures, month ordering, immutable snapshots,
publisher baseline-cache advancement, and independent durable/local accepted-state updates.

Separately, both live October PDFs returned HTTP 200 / `application/pdf` from this Windows
workstation and passed the unchanged parser/validator:

| Course | Bytes | Groups | Lessons | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| I | 1306028 | 41 | 454 | `ea38a76a3800da5ee320cfd048f19af14cbfa81168c26626babcf25cca050d05` |
| II | 785752 | 26 | 291 | `d2f7bde17384ecd9a5033882f30e288aa917fe40e26964a4095a5dc5f7a8e737` |

Parsed academic year/course/semester agree with page metadata, with no validation warnings.
Validation also passes with the read-only production schedule lesson counts as the prior-count
baseline: 454 for course I and 291 for course II. The production acceptance transaction itself
has not been executed.
These are dated observations, not revision pins. They do not verify future Debian connectivity
or production acceptance against its existing schedule; perform the deployment checks below.

Local validation completed with Node 22.23.1:

| Command | Result |
| --- | --- |
| `npm test` | 32 files, **722 tests passed** |
| `npx vitest run tests/fcim-source-migration.test.ts` | **34 migration tests passed** |
| `npm run typecheck` | passed (Next route generation + TypeScript) |
| `npm run typecheck:worker` | passed |
| `npm run typecheck:publisher` | passed |
| `npm run lint` | passed |
| `npm run build` | Next production build passed |
| `npm run build:publisher` | passed |
| `npm run check:worker` | dry-run bundle passed, 47.58 KiB / gzip 14.39 KiB |
| `npm run test:e2e -- --workers=2` | **4 Chromium tests passed** |
| `git diff --check` | passed |

Existing toolchain notices concerned Vitest's future config loader, an external parent
package-lock, Playwright color settings, and `next start` with standalone output; checks passed.
No dependency/config changes were made to silence these unrelated notices. The existing
[hosted CI run](https://github.com/barbalatv/utm-curs-i-orar-2027/actions/runs/37851190923)
passed on SHA `6ed04b735d2c037a4aeedfba14e375878eeb4910`, including PostgreSQL integration
and Playwright. That SHA differs from local base `99fcbf9ffcab32e1f561f7ab48f8c148b94db756`;
it is background evidence only. Hosted CI for this uncommitted patch has not run. PostgreSQL
integration requires a test database; PostgreSQL/Docker are unavailable locally.

## Safe deployment order (after explicit authorization)

Use one reviewed revision for all three components. Do not deploy whatever happens to be
latest on main. Keep R2 bucket, queue names, secrets and accepted-state records intact.

1. **Preflight / pause Debian scheduling.** Record current Worker version, Render deployment,
   Debian commit/build, environment overrides and publisher state directory. Save read-only
   copies of `/current`, its manifest/Page API, both accepted pointers and their payloads.
   Check the exact deployment revision has successful hosted CI, including database tests.
   As the publisher runtime account:

   ```sh
   systemctl --user stop fcim-md-publisher.timer
   systemctl --user show fcim-md-publisher.service --property=ActiveState,SubState,MainPID
   systemctl --user list-jobs --no-pager
   ```

   Wait for service idle/failed with `MainPID=0`, no pending start job, and no manual publisher.
   Do not kill an active publication. Inspect local `run/operation.json` / `run/page.json` and
   `/publication-status`: if an unfinished old-source operation remains, stop and resolve it
   before migrating; do not delete snapshot/accepted records or blindly clear publisher state.
   See [publisher operations](publisher.md) for the deployment and state inspection procedure.

2. **Cloudflare Worker first.** On the reviewed clean revision, run worker typecheck and dry-run,
   then deploy `worker/wrangler.toml` through the existing account/workspace. This operation
   needs explicit deployment authorization. Required vars:

   ```text
   FCIM_PAGE_API_URL=https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar-sectia-zi-2&context=view
   SCHEDULE_PAGE_URL=https://fcim.utm.md/orar-sectia-zi-2/
   MAX_PAGE_FUTURE_SKEW_HOURS=26
   ```

   ```sh
   npm run typecheck:worker
   npm run check:worker
   npx wrangler deploy --config worker/wrangler.toml
   ```

   The last command is the authorized deployment step, not a verification dry-run.

   Preserve the existing R2 and queue bindings and both distinct credentials. Verify `/health`
   and `/current`; current and accepted pointers should still name existing complete data.
   The publisher remains paused, so the new acquisition policy cannot race the old publisher.

3. **Render second.** Deploy the same reviewed revision through the existing Render service.
   Set existing overrides (or remove obsolete overrides so the new defaults apply):

   ```text
   SCHEDULE_PAGE_URL=https://fcim.utm.md/orar-sectia-zi-2/
   SCHEDULE_WORDPRESS_API_URL=https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar-sectia-zi-2&context=view
   SCHEDULE_BROKER_URL=https://fcim-schedule-broker.barbalatv.workers.dev
   ```

   Retain the existing `SCHEDULE_BROKER_SECRET`, courses `1,2`, database and scheduler settings.
   Keep broker transport enabled. Do not clear local course caches or durable accepted state.
   During this staged window, Render may still serve the last accepted September schedules;
   that is preserved state until the new candidate publishes. Verify process health, both course
   routes and metadata. Check the deployed revision before proceeding.

4. **Debian publisher last.** Keep its timer stopped. Use the guarded clean-tree update/build
   procedure in [publisher.md](publisher.md#safe-manual-deployment-update), substituting
   the authorized reviewed revision. Install locked dependencies including dev dependencies,
   then run `npm run typecheck:publisher` and `npm run build:publisher`. Preserve
   `~/.config/fcim-md-publisher/env`, broker URL/token, state, and installed systemd overrides.
   There is no publisher source-URL environment variable to add: its canonical endpoint is compiled.

   After the authorized revision is available remotely, update without discarding local changes:

   ```sh
   cd "$HOME/utm-curs-i-orar-2027"
   MIGRATION_REVISION='<authorized reviewed commit SHA>'
   (
     set -eu
     test -z "$(git status --porcelain)"
     git fetch origin
     git merge-base --is-ancestor HEAD "$MIGRATION_REVISION"
     git merge --ff-only "$MIGRATION_REVISION"
     npm ci --include=dev
     npm run typecheck:publisher
     npm run build:publisher
     /usr/bin/node tools/md-publisher/dist/tools/md-publisher/src/index.js --help
   )
   ```

   If ancestry or any check fails, leave scheduling paused and reconcile deliberately.
   Use the existing `publisher_cli` helper (systemd-run with the installed EnvironmentFile):

   ```sh
   publisher_cli doctor --json
   publisher_cli status --json
   publisher_cli check --json
   publisher_cli publish --dry-run --json
   ```

   Timer inactive is expected during maintenance. Require an authoritative-page change report
   and no upstream error. `check`/dry-run do not prove that PDFs upload or that Render accepts
   them. Then perform one explicitly authorized publication:

   ```sh
   publisher_cli publish --json
   publisher_cli status --json
   ```

   Require terminal `published`, matching broker `/current`, a new complete manifest with
   page ID 28642, new endpoint, `modified_gmt >= 2026-10-06T08:54:47`, and all four PDFs
   (or the freshly verified official inventory if FCIM has since changed). Verify each stored
   PDF's size/digest, and that `last-run.json` is anchored to this broker-current snapshot.

5. **Verify acceptance and resume scheduling.** Let Render's existing automatic update cycle
   process the candidate (or use the existing authorized admin refresh route). For both courses,
   require `/api/source?course=N` and `/api/schedule?course=N` to show the new URL/hash,
   `2026/2027`, course I/II and semesters I/III, broker transport and the new snapshot ID.
   Confirm `/accepted/course-N` and its payload agree; publication alone is not acceptance.
   If rejected/error, preserve current accepted schedules and investigate the reported validation
   cause. Do not lower validator thresholds or force accepted-state writes.
   A second `publisher_cli check --json` should report unchanged for a stable upstream.
   Only after successful verification:

   ```sh
   systemctl --user start fcim-md-publisher.timer
   systemctl --user is-active fcim-md-publisher.timer
   systemctl --user list-timers fcim-md-publisher.timer --no-pager
   journalctl --user -u fcim-md-publisher.service -n 80 --no-pager
   publisher_cli doctor --json
   publisher_cli status --json
   ```

   Verify the next scheduled service run and heartbeat. Starting the timer can run the service
   immediately. Later legitimate page changes and in-place PDF replacements must produce a new
   snapshot/acceptance cycle; do not manufacture a production change to test this.

## Rollback / failure recovery

Stop Debian's timer and wait for the service to become idle before any rollback. Preserve logs,
the failed operation and all old/new snapshots, accepted pointers/payloads, and database history.
Do not manually overwrite `current.json`, edit accepted pointers, lower timestamp guards or
re-enable the obsolete source as a recovery shortcut.

* **Before a new snapshot is current:** existing current and accepted state remain valid. Restore
  the recorded Worker/Render code versions and environment settings if necessary; rebuild the
  recorded publisher version. Keep its timer stopped: the pre-migration source is still broken.
* **After publication but before acceptance:** retain the complete new snapshot and previous
  accepted schedules. Prefer correcting the failing parser/deployment on the new source.
  Old Render versions cannot discover the embed; rolling code back does not restore updates.
* **After acceptance:** retain accepted payloads and their history. Rolling code back must not
  automatically roll data back. If the timetable itself is wrong, independently verify the intended
  official PDF and use the existing reviewed administrative recovery/accepted-state CAS path with
  explicit authorization. Restore code components in reverse order (publisher, Render, Worker)
  only with scheduling paused and after checking compatibility with retained snapshots/accepted data.

Resume scheduling only with a compatible Worker + Render + publisher combination using the
authoritative new source. A rollback to the old implementation is incident containment, not a
restoration of automatic timetable updates.
