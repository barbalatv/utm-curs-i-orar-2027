/**
 * Read-side queries over the cached schedule: filtering, per-group
 * projection, "today" and the public status payload. No parsing happens here.
 */
import { config } from "@/lib/config";
import { DAY_NAMES, type DayName, type Lesson, type Schedule } from "@/lib/models";
import { checkForUpdates } from "@/lib/services/updater";
import { getCurrentSchedule, getSourceState } from "@/lib/storage";

export interface ScheduleFilters {
  group?: string | null;
  day?: string | null;
  teacher?: string | null;
  subject?: string | null;
  room?: string | null;
  q?: string | null;
}

const DAY_LOOKUP = new Map<string, DayName>([
  ["luni", "Luni"],
  ["marti", "Marți"],
  ["marți", "Marți"],
  ["marţi", "Marți"],
  ["miercuri", "Miercuri"],
  ["joi", "Joi"],
  ["vineri", "Vineri"],
  ["monday", "Luni"],
  ["tuesday", "Marți"],
  ["wednesday", "Miercuri"],
  ["thursday", "Joi"],
  ["friday", "Vineri"],
]);

export function normalizeDayParam(raw: string | null | undefined): DayName | null {
  if (!raw) return null;
  return DAY_LOOKUP.get(raw.trim().toLowerCase()) ?? null;
}

export function normalizeGroupParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toUpperCase();
}

function fold(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function filterLessons(lessons: Lesson[], filters: ScheduleFilters): Lesson[] {
  const group = normalizeGroupParam(filters.group);
  const day = normalizeDayParam(filters.day);
  const teacher = fold(filters.teacher);
  const subject = fold(filters.subject);
  const room = fold(filters.room);
  const query = fold(filters.q);

  return lessons.filter((lesson) => {
    if (group && !lesson.groups.includes(group)) return false;
    if (day && lesson.day !== day) return false;
    if (teacher && !fold(lesson.teacher).includes(teacher)) return false;
    if (subject && !fold(lesson.subject).includes(subject)) return false;
    if (room && !fold(lesson.room).includes(room)) return false;
    if (query) {
      const haystack = [lesson.subject, lesson.teacher, lesson.room, lesson.groups.join(" "), lesson.raw_text].map(fold).join(" ");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** Sort by day, then time, then odd-before-even, then first group column. */
export function sortLessons(lessons: Lesson[]): Lesson[] {
  const dayOrder = new Map(DAY_NAMES.map((day, index) => [day, index]));
  const parityOrder = { both: 0, odd: 1, even: 2, unknown: 3 } as const;
  return [...lessons].sort(
    (a, b) =>
      (dayOrder.get(a.day) ?? 9) - (dayOrder.get(b.day) ?? 9) ||
      a.start_time.localeCompare(b.start_time) ||
      parityOrder[a.week_parity] - parityOrder[b.week_parity] ||
      a.geometry.x0 - b.geometry.x0,
  );
}

/** Weekday name in Europe/Chisinau for a given instant, or null on weekends. */
export function todayInChisinau(now = new Date()): DayName | null {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: config.timezone }).format(now);
  return normalizeDayParam(weekday);
}

/**
 * Returns the cached schedule; on a cold start with an empty cache it waits
 * for the bootstrap so the first visitor is not greeted with "no data".
 */
export async function requireSchedule(): Promise<Schedule | null> {
  const cached = await getCurrentSchedule();
  if (cached) return cached;
  await checkForUpdates();
  return getCurrentSchedule();
}

export async function buildStatus() {
  const [schedule, state] = await Promise.all([getCurrentSchedule(), getSourceState()]);
  return {
    ok: schedule !== null,
    has_schedule: schedule !== null,
    schedule: schedule
      ? {
          academic_year: schedule.metadata.academic_year,
          semester: schedule.metadata.semester,
          course_year: schedule.metadata.course_year,
          source_kind: schedule.metadata.source_kind,
          source_pdf_url: schedule.metadata.source_pdf_url,
          source_pdf_hash: schedule.metadata.source_pdf_hash,
          downloaded_at: schedule.metadata.downloaded_at,
          parsed_at: schedule.metadata.parsed_at,
          parser_version: schedule.metadata.parser_version,
          groups: schedule.groups.length,
          lessons: schedule.lessons.length,
          uncertain_lessons: schedule.lessons.filter((lesson) => lesson.uncertain).length,
          warnings: schedule.warnings,
        }
      : null,
    source: {
      page_url: config.schedulePageUrl,
      current_pdf_url: state.current_pdf_url,
      etag: state.etag,
      last_modified: state.last_modified,
      last_check_at: state.last_check_at,
      last_success_at: state.last_success_at,
      last_result: state.last_result,
      last_error: state.last_error,
      last_error_at: state.last_error_at,
      parity_note: state.parity_note,
      odd_week_anchor: config.oddWeekAnchor,
      refresh_interval_minutes: config.refreshIntervalMs / 60_000,
    },
    server_time: new Date().toISOString(),
    timezone: config.timezone,
  };
}

export type StatusPayload = Awaited<ReturnType<typeof buildStatus>>;
