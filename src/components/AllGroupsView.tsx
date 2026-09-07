"use client";

import { useMemo, useState } from "react";
import type { DayName, Lesson, TimeSlot } from "@/lib/models";
import { isOtherWeek, type WeekInfo } from "@/lib/client/time";
import { LessonCard } from "./LessonCard";
import { WeekBadge } from "./WeekBadge";

interface AllGroupsViewProps {
  groups: string[];
  days: DayName[];
  timeSlots: TimeSlot[];
  lessons: Lesson[];
  today: DayName | null;
  week: WeekInfo;
}

/** Desktop-only matrix: groups as columns, time slots as rows, sticky headers, horizontal scroll. */
export function AllGroupsView({ groups, days, timeSlots, lessons, today, week }: AllGroupsViewProps) {
  const [day, setDay] = useState<DayName>(today && days.includes(today) ? today : days[0]);

  const cellIndex = useMemo(() => {
    const index = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      if (lesson.day !== day) continue;
      for (const group of lesson.groups) {
        const key = `${group}|${lesson.slot_index}`;
        const bucket = index.get(key) ?? [];
        bucket.push(lesson);
        index.set(key, bucket);
      }
    }
    return index;
  }, [lessons, day]);

  return (
    // Own stacking context, so the sticky table headers scroll inside this box instead of riding
    // up over the page chrome. From md up it is also pinned under the app bar; on phones it stays
    // in flow, because there the matrix plus the status footer cannot both fit on screen.
    <section aria-label="Toate grupele" className="relative z-0 space-y-2 md:sticky md:top-14">
      <div className="-mx-4 flex items-center gap-3 bg-slate-50 px-4 py-2 sm:mx-0 sm:px-0">
        <nav aria-label="Ziua" className="flex gap-1 overflow-x-auto">
          {days.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDay(item)}
              aria-pressed={item === day}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${item === day ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}
            >
              {item}
              {item === today && <span className="ml-1 text-[10px] uppercase opacity-70">azi</span>}
            </button>
          ))}
        </nav>
        <span className="ml-auto shrink-0">
          <WeekBadge week={week} compact />
        </span>
      </div>
      {/* Short enough that the page never scrolls further than this section can stay pinned,
          otherwise the day tabs slide up under the app bar at the bottom of the page. While
          pinned, 12rem covers the app bar, the day tabs, the gap above the status footer and the
          page padding; the footer's own height comes from --status-footer-height (set in
          ScheduleApp), so it always lands below the matrix instead of on top of its last row. */}
      <div className="max-h-[calc(100dvh-15rem)] overflow-auto rounded-xl border border-slate-200 bg-white md:max-h-[calc(100dvh-12rem-var(--status-footer-height,0px))]">
        <table className="border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 min-w-[5.5rem] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-600">
                Ora
              </th>
              {groups.map((group) => (
                <th key={group} scope="col" className="sticky top-0 z-20 min-w-[11rem] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-800">
                  {group}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot) => (
              <tr key={slot.index}>
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 align-top font-mono text-[11px] font-medium text-slate-600">
                  {slot.start_time}
                  <br />
                  {slot.end_time}
                </th>
                {groups.map((group) => {
                  const cell = cellIndex.get(`${group}|${slot.index}`) ?? [];
                  return (
                    <td key={group} className="border-b border-r border-slate-100 p-1 align-top">
                      <div className="space-y-1">
                        {cell.map((lesson) => (
                          <LessonCard key={lesson.id} lesson={lesson} compact focusGroup={group} otherWeek={isOtherWeek(lesson, week.parity)} />
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
