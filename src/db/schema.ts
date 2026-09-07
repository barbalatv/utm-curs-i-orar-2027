import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Version history of parsed schedules. The file cache in data/ is the hot
 * path; this table keeps an auditable history (hash, URL, lesson counts) and
 * lets the app recover its last known-good schedule after a container restart
 * with an empty data volume.
 *
 * Every row belongs to exactly one course year, and `is_current` is current
 * *within* a course: Anul I and Anul II each keep one current version at the
 * same time. Rows written before multi-course support default to course 1,
 * which is what those single-course deployments actually held.
 *
 * The partial unique index makes "one current version per course" a database
 * invariant rather than a promise the application sequencing makes. Two writers
 * racing on the same course cannot both leave an is_current row behind: the
 * second transaction fails and rolls back instead of corrupting the recovery
 * source. The lookup index keeps the recovery query on one course cheap.
 */
export const scheduleVersions = pgTable("schedule_versions", {
  id: serial("id").primaryKey(),
  courseYear: integer("course_year").notNull().default(1),
  pdfUrl: text("pdf_url").notNull(),
  pdfHash: text("pdf_hash").notNull(),
  sourceKind: text("source_kind").notNull(),
  academicYear: text("academic_year"),
  semester: text("semester"),
  lessonCount: integer("lesson_count").notNull(),
  groupCount: integer("group_count").notNull(),
  parserVersion: text("parser_version").notNull(),
  payload: jsonb("payload").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("schedule_versions_one_current_per_course")
    .on(table.courseYear)
    .where(sql`${table.isCurrent}`),
  index("schedule_versions_course_created_at").on(table.courseYear, table.createdAt.desc()),
]);
