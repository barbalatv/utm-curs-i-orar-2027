"use client";

import type { TodayScheduleStatus, ScheduleLessonItem } from "@/lib/client/schedule-status";
import { getTodayScheduleStatus } from "@/lib/client/schedule-status";
import type { LocalNow, WeekParityName } from "@/lib/client/time";

export interface ScheduleStatusBlockProps {
  status?: TodayScheduleStatus;
  lessons?: ScheduleLessonItem[];
  now?: Date | string | LocalNow;
  parity?: WeekParityName;
  view?: string;
}

export function ScheduleStatusBlock({ status: propStatus, lessons, now, parity, view }: ScheduleStatusBlockProps) {
  // If view is specified and it's not "today", do not render
  if (view && view !== "today") {
    return null;
  }

  const status = propStatus ?? (lessons ? getTodayScheduleStatus(lessons, now, { parity }) : null);
  if (!status) return null;

  const badgeColors: Record<TodayScheduleStatus["type"], string> = {
    current: "border-emerald-200 bg-emerald-50 text-emerald-900",
    break: "border-blue-200 bg-blue-50 text-blue-900",
    ended: "border-slate-200 bg-slate-100 text-slate-700",
    no_lessons: "border-slate-200 bg-slate-100 text-slate-600",
  };

  const dotColors: Record<TodayScheduleStatus["type"], string> = {
    current: "bg-emerald-500",
    break: "bg-blue-500",
    ended: "bg-slate-400",
    no_lessons: "bg-slate-400",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="schedule-status-block"
      className={`mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm transition-colors ${badgeColors[status.type]}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotColors[status.type]}`} aria-hidden="true" />
      <span className="leading-snug">{status.text}</span>
    </div>
  );
}
