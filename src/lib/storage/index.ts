/**
 * Persistence for the current schedule and the auto-update state.
 *
 *  - data/current_schedule.json + data/metadata.json: atomic (tmp → fsync → rename) files,
 *    the hot path used by the API. Works without any database (single container).
 *  - PostgreSQL `schedule_versions` (optional, when DATABASE_URL is set): version history and
 *    a recovery source when the data directory is empty.
 */
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { getLogger, errorMessage } from "@/lib/logger";
import { EMPTY_SOURCE_STATE, ScheduleSchema, SourceStateSchema, type Schedule, type SourceState } from "@/lib/models";

const log = getLogger("storage");

const SCHEDULE_FILE = "current_schedule.json";
const METADATA_FILE = "metadata.json";

interface MemoryCache {
  schedule: Schedule | null;
  state: SourceState | null;
  loaded: boolean;
  /** mtimes of the cache files at load time – lets other module instances (Next.js bundles
   *  instrumentation and route handlers separately) notice writes without re-parsing JSON on every request. */
  scheduleMtime: number;
  stateMtime: number;
}

/** Shared across bundles via globalThis so the scheduler and the API see the same data. */
const globalCache = globalThis as typeof globalThis & { __fcimStorageCache?: MemoryCache };
const memory: MemoryCache = (globalCache.__fcimStorageCache ??= {
  schedule: null,
  state: null,
  loaded: false,
  scheduleMtime: 0,
  stateMtime: 0,
});

async function mtimeOf(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
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

async function ensureLoaded(): Promise<void> {
  const dir = config.dataDir;
  const schedulePath = path.join(dir, SCHEDULE_FILE);
  const statePath = path.join(dir, METADATA_FILE);
  const [scheduleMtime, stateMtime] = await Promise.all([mtimeOf(schedulePath), mtimeOf(statePath)]);
  if (memory.loaded && scheduleMtime === memory.scheduleMtime && stateMtime === memory.stateMtime) return;

  if (!memory.loaded || scheduleMtime !== memory.scheduleMtime) {
    memory.schedule = await readJson(schedulePath, (raw) => ScheduleSchema.parse(raw));
    memory.scheduleMtime = scheduleMtime;
  }
  if (!memory.loaded || stateMtime !== memory.stateMtime) {
    memory.state = await readJson(statePath, (raw) => SourceStateSchema.parse(raw));
    memory.stateMtime = stateMtime;
  }

  if (!memory.schedule && dbAvailable()) {
    memory.schedule = await recoverFromDb();
    if (memory.schedule) {
      await atomicWrite(schedulePath, JSON.stringify(memory.schedule));
      memory.scheduleMtime = await mtimeOf(schedulePath);
      log.info("recovered schedule from database history", { hash: memory.schedule.metadata.source_pdf_hash });
    }
  }
  memory.loaded = true;
}

async function recoverFromDb(): Promise<Schedule | null> {
  try {
    const { db, scheduleVersions } = await loadDb();
    const rows = await db
      .select({ payload: scheduleVersions.payload })
      .from(scheduleVersions)
      .where(eq(scheduleVersions.isCurrent, true))
      .orderBy(desc(scheduleVersions.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    const parsed = ScheduleSchema.safeParse(rows[0].payload);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    log.warn("database recovery skipped", { error: errorMessage(error) });
    return null;
  }
}

export async function getCurrentSchedule(): Promise<Schedule | null> {
  await ensureLoaded();
  return memory.schedule;
}

export async function getSourceState(): Promise<SourceState> {
  await ensureLoaded();
  return memory.state ?? EMPTY_SOURCE_STATE;
}

export async function saveSourceState(patch: Partial<SourceState>): Promise<SourceState> {
  await ensureLoaded();
  const next: SourceState = { ...(memory.state ?? EMPTY_SOURCE_STATE), ...patch };
  const statePath = path.join(config.dataDir, METADATA_FILE);
  await atomicWrite(statePath, JSON.stringify(next, null, 2));
  memory.state = next;
  memory.stateMtime = await mtimeOf(statePath);
  return next;
}

/**
 * Atomically replace the current schedule. The previous version stays on disk
 * until the rename succeeds, so a crash mid-write never loses the last good copy.
 */
export async function replaceCurrentSchedule(schedule: Schedule): Promise<void> {
  await ensureLoaded();
  const schedulePath = path.join(config.dataDir, SCHEDULE_FILE);
  await atomicWrite(schedulePath, JSON.stringify(schedule));
  memory.schedule = schedule;
  memory.scheduleMtime = await mtimeOf(schedulePath);
  if (dbAvailable()) await recordVersion(schedule);
}

async function recordVersion(schedule: Schedule): Promise<void> {
  try {
    const { db, scheduleVersions } = await loadDb();
    await db.transaction(async (tx) => {
      await tx.update(scheduleVersions).set({ isCurrent: false }).where(eq(scheduleVersions.isCurrent, true));
      await tx.insert(scheduleVersions).values({
        pdfUrl: schedule.metadata.source_pdf_url,
        pdfHash: schedule.metadata.source_pdf_hash,
        sourceKind: schedule.metadata.source_kind,
        academicYear: schedule.metadata.academic_year,
        semester: schedule.metadata.semester,
        lessonCount: schedule.lessons.length,
        groupCount: schedule.groups.length,
        parserVersion: schedule.metadata.parser_version,
        payload: schedule,
        isCurrent: true,
      });
      // Keep the table bounded: retain the 20 most recent versions.
      await tx.execute(sql`delete from schedule_versions where id not in (select id from schedule_versions order by created_at desc limit 20)`);
    });
  } catch (error) {
    log.warn("failed to record schedule version in database", { error: errorMessage(error) });
  }
}

/** Test helper: forget the in-memory cache so the next call re-reads the disk. */
export function resetStorageCache(): void {
  memory.schedule = null;
  memory.state = null;
  memory.loaded = false;
  memory.scheduleMtime = 0;
  memory.stateMtime = 0;
}
