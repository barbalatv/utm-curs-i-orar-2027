/**
 * Course-scoped history queries for `schedule_versions`.
 *
 * Kept apart from the storage layer so the scoping itself is testable without a
 * live PostgreSQL: every builder here renders to SQL through drizzle's dialect,
 * and the tests assert that each statement carries its `course_year` filter.
 * A write for one course must never touch another course's rows.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { scheduleVersions } from "@/db/schema";
import type { Schedule } from "@/lib/models";

/** Versions retained per course. Pruning is per-course, so a busy course cannot
 *  evict the only recovery row of a quiet one. */
export const HISTORY_LIMIT_PER_COURSE = 20;

/** The one current version of a single course. */
export function currentVersionFilter(courseYear: number): SQL {
  return and(eq(scheduleVersions.isCurrent, true), eq(scheduleVersions.courseYear, courseYear)) as SQL;
}

/** Row values for a newly installed schedule; the course year comes from the parsed document. */
export function versionValues(schedule: Schedule) {
  return {
    courseYear: schedule.metadata.course_year,
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
  };
}

/** Delete everything past the newest `limit` rows *of this course only*. */
export function pruneStatement(courseYear: number, limit = HISTORY_LIMIT_PER_COURSE): SQL {
  return sql`delete from schedule_versions where course_year = ${courseYear} and id not in (select id from schedule_versions where course_year = ${courseYear} order by created_at desc limit ${limit})`;
}
