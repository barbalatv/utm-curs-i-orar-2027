/**
 * Strict data model shared by parser, storage, API and frontend.
 * zod plays the role Pydantic would play in a Python stack.
 */
import { z } from "zod";

export const DAY_NAMES = ["Luni", "Marți", "Miercuri", "Joi", "Vineri"] as const;
export const DaySchema = z.enum(DAY_NAMES);
export type DayName = z.infer<typeof DaySchema>;

export const LESSON_TYPES = [
  "lecture",
  "lab",
  "seminar",
  "practice",
  "physical_education",
  "language",
  "project",
  "unknown",
] as const;
export const LessonTypeSchema = z.enum(LESSON_TYPES);
export type LessonType = z.infer<typeof LessonTypeSchema>;

export const WeekParitySchema = z.enum(["odd", "even", "both", "unknown"]);
export type WeekParity = z.infer<typeof WeekParitySchema>;

const TimeString = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");

export const GeometrySchema = z.object({
  page: z.number().int().min(1),
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});
export type Geometry = z.infer<typeof GeometrySchema>;

export const LessonSchema = z.object({
  id: z.string().min(1),
  day: DaySchema,
  /** Index of the first time slot the lesson occupies (0 = 08:00). */
  slot_index: z.number().int().min(0),
  /** Number of consecutive time slots covered (vertically merged cells). */
  slot_span: z.number().int().min(1),
  start_time: TimeString,
  end_time: TimeString,
  groups: z.array(z.string().min(1)).min(1),
  subject: z.string().min(1),
  teacher: z.string().nullable(),
  room: z.string().nullable(),
  lesson_type: LessonTypeSchema,
  subgroup: z.string().nullable(),
  week_parity: WeekParitySchema,
  notes: z.array(z.string()),
  raw_text: z.string(),
  geometry: GeometrySchema,
  /** 0..1 – how confident the interpreter is about subject/teacher/room split. */
  confidence: z.number().min(0).max(1),
  uncertain: z.boolean(),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const TimeSlotSchema = z.object({
  index: z.number().int().min(0),
  start_time: TimeString,
  end_time: TimeString,
  raw: z.string(),
});
export type TimeSlot = z.infer<typeof TimeSlotSchema>;

export const GroupSchema = z.object({
  name: z.string().min(1),
  /** Program prefix, e.g. "SI" for SI-261. */
  program: z.string(),
  x0: z.number(),
  x1: z.number(),
});
export type GroupColumn = z.infer<typeof GroupSchema>;

export const ScheduleMetadataSchema = z.object({
  academic_year: z.string().nullable(),
  semester: z.string().nullable(),
  course_year: z.number().int(),
  source_page_url: z.string(),
  source_pdf_url: z.string(),
  source_pdf_hash: z.string(),
  /** "live" = discovered on fcim.utm.md, "wayback" = archive mirror, "seed" = bundled fallback PDF. */
  source_kind: z.enum(["live", "wayback", "seed", "manual"]),
  downloaded_at: z.string(),
  parsed_at: z.string(),
  parser_version: z.string(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  pdf_title: z.string().nullable(),
});
export type ScheduleMetadata = z.infer<typeof ScheduleMetadataSchema>;

export const ScheduleSchema = z.object({
  metadata: ScheduleMetadataSchema,
  groups: z.array(GroupSchema).min(1),
  days: z.array(DaySchema),
  time_slots: z.array(TimeSlotSchema),
  lessons: z.array(LessonSchema),
  /** Non-fatal parser observations (orphan cells, uncertain entries, ...). */
  warnings: z.array(z.string()),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

/** Persisted state of the auto-update loop. */
export const SourceStateSchema = z.object({
  current_pdf_url: z.string().nullable(),
  current_pdf_hash: z.string().nullable(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  last_check_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
  last_error_at: z.string().nullable(),
  /** Result of the most recent check: what happened. */
  last_result: z
    .enum(["updated", "unchanged", "rejected", "error", "seeded", "never"])
    .default("never"),
  academic_year: z.string().nullable().default(null),
  semester: z.string().nullable().default(null),
  parity_note: z.string().nullable().default(null),
});
export type SourceState = z.infer<typeof SourceStateSchema>;

export const EMPTY_SOURCE_STATE: SourceState = {
  current_pdf_url: null,
  current_pdf_hash: null,
  etag: null,
  last_modified: null,
  last_check_at: null,
  last_success_at: null,
  last_error: null,
  last_error_at: null,
  last_result: "never",
  academic_year: null,
  semester: null,
  parity_note: null,
};
