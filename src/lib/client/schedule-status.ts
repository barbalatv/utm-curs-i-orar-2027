import type { DayName, Lesson, WeekParity } from "@/lib/models";
import { isOtherWeek, lessonsThisWeek, localNow, toMinutes, type LocalNow, type WeekParityName } from "@/lib/client/time";

export type TodayScheduleStatusType = "current" | "break" | "ended" | "no_lessons";

export interface TodayScheduleStatus {
  type: TodayScheduleStatusType;
  text: string;
  lessons?: ScheduleLessonItem[];
  minutesUntil?: number;
}

export type ScheduleLessonItem = {
  subject: string;
  start_time: string;
  end_time: string;
  id?: string;
  day?: DayName | string;
  week_parity?: WeekParity;
  subgroup?: string | null;
  groups?: string[];
  teacher?: string | null;
  room?: string | null;
};

function resolveLocalNow(time: Date | string | LocalNow): LocalNow {
  if (typeof time === "string" || time instanceof Date) {
    return localNow(new Date(time));
  }
  return time;
}

/**
 * Determines schedule status for the current day ("Azi") in Europe/Chisinau timezone.
 *
 * Exactly 4 mutually exclusive states:
 * 1. "current": Сейчас: [предмет] [время начала]–[время окончания]
 * 2. "break": Следующее: [предмет] через [N] мин · [время начала]–[время окончания]
 * 3. "ended": На сегодня занятий больше нет.
 * 4. "no_lessons": Сегодня занятий нет.
 *
 * Boundary: [start, end) interval. Start is inclusive, end is exclusive.
 */
export function getTodayScheduleStatus(
  lessons: ScheduleLessonItem[],
  currentTime: Date | string | LocalNow = new Date(),
  options?: { parity?: WeekParityName }
): TodayScheduleStatus {
  const current = resolveLocalNow(currentTime);

  if (!lessons || lessons.length === 0) {
    return {
      type: "no_lessons",
      text: "Сегодня занятий нет.",
    };
  }

  let activeLessons = lessons;

  // Filter by week parity if provided
  if (options?.parity) {
    activeLessons = lessonsThisWeek(activeLessons as Lesson[], options.parity);
  }

  // Filter by day if lesson day is specified and current day is known
  if (current.day) {
    activeLessons = activeLessons.filter((l) => !l.day || l.day === current.day);
  }

  if (activeLessons.length === 0) {
    return {
      type: "no_lessons",
      text: "Сегодня занятий нет.",
    };
  }

  const sorted = [...activeLessons].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const nowMin = current.minutes;

  // 1. Current lesson: [start, end)
  const currentLessons = sorted.filter((l) => {
    const start = toMinutes(l.start_time);
    const end = toMinutes(l.end_time);
    return nowMin >= start && nowMin < end;
  });

  if (currentLessons.length > 0) {
    const subject = Array.from(new Set(currentLessons.map((l) => l.subject.trim()))).join(" / ");
    const startTime = currentLessons[0].start_time;
    const endTime = currentLessons[0].end_time;
    return {
      type: "current",
      text: `Сейчас: ${subject} ${startTime}–${endTime}`,
      lessons: currentLessons,
    };
  }

  // 2. Break / upcoming lesson today: start > nowMin
  const upcomingLessons = sorted.filter((l) => toMinutes(l.start_time) > nowMin);
  if (upcomingLessons.length > 0) {
    const nextStartTime = upcomingLessons[0].start_time;
    const nextSlotLessons = upcomingLessons.filter((l) => l.start_time === nextStartTime);
    const subject = Array.from(new Set(nextSlotLessons.map((l) => l.subject.trim()))).join(" / ");
    const startTime = nextSlotLessons[0].start_time;
    const endTime = nextSlotLessons[0].end_time;
    const minutesUntil = toMinutes(startTime) - nowMin;
    return {
      type: "break",
      text: `Следующее: ${subject} через ${minutesUntil} мин · ${startTime}–${endTime}`,
      lessons: nextSlotLessons,
      minutesUntil,
    };
  }

  // 3. Lessons ended for today: nowMin >= last lesson end
  return {
    type: "ended",
    text: "На сегодня занятий больше нет.",
  };
}

// Alias for convenience
export const getScheduleStatus = getTodayScheduleStatus;
