import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Version history of parsed schedules. The file cache in data/ is the hot
 * path; this table keeps an auditable history (hash, URL, lesson counts) and
 * lets the app recover its last known-good schedule after a container restart
 * with an empty data volume.
 */
export const scheduleVersions = pgTable("schedule_versions", {
  id: serial("id").primaryKey(),
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
});
