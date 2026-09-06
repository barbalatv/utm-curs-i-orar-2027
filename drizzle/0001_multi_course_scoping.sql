-- Multi-course history scoping.
--
-- Every existing row was written by a single-course (Anul I) deployment, so the new
-- column's DEFAULT 1 is not a placeholder: PostgreSQL backfills existing rows with it,
-- which is exactly the course year those rows actually describe. No history is deleted
-- or rewritten here.
ALTER TABLE "schedule_versions" ADD COLUMN "course_year" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- Defensive: the partial unique index below refuses to build if a course somehow has
-- more than one current row. The old single-course writer retired the previous current
-- row inside the same transaction as the insert, so this should match nothing — but a
-- database restored from a partial dump, or touched by hand, would otherwise fail the
-- migration at index creation with nothing repaired. Keep the newest row per course.
UPDATE "schedule_versions" AS stale
SET "is_current" = false
WHERE stale."is_current"
  AND stale."id" <> (
    SELECT newest."id"
    FROM "schedule_versions" AS newest
    WHERE newest."is_current" AND newest."course_year" = stale."course_year"
    ORDER BY newest."created_at" DESC, newest."id" DESC
    LIMIT 1
  );--> statement-breakpoint

-- One current version per course, enforced by the database rather than by application
-- sequencing alone: two writers racing on the same course cannot both leave an
-- is_current row behind, so the recovery source can never be ambiguous.
CREATE UNIQUE INDEX "schedule_versions_one_current_per_course" ON "schedule_versions" USING btree ("course_year") WHERE "schedule_versions"."is_current";--> statement-breakpoint

-- Recovery reads "the newest current row of course N"; keep that lookup on an index.
CREATE INDEX "schedule_versions_course_created_at" ON "schedule_versions" USING btree ("course_year","created_at" DESC NULLS LAST);
