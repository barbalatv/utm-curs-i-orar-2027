/** Time helpers pinned to Europe/Chisinau regardless of the visitor's device timezone. */
import type { DayName, Lesson } from "@/lib/models";

export const TIMEZONE = "Europe/Chisinau";

const WEEKDAY_TO_DAY: Record<string, DayName> = {
  Monday: "Luni",
  Tuesday: "Marți",
  Wednesday: "Miercuri",
  Thursday: "Joi",
  Friday: "Vineri",
};

export const DAY_SHORT: Record<DayName, string> = { Luni: "Lu", Marți: "Ma", Miercuri: "Mi", Joi: "Jo", Vineri: "Vi" };

export interface LocalNow {
  day: DayName | null;
  minutes: number;
  dateLabel: string;
  timeLabel: string;
}

export function localNow(now = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    day: WEEKDAY_TO_DAY[get("weekday")] ?? null,
    minutes: hour * 60 + minute,
    dateLabel: new Intl.DateTimeFormat("ro-RO", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(now),
    timeLabel: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(",", "");
}

export type LessonStatus = "past" | "current" | "next" | "upcoming";

/** Classify today's lessons relative to the current time; only for the current day. */
export function classifyLessons(lessons: Lesson[], now: LocalNow, day: DayName): Map<string, LessonStatus> {
  const result = new Map<string, LessonStatus>();
  if (now.day !== day) return result;
  let nextAssigned = false;
  const sorted = [...lessons].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  for (const lesson of sorted) {
    const start = toMinutes(lesson.start_time);
    const end = toMinutes(lesson.end_time);
    if (now.minutes >= end) result.set(lesson.id, "past");
    else if (now.minutes >= start) result.set(lesson.id, "current");
    else if (!nextAssigned) {
      result.set(lesson.id, "next");
      nextAssigned = true;
    } else result.set(lesson.id, "upcoming");
  }
  // Every lesson starting at the same time as the "next" one is also next.
  const nextLesson = sorted.find((lesson) => result.get(lesson.id) === "next");
  if (nextLesson) {
    for (const lesson of sorted) if (lesson.start_time === nextLesson.start_time && result.get(lesson.id) === "upcoming") result.set(lesson.id, "next");
  }
  return result;
}

export function dayBanner(lessons: Lesson[], now: LocalNow, day: DayName): string | null {
  if (now.day !== day) return null;
  if (lessons.length === 0) return "Nu sunt lecții programate azi";
  const statuses = classifyLessons(lessons, now, day);
  if ([...statuses.values()].includes("current")) return null;
  const next = lessons.find((lesson) => statuses.get(lesson.id) === "next");
  if (next) return `Următoarea lecție la ${next.start_time}`;
  return "Lecțiile de azi s-au încheiat";
}
