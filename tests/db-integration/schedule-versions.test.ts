import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { pruneStatement, versionValues } from "@/db/schedule-versions";
import { scheduleVersions } from "@/db/schema";
import { config } from "@/lib/config";
import type { Schedule } from "@/lib/models";
import { getCurrentSchedule, replaceCurrentSchedule, resetStorageCache } from "@/lib/storage";

interface FixtureOptions {
  revision?: string;
}

interface PostgreSqlConstraintError {
  code: string;
  constraint: string | null;
}

interface IndexCatalogRow {
  index_name: string;
  is_unique: boolean;
  predicate: string | null;
  columns: string[];
}

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATA_DIR = process.env.SCHEDULE_DATA_DIR;

function scheduleFor(courseYear: number, options: FixtureOptions = {}): Schedule {
  const revision = options.revision ?? "v1";
  const group = courseYear === 1 ? "SI-261" : "SI-251";

  return {
    metadata: {
      academic_year: "2026/2027",
      semester: courseYear === 1 ? "Semestrul I" : "Semestrul III",
      course_year: courseYear,
      source_page_url: "https://fcim.utm.md/procesul-de-studii/orar/",
      source_pdf_url: `https://fcim.utm.md/test-fixtures/course-${courseYear}-${revision}.pdf`,
      source_pdf_hash: `hash-course-${courseYear}-${revision}`,
      source_kind: "live",
      source_transport: "direct",
      source_snapshot_id: null,
      downloaded_at: "2026-09-01T07:30:00.000Z",
      parsed_at: "2026-09-01T07:31:00.000Z",
      parser_version: "db-integration-1",
      etag: null,
      last_modified: "Mon, 01 Sep 2026 07:30:00 GMT",
      pdf_title: null,
    },
    groups: [{ name: group, program: "SI", x0: 120.5, x1: 220.75 }],
    days: ["Luni"],
    time_slots: [{ index: 0, start_time: "08:00", end_time: "09:30", raw: "08:00–09:30" }],
    lessons: [
      {
        id: `lesson-${courseYear}-${revision}`,
        day: "Luni",
        slot_index: 0,
        slot_span: 1,
        start_time: "08:00",
        end_time: "09:30",
        groups: [group],
        subject: `Baze de date ${revision}`,
        teacher: null,
        room: "3-201",
        lesson_type: "lab",
        subgroup: null,
        week_parity: "both",
        notes: ["fixture JSONB round-trip"],
        raw_text: `Baze de date ${revision}\n3-201`,
        geometry: { page: 1, x0: 120.5, y0: 200.25, x1: 220.75, y1: 245.5 },
        confidence: 0.98,
        uncertain: false,
      },
    ],
    warnings: ["integration fixture warning"],
  };
}

function postgresConstraintError(error: unknown): PostgreSqlConstraintError | null {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const record = candidate as Record<string, unknown>;
    if (typeof record.code === "string") {
      return {
        code: record.code,
        constraint: typeof record.constraint === "string" ? record.constraint : null,
      };
    }
    candidate = record.cause;
  }
  return null;
}

function assertSafeTestEnvironment(): void {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for a disposable local test database");
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }
  if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname)) {
    throw new Error(
      `refusing to run destructive DB integration tests against non-local host ${databaseUrl.hostname}`,
    );
  }

  if (!TEST_DATA_DIR) {
    throw new Error("SCHEDULE_DATA_DIR is required for DB integration tests");
  }
  const repositoryRoot = path.resolve(process.cwd());
  const resolvedTestDataDir = path.resolve(repositoryRoot, TEST_DATA_DIR);
  const relativeTestDataDir = path.relative(repositoryRoot, resolvedTestDataDir);
  if (path.resolve(config.dataDir) !== resolvedTestDataDir) {
    throw new Error("SCHEDULE_DATA_DIR must be set before the Vitest process imports storage configuration");
  }
  if (
    relativeTestDataDir === "" ||
    relativeTestDataDir.startsWith("..") ||
    path.isAbsolute(relativeTestDataDir) ||
    resolvedTestDataDir === path.join(repositoryRoot, "data")
  ) {
    throw new Error("SCHEDULE_DATA_DIR must be a dedicated path inside the repository, not the production data directory");
  }
}

