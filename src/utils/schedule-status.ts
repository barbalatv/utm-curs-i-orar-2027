import type { DayName, Lesson } from "@/lib/models";

export const TIMEZONE = "Europe/Chisinau";

export type ScheduleStatusType = "current" | "next_today" | "next_future" | "empty";

export interface ScheduleStatus {
  type: ScheduleStatusType;
  kind: ScheduleStatusType;
  status: ScheduleStatusType;
  text: string;
  subject?: string;
  start_time?: string;
  end_time?: string;
  date?: string;
  currentLesson?: Lesson;
  nextLesson?: Lesson;
}

export type ScheduleLessonInput = (Partial<Lesson> | Record<string, any>) & {
  subject: string;
  start_time: string;
  end_time?: string;
  day?: DayName | string;
  subgroup?: string | null;
  date?: string;
};

const DAY_MAP: Record<string, DayName> = {
  Monday: "Luni",
  Tuesday: "Marți",
  Wednesday: "Miercuri",
  Thursday: "Joi",
  Friday: "Vineri",
};

const DAY_INDEX: Record<string, number> = {
  Luni: 0,
  Marți: 1,
  Miercuri: 2,
  Joi: 3,
  Vineri: 4,
};

export function getChisinauTime(date: Date): { hours: number; minutes: number; totalMinutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hours = Number.parseInt(get("hour"), 10) % 24;
  const minutes = Number.parseInt(get("minute"), 10);
  return {
    hours,
    minutes,
    totalMinutes: hours * 60 + minutes,
  };
}

export function getChisinauWeekday(date: Date): { weekday: string; dayName: DayName | null; weekdayIndex: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const index = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(weekday);
  return {
    weekday,
    dayName: DAY_MAP[weekday] ?? null,
    weekdayIndex: index >= 0 ? index : 0,
  };
}

export function formatChisinauDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}`;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Calculates current schedule status relative to Chișinău civil time.
 *
 * Rules:
 * 1. [start, end) interval: at now === end the lesson is considered ended.
 * 2. Back-to-back lessons (end1 === start2) transition seamlessly at now === end1 without duplicate states.
 * 3. Subgroups in the same slot are joined as "Subj1 / Subj2".
 * 4. 4 mutually exclusive states:
 *    - "current": «Сейчас: <Subject> [HH:MM–HH:MM]»
 *    - "next_today": «Далее: <Subject> в HH:MM»
 *    - "next_future": «Следующая пара: <Subject> в <дата> HH:MM»
 *    - "empty": «Сегодня пар нет»
 */
export function getScheduleStatus(
  lessons: ScheduleLessonInput[],
  now: Date
): ScheduleStatus {
  if (!lessons || lessons.length === 0) {
    return {
      type: "empty",
      kind: "empty",
      status: "empty",
      text: "Сегодня пар нет",
    };
  }

  const time = getChisinauTime(now);
  const weekdayInfo = getChisinauWeekday(now);
  const todayDayName = weekdayInfo.dayName;
  const todayFormattedDate = formatChisinauDate(now);

  const todayLessons: ScheduleLessonInput[] = [];
  const futureLessons: Array<{ lesson: ScheduleLessonInput; daysAhead: number }> = [];

  for (const lesson of lessons) {
    if (lesson.date) {
      if (lesson.date === todayFormattedDate) {
        todayLessons.push(lesson);
      } else {
        futureLessons.push({ lesson, daysAhead: 1 });
      }
      continue;
    }

    if (lesson.day) {
      if (lesson.day === todayDayName) {
        todayLessons.push(lesson);
      } else if (DAY_INDEX[lesson.day] !== undefined) {
        const targetIndex = DAY_INDEX[lesson.day];
        let daysAhead = targetIndex - weekdayInfo.weekdayIndex;
        if (daysAhead <= 0) {
          daysAhead += 7;
        }
        futureLessons.push({ lesson, daysAhead });
      } else {
        if (lesson.day === todayFormattedDate) {
          todayLessons.push(lesson);
        } else {
          futureLessons.push({ lesson, daysAhead: 1 });
        }
      }
      continue;
    }

    // Default to today if day/date is not specified
    todayLessons.push(lesson);
  }

  // 1. Check if now is within an active lesson: [start, end)
  const activeLessons = todayLessons.filter((l) => {
    const start = toMinutes(l.start_time);
    const end = l.end_time ? toMinutes(l.end_time) : start + 90;
    return time.totalMinutes >= start && time.totalMinutes < end;
  });

  if (activeLessons.length > 0) {
    const subjects = Array.from(new Set(activeLessons.map((l) => l.subject.trim()))).join(" / ");
    const startTime = activeLessons[0].start_time;
    const endTime = activeLessons[0].end_time ?? activeLessons[0].start_time;
    const text = `Сейчас: ${subjects} [${startTime}–${endTime}]`;
    return {
      type: "current",
      kind: "current",
      status: "current",
      text,
      subject: subjects,
      start_time: startTime,
      end_time: endTime,
      currentLesson: activeLessons[0] as Lesson,
    };
  }

  // 2. Check if there is an active lesson later today: start > now
  const upcomingToday = todayLessons
    .filter((l) => toMinutes(l.start_time) > time.totalMinutes)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  if (upcomingToday.length > 0) {
    const nextStart = upcomingToday[0].start_time;
    const slotLessons = upcomingToday.filter((l) => l.start_time === nextStart);
    const subjects = Array.from(new Set(slotLessons.map((l) => l.subject.trim()))).join(" / ");
    const text = `Далее: ${subjects} в ${nextStart}`;
    return {
      type: "next_today",
      kind: "next_today",
      status: "next_today",
      text,
      subject: subjects,
      start_time: nextStart,
      nextLesson: slotLessons[0] as Lesson,
    };
  }

  // 3. Check if there are future lessons
  if (futureLessons.length > 0) {
    futureLessons.sort((a, b) => {
      if (a.daysAhead !== b.daysAhead) return a.daysAhead - b.daysAhead;
      return toMinutes(a.lesson.start_time) - toMinutes(b.lesson.start_time);
    });

    const earliest = futureLessons[0];
    const slotLessons = futureLessons
      .filter((f) => f.daysAhead === earliest.daysAhead && f.lesson.start_time === earliest.lesson.start_time)
      .map((f) => f.lesson);

    const subjects = Array.from(new Set(slotLessons.map((l) => l.subject.trim()))).join(" / ");
    const startTime = earliest.lesson.start_time;

    let dateStr = earliest.lesson.date;
    if (!dateStr) {
      if (earliest.lesson.day && /^\d{2}\.\d{2}/.test(earliest.lesson.day)) {
        dateStr = earliest.lesson.day;
      } else {
        const futureDate = new Date(now.getTime() + earliest.daysAhead * 86_400_000);
        dateStr = formatChisinauDate(futureDate);
      }
    }

    const text = `Следующая пара: ${subjects} в ${dateStr} ${startTime}`;
    return {
      type: "next_future",
      kind: "next_future",
      status: "next_future",
      text,
      subject: subjects,
      start_time: startTime,
      date: dateStr,
      nextLesson: slotLessons[0] as Lesson,
    };
  }

  // 4. No lessons today and no future lessons
  return {
    type: "empty",
    kind: "empty",
    status: "empty",
    text: "Сегодня пар нет",
  };
}
