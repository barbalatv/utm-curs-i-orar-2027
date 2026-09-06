/**
 * Persistence for the current schedule and the auto-update state.
 *
 * Every course year owns an independent slot; nothing is shared between them:
 *
 *  - data/courses/<year>/current_schedule.json + metadata.json: atomic
 *    (tmp → fsync → rename) files, the hot path used by the API. Works without
 *    any database (single container).
 *  - PostgreSQL `schedule_versions` (optional, when DATABASE_URL is set): version
 *    history per course and a recovery source when the data directory is empty.
 *
 * Legacy compatibility: a deployment upgraded from the single-course layout still
 * has data/current_schedule.json + data/metadata.json. Those are adopted once, for
 * the course whose year the cached schedule actually declares (in practice Anul I),
 * and only while that course has no scoped files yet. The legacy files are left in
 * place — the adoption is a copy, so a rollback still finds them.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { desc } from "drizzle-orm";
import { config } from "@/lib/config";
import { currentVersionFilter, pruneStatement, versionValues } from "@/db/schedule-versions";
import { assertSupportedCourse } from "@/lib/courses";
import { getLogger, errorMessage } from "@/lib/logger";
import { createEmptySourceState, ScheduleSchema, SourceStateSchema, type Schedule, type SourceState } from "@/lib/models";

const log = getLogger("storage");

const SCHEDULE_FILE = "current_schedule.json";
const METADATA_FILE = "metadata.json";
const COURSES_DIR = "courses";

interface CourseCache {
  schedule: Schedule | null;
  state: SourceState | null;
  loaded: boolean;
  /** Whether the pre-multi-course files were already considered for this course. */
  legacyChecked: boolean;
  /** mtimes of the cache files at load time – lets other module instances (Next.js bundles
   *  instrumentation and route handlers separately) notice writes without re-parsing JSON on every request. */
  scheduleMtime: number;
  stateMtime: number;
}

/** Shared across bundles via globalThis so the scheduler and the API see the same data. */
const globalCache = globalThis as typeof globalThis & { __fcimStorageCache?: Map<number, CourseCache> };
const caches: Map<number, CourseCache> = (globalCache.__fcimStorageCache ??= new Map());

/** Every cache lookup goes through the course gate: `data/courses/3` can never be created. */
function cacheFor(courseYear: number): CourseCache {
  assertSupportedCourse(courseYear);
  let cache = caches.get(courseYear);
  if (!cache) {
    cache = { schedule: null, state: null, loaded: false, legacyChecked: false, scheduleMtime: 0, stateMtime: 0 };
    caches.set(courseYear, cache);
  }
  return cache;
}

function courseDir(courseYear: number): string {
  assertSupportedCourse(courseYear);
  return path.join(config.dataDir, COURSES_DIR, String(courseYear));
}

function schedulePathFor(courseYear: number): string {
  return path.join(courseDir(courseYear), SCHEDULE_FILE);
}

function statePathFor(courseYear: number): string {
  return path.join(courseDir(courseYear), METADATA_FILE);
}

async function mtimeOf(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * One in-flight write per destination. Updates are serialized upstream, but the file is a
 * single resource and nothing should depend on that: overlapping writers would otherwise
 * race their renames onto the same path, which on Windows fails outright (EPERM) rather
 * than simply picking a winner.
 */
const writeChains = new Map<string, Promise<void>>();

function serializeWrite(filePath: string, run: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(filePath) ?? Promise.resolve();
  const next = previous.then(run, run);
  // The tail never rejects, so one failed write does not poison the queue behind it.
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  writeChains.set(filePath, tail);
  void tail.then(() => {
    // Drop the entry only if nothing queued behind this write, so the map stays bounded.
    if (writeChains.get(filePath) === tail) writeChains.delete(filePath);
  });
  return next;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  return serializeWrite(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    // The pid alone is not unique enough: two writes of the same file can overlap inside one
    // process (and a recycled pid can collide across processes), and a shared temp name would
    // let one write truncate another's buffer before either rename lands.
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath).catch(async (error) => {
      await rm(tempPath, { force: true });
      throw error;
    });
  });
}

async function readJson<T>(filePath: string, parse: (raw: unknown) => T): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    log.warn("failed to read cache file", { filePath, error: errorMessage(error) });
    return null;
  }
}

function dbAvailable(): boolean {
  return Boolean(config.databaseUrl);
}

