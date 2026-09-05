"use client";

import type { DayName, Lesson } from "@/lib/models";
import { classifyLessons, dayBanner, type LocalNow } from "@/lib/client/time";
import { LessonCard } from "./LessonCard";

interface DayTimelineProps {
  day: DayName;
  lessons: Lesson[];
  now: LocalNow;
  focusGroup: string | null;
  showHeading?: boolean;
}

/** Vertical timeline for one day: time on the left, cards on the right, empty slots collapsed. */
export function DayTimeline({ day, lessons, now, focusGroup, showHeading = true }: DayTimelineProps) {
  const isToday = now.day === day;
  const statuses = classifyLessons(lessons, now, day);
  const banner = dayBanner(lessons, now, day);
  const byStart = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const bucket = byStart.get(lesson.start_time) ?? [];
    bucket.push(lesson);
    byStart.set(lesson.start_time, bucket);
  }
  const starts = [...byStart.keys()].sort();

  return (
    <section aria-labelledby={`day-${day}`} className="min-w-0">
      {showHeading && (
        <header className="mb-3 flex items-center gap-2">
          <h3 id={`day-${day}`} className={`text-base font-semibold ${isToday ? "text-blue-700" : "text-slate-900"}`}>
            {day}
          </h3>
          {isToday && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">Azi</span>}
          <span className="ml-auto text-xs text-slate-500">{lessons.length ? `${lessons.length} lecții` : "liber"}</span>
        </header>
      )}
      {banner && <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{banner}</p>}
      {starts.length === 0 && !banner && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">Nicio lecție</p>}
      <ol className="space-y-4">
        {starts.map((start) => {
          const bucket = byStart.get(start) ?? [];
          const end = bucket[0]?.end_time;
          return (
            <li key={start} className="grid grid-cols-[3.25rem_1fr] gap-3 sm:grid-cols-[4.5rem_1fr]">
              <time dateTime={start} className="pt-3 font-mono text-xs leading-tight text-slate-500 sm:text-sm">
                <span className="block font-semibold text-slate-800">{start}</span>
                <span className="block">{end}</span>
              </time>
              <div className="min-w-0 space-y-2">
                {bucket.map((lesson) => (
                  <LessonCard key={lesson.id} lesson={lesson} status={statuses.get(lesson.id) ?? "upcoming"} focusGroup={focusGroup} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
