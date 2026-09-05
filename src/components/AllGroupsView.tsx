"use client";

import { useMemo, useState } from "react";
import type { DayName, Lesson, TimeSlot } from "@/lib/models";
import { LessonCard } from "./LessonCard";

interface AllGroupsViewProps {
  groups: string[];
  days: DayName[];
  timeSlots: TimeSlot[];
  lessons: Lesson[];
  today: DayName | null;
}

/** Desktop-only matrix: groups as columns, time slots as rows, sticky headers, horizontal scroll. */
export function AllGroupsView({ groups, days, timeSlots, lessons, today }: AllGroupsViewProps) {
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
    <section aria-label="Toate grupele" className="space-y-3">
      <nav aria-label="Ziua" className="sticky top-[3.5rem] z-20 -mx-4 flex gap-1 overflow-x-auto bg-slate-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        {days.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setDay(item)}
            aria-pressed={item === day}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${item === day ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}
          >
            {item}
            {item === today && <span className="ml-1 text-[10px] uppercase opacity-70">azi</span>}
          </button>
        ))}
      </nav>
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white" style={{ maxHeight: "calc(100vh - 12rem)" }}>
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
                          <LessonCard key={lesson.id} lesson={lesson} compact focusGroup={group} />
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