async function loadDb() {
  const [{ db }, { scheduleVersions }] = await Promise.all([import("@/db"), import("@/db/schema")]);
  return { db, scheduleVersions };
}

/**
 * Adopt the pre-multi-course cache for the course it actually belongs to.
 * A legacy file whose parsed course year does not match is ignored, so an Anul I
 * cache can never become the Anul II schedule.
 */
async function adoptLegacyCache(courseYear: number, cache: CourseCache): Promise<void> {
  cache.legacyChecked = true;
  const legacySchedulePath = path.join(config.dataDir, SCHEDULE_FILE);
  const legacy = await readJson(legacySchedulePath, (raw) => ScheduleSchema.parse(raw));
  if (!legacy) return;
  if (legacy.metadata.course_year !== courseYear) {
    log.info("legacy cache belongs to another course year; leaving it untouched", {
      courseYear,
      legacyCourseYear: legacy.metadata.course_year,
    });
    return;
  }

  const schedulePath = schedulePathFor(courseYear);
  await atomicWrite(schedulePath, JSON.stringify(legacy));
  cache.schedule = legacy;
  cache.scheduleMtime = await mtimeOf(schedulePath);

  // The source state travels only when it demonstrably describes *this* schedule.
  // Both files are independently valid JSON, so shape proves nothing: a metadata.json
  // left over from a different document would hand this schedule someone else's ETag,
  // hash and error state, and the next check would answer 304 for a PDF that is not
  // the one on disk. Unproven identity means the schedule is adopted bare.
  const legacyState = await readJson(path.join(config.dataDir, METADATA_FILE), (raw) => SourceStateSchema.parse(raw));
  const identity = legacyStateIdentity(legacy, legacyState);
  if (legacyState && identity.matches) {
    const statePath = statePathFor(courseYear);
    await atomicWrite(statePath, JSON.stringify(legacyState, null, 2));
    cache.state = legacyState;
    cache.stateMtime = await mtimeOf(statePath);
  } else if (legacyState) {
    log.warn("legacy source state does not describe the adopted schedule; discarding it", {
      courseYear,
      reason: identity.reason,
      scheduleHash: legacy.metadata.source_pdf_hash,
      stateHash: legacyState.current_pdf_hash,
      scheduleUrl: legacy.metadata.source_pdf_url,
      stateUrl: legacyState.current_pdf_url,
    });
  }
  log.warn("adopted the pre-multi-course cache for its own course year", {
    courseYear,
    from: legacySchedulePath,
    to: schedulePath,
    hash: legacy.metadata.source_pdf_hash,
    adoptedState: Boolean(legacyState && identity.matches),
  });
}

/**
 * Does this legacy SourceState belong to this legacy schedule? The SHA-256 is the
 * strongest identifier both files carry, so it decides whenever the state has one;
 * only a state that never recorded a hash falls back to the source URL.
 */
function legacyStateIdentity(
  schedule: Schedule,
  state: SourceState | null,
): { matches: boolean; reason: string } {
  if (!state) return { matches: false, reason: "no legacy metadata.json" };
  if (state.current_pdf_hash) {
    return state.current_pdf_hash === schedule.metadata.source_pdf_hash
      ? { matches: true, reason: "hash matches the adopted schedule" }
      : { matches: false, reason: "current_pdf_hash names a different document" };
  }
  if (state.current_pdf_url) {
    return state.current_pdf_url === schedule.metadata.source_pdf_url
      ? { matches: true, reason: "url matches the adopted schedule" }
      : { matches: false, reason: "current_pdf_url names a different document" };
  }
  return { matches: false, reason: "legacy metadata identifies no document" };
}

