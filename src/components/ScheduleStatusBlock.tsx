"use client";

import {
  getScheduleStatus,
  type ScheduleLessonInput,
  type ScheduleStatus,
  type ScheduleStatusType,
} from "@/utils/schedule-status";

export interface ScheduleStatusBlockProps {
  lessons?: ScheduleLessonInput[];
  now?: Date;
  view?: string;
  status?: ScheduleStatus;
  className?: string;
}

const STATUS_THEME: Record<ScheduleStatusType, { container: string; dot: string }> = {
  current: {
    container: "border-emerald-200 bg-emerald-50/80 text-emerald-950",
    dot: "bg-emerald-500 animate-pulse",
  },
  next_today: {
    container: "border-blue-200 bg-blue-50/80 text-blue-950",
    dot: "bg-blue-500",
  },
  next_future: {
    container: "border-indigo-200 bg-indigo-50/80 text-indigo-950",
    dot: "bg-indigo-500",
  },
  empty: {
    container: "border-slate-200 bg-slate-100/80 text-slate-700",
    dot: "bg-slate-400",
  },
};

export function ScheduleStatusBlock({
  lessons = [],
  now,
  view = "week",
  status: propStatus,
  className = "",
}: ScheduleStatusBlockProps) {
  // Requirement: block is hidden when view !== "week"
  if (view !== "week") {
    return null;
  }

  const currentStatus = propStatus ?? getScheduleStatus(lessons, now ?? new Date());
  const theme = STATUS_THEME[currentStatus.type] ?? STATUS_THEME.empty;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="schedule-status-block"
      className={`mb-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm transition ${theme.container} ${className}`}
    >
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${theme.dot}`} aria-hidden="true" />
      <span className="truncate">{currentStatus.text}</span>
    </div>
  );
}
