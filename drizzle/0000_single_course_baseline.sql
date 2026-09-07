-- Baseline: the single-course `schedule_versions` table as it existed before
-- multi-course support. IF NOT EXISTS is deliberate — deployments that created this
-- table with `drizzle-kit push` already have it, and must be able to adopt the
-- migration journal without dropping their history. On a fresh database this creates
-- the table; on an existing one it is a no-op, and 0001 does the actual upgrade.
CREATE TABLE IF NOT EXISTS "schedule_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"pdf_url" text NOT NULL,
	"pdf_hash" text NOT NULL,
	"source_kind" text NOT NULL,
	"academic_year" text,
	"semester" text,
	"lesson_count" integer NOT NULL,
	"group_count" integer NOT NULL,
	"parser_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