async function ensureLoaded(courseYear: number): Promise<void> {
  const cache = cacheFor(courseYear);
  const schedulePath = schedulePathFor(courseYear);
  const statePath = statePathFor(courseYear);
  const [scheduleMtime, stateMtime] = await Promise.all([mtimeOf(schedulePath), mtimeOf(statePath)]);
  if (cache.loaded && scheduleMtime === cache.scheduleMtime && stateMtime === cache.stateMtime) return;

  if (!cache.loaded || scheduleMtime !== cache.scheduleMtime) {
    cache.schedule = await readJson(schedulePath, (raw) => ScheduleSchema.parse(raw));
    cache.scheduleMtime = scheduleMtime;
  }
  if (!cache.loaded || stateMtime !== cache.stateMtime) {
    cache.state = await readJson(statePath, (raw) => SourceStateSchema.parse(raw));
    cache.stateMtime = stateMtime;
  }

  if (!cache.schedule && !cache.legacyChecked) await adoptLegacyCache(courseYear, cache);

  if (!cache.schedule && dbAvailable()) {
    cache.schedule = await recoverFromDb(courseYear);
    if (cache.schedule) {
      await atomicWrite(schedulePath, JSON.stringify(cache.schedule));
      cache.scheduleMtime = await mtimeOf(schedulePath);
      log.info("recovered schedule from database history", {
        courseYear,
        hash: cache.schedule.metadata.source_pdf_hash,
      });
    }
  }
  cache.loaded = true;
}

async function recoverFromDb(courseYear: number): Promise<Schedule | null> {
  try {
    const { db, scheduleVersions } = await loadDb();
    const rows = await db
      .select({ payload: scheduleVersions.payload })
      .from(scheduleVersions)
      .where(currentVersionFilter(courseYear))
      .orderBy(desc(scheduleVersions.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    const parsed = ScheduleSchema.safeParse(rows[0].payload);
    // A row that somehow carries another course's payload is not a recovery source.
    if (!parsed.success || parsed.data.metadata.course_year !== courseYear) return null;
    return parsed.data;
  } catch (error) {
    log.warn("database recovery skipped", { courseYear, error: errorMessage(error) });
    return null;
  }
}

export async function getCurrentSchedule(courseYear: number): Promise<Schedule | null> {
  assertSupportedCourse(courseYear);
  await ensureLoaded(courseYear);
  return cacheFor(courseYear).schedule;
}

/**
 * A course with nothing persisted yet gets its own empty state object, never a shared
 * one: two empty courses that returned the same instance would leak a mutation of one
 * into the other.
 */
export async function getSourceState(courseYear: number): Promise<SourceState> {
  assertSupportedCourse(courseYear);
  await ensureLoaded(courseYear);
  const state = cacheFor(courseYear).state;
  return state ? { ...state } : createEmptySourceState();
}

export async function saveSourceState(courseYear: number, patch: Partial<SourceState>): Promise<SourceState> {
  assertSupportedCourse(courseYear);
  await ensureLoaded(courseYear);
  const cache = cacheFor(courseYear);
  const next: SourceState = { ...(cache.state ?? createEmptySourceState()), ...patch };
  const statePath = statePathFor(courseYear);
  await atomicWrite(statePath, JSON.stringify(next, null, 2));
  cache.state = next;
  cache.stateMtime = await mtimeOf(statePath);
  return next;
}

/**
 * Atomically replace one course's current schedule. The previous version stays on
 * disk until the rename succeeds, so a crash mid-write never loses the last good copy.
 */
export async function replaceCurrentSchedule(courseYear: number, schedule: Schedule): Promise<void> {
  assertSupportedCourse(courseYear);
  if (schedule.metadata.course_year !== courseYear) {
    // Defence in depth: the updater's course guard runs first, but storage is the
    // last place that could write one course's document into another course's slot.
    throw new Error(
      `refusing to store a course year ${schedule.metadata.course_year} schedule under course year ${courseYear}`,
    );
  }
  await ensureLoaded(courseYear);
  const cache = cacheFor(courseYear);
  const schedulePath = schedulePathFor(courseYear);
  await atomicWrite(schedulePath, JSON.stringify(schedule));
  cache.schedule = schedule;
  cache.scheduleMtime = await mtimeOf(schedulePath);
  if (dbAvailable()) await recordVersion(courseYear, schedule);
}

async function recordVersion(courseYear: number, schedule: Schedule): Promise<void> {
  try {
    const { db, scheduleVersions } = await loadDb();
    await db.transaction(async (tx) => {
      // Scoped by course: installing Anul II must not retire Anul I's current row.
      await tx.update(scheduleVersions).set({ isCurrent: false }).where(currentVersionFilter(courseYear));
      await tx.insert(scheduleVersions).values(versionValues(schedule));
      await tx.execute(pruneStatement(courseYear));
    });
  } catch (error) {
    log.warn("failed to record schedule version in database", { courseYear, error: errorMessage(error) });
  }
}

/** Test helper: forget the in-memory cache so the next call re-reads the disk. */
export function resetStorageCache(): void {
  caches.clear();
}