async function cleanFileCache(): Promise<void> {
  await rm(config.dataDir, { recursive: true, force: true });
  await mkdir(config.dataDir, { recursive: true });
}

let safeEnvironment = false;

beforeAll(() => {
  assertSafeTestEnvironment();
  safeEnvironment = true;
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE schedule_versions RESTART IDENTITY`);
  resetStorageCache();
  await cleanFileCache();
});

afterAll(async () => {
  resetStorageCache();
  if (safeEnvironment) await rm(config.dataDir, { recursive: true, force: true });
  await pool.end();
});

describe("PostgreSQL schedule version integration", () => {
  it("migrations establish the expected schedule_versions schema and indexes", async () => {
    const table = await pool.query<{ table_name: string | null }>(
      "select to_regclass('public.schedule_versions')::text as table_name",
    );
    expect(table.rows[0]?.table_name).toBe("schedule_versions");

    const column = await pool.query<{
      data_type: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    }>(`
      select data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'schedule_versions'
        and column_name = 'course_year'
    `);
    expect(column.rows).toHaveLength(1);
    expect(column.rows[0]).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    const normalizedDefault = column.rows[0].column_default?.replace(/[()\s]/g, "") ?? "";
    expect(normalizedDefault).toMatch(/^1(?:::(?:pg_catalog\.)?integer)?$/);

    const indexes = await pool.query<IndexCatalogRow>(`
      select
        index_class.relname as index_name,
        index_catalog.indisunique as is_unique,
        pg_get_expr(index_catalog.indpred, index_catalog.indrelid) as predicate,
        array_agg(attribute.attname::text order by key_column.ordinality)
          filter (where attribute.attname is not null) as columns
      from pg_class as table_class
      join pg_namespace as namespace on namespace.oid = table_class.relnamespace
      join pg_index as index_catalog on index_catalog.indrelid = table_class.oid
      join pg_class as index_class on index_class.oid = index_catalog.indexrelid
      left join lateral unnest(index_catalog.indkey) with ordinality as key_column(attnum, ordinality) on true
      left join pg_attribute as attribute
        on attribute.attrelid = table_class.oid and attribute.attnum = key_column.attnum
      where namespace.nspname = 'public'
        and table_class.relname = 'schedule_versions'
        and index_class.relname in (
          'schedule_versions_one_current_per_course',
          'schedule_versions_course_created_at'
        )
      group by index_class.relname, index_catalog.indisunique, index_catalog.indpred, index_catalog.indrelid
    `);

    const partialUnique = indexes.rows.find(
      (index) => index.index_name === "schedule_versions_one_current_per_course",
    );
    expect(partialUnique).toBeDefined();
    expect(partialUnique).toMatchObject({ is_unique: true, columns: ["course_year"] });
    expect(partialUnique?.predicate).toMatch(/is_current/i);

    const lookup = indexes.rows.find((index) => index.index_name === "schedule_versions_course_created_at");
    expect(lookup).toBeDefined();
    expect(lookup?.columns).toEqual(["course_year", "created_at"]);
  });

  it("two courses coexist with independent current versions", async () => {
    await replaceCurrentSchedule(1, scheduleFor(1));
    await replaceCurrentSchedule(2, scheduleFor(2));

    const rows = await pool.query<{ course_year: number; total: number; current_count: number }>(`
      select
        course_year,
        count(*)::integer as total,
        count(*) filter (where is_current)::integer as current_count
      from schedule_versions
      group by course_year
      order by course_year
    `);
    expect(rows.rows).toEqual([
      { course_year: 1, total: 1, current_count: 1 },
      { course_year: 2, total: 1, current_count: 1 },
    ]);
  });

  it("replacing one course retires only that course's previous current version", async () => {
    await replaceCurrentSchedule(1, scheduleFor(1, { revision: "v1" }));
    await replaceCurrentSchedule(2, scheduleFor(2, { revision: "v1" }));
    await replaceCurrentSchedule(1, scheduleFor(1, { revision: "v2" }));

    const rows = await pool.query<{ course_year: number; pdf_hash: string; is_current: boolean }>(`
      select course_year, pdf_hash, is_current
      from schedule_versions
      order by id
    `);
    expect(rows.rows).toEqual([
      { course_year: 1, pdf_hash: "hash-course-1-v1", is_current: false },
      { course_year: 2, pdf_hash: "hash-course-2-v1", is_current: true },
      { course_year: 1, pdf_hash: "hash-course-1-v2", is_current: true },
    ]);
  });

  it("database rejects two current versions for the same course", async () => {
    const original = scheduleFor(1, { revision: "original" });
    await db.insert(scheduleVersions).values(versionValues(original));

    let rejection: unknown;
    try {
      await db.insert(scheduleVersions).values(versionValues(scheduleFor(1, { revision: "duplicate" })));
    } catch (error) {
      rejection = error;
    }

    const postgresError = postgresConstraintError(rejection);
    expect(postgresError).toEqual({
      code: "23505",
      constraint: "schedule_versions_one_current_per_course",
    });

    await db.insert(scheduleVersions).values(versionValues(scheduleFor(2)));
    const currentRows = await pool.query<{ course_year: number; pdf_hash: string }>(`
      select course_year, pdf_hash
      from schedule_versions
      where is_current
      order by course_year
    `);
    expect(currentRows.rows).toEqual([
      { course_year: 1, pdf_hash: original.metadata.source_pdf_hash },
      { course_year: 2, pdf_hash: "hash-course-2-v1" },
    ]);
  });

  it("pruning retains the newest history per course without touching another course", async () => {
    const history = Array.from({ length: 25 }, (_, index) => {
      const revision = `history-${String(index + 1).padStart(2, "0")}`;
      return {
        ...versionValues(scheduleFor(1, { revision })),
        isCurrent: false,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      };
    });
    const otherCourse = Array.from({ length: 3 }, (_, index) => {
      const revision = `other-${index + 1}`;
      return {
        ...versionValues(scheduleFor(2, { revision })),
        isCurrent: false,
        createdAt: new Date(Date.UTC(2026, 1, index + 1)),
      };
    });
    await db.insert(scheduleVersions).values([...history, ...otherCourse]);

    const before = await pool.query<{ course_year: number; count: number }>(`
      select course_year, count(*)::integer as count
      from schedule_versions
      group by course_year
      order by course_year
    `);
    expect(before.rows).toEqual([
      { course_year: 1, count: 25 },
      { course_year: 2, count: 3 },
    ]);

    await db.execute(pruneStatement(1, 20));

    const after = await pool.query<{ course_year: number; count: number }>(`
      select course_year, count(*)::integer as count
      from schedule_versions
      group by course_year
      order by course_year
    `);
    expect(after.rows).toEqual([
      { course_year: 1, count: 20 },
      { course_year: 2, count: 3 },
    ]);

    const survivors = await pool.query<{ pdf_hash: string }>(`
      select pdf_hash
      from schedule_versions
      where course_year = 1
      order by created_at
    `);
    expect(survivors.rows.map((row) => row.pdf_hash)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `hash-course-1-history-${String(index + 6).padStart(2, "0")}`,
      ),
    );
  });

  it("recovers a valid course schedule from PostgreSQL when the file cache is empty", async () => {
    const original = scheduleFor(1, { revision: "recovery" });
    await replaceCurrentSchedule(1, original);

    const persisted = await pool.query<{ payload: Schedule }>(`
      select payload
      from schedule_versions
      where course_year = 1 and is_current
    `);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].payload).toEqual(original);

    const courseOneDir = path.join(config.dataDir, "courses", "1");
    await rm(courseOneDir, { recursive: true, force: true });
    resetStorageCache();

    const recovered = await getCurrentSchedule(1);
    expect(recovered).toEqual(original);
    expect(recovered?.lessons[0]).toMatchObject({ teacher: null, subgroup: null });
    expect(recovered?.metadata.course_year).toBe(1);
    const recreated = JSON.parse(
      await readFile(path.join(courseOneDir, "current_schedule.json"), "utf8"),
    ) as unknown;
    expect(recreated).toEqual(original);
    expect(await getCurrentSchedule(2)).toBeNull();

    const mismatchedPayload = scheduleFor(2, { revision: "mismatched-payload" });
    await db
      .update(scheduleVersions)
      .set({ payload: mismatchedPayload })
      .where(eq(scheduleVersions.courseYear, 1));
    await rm(courseOneDir, { recursive: true, force: true });
    resetStorageCache();
    expect(await getCurrentSchedule(1)).toBeNull();
  });
});
