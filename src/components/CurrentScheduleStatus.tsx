"use client";

import { useMemo } from "react";
import type { Lesson } from "@/lib/models";
import { getScheduleStatus, type LocalNow, type ScheduleStatus, type WeekParityName } from "@/lib/client/time";

interface CurrentScheduleStatusProps {
  status?: ScheduleStatus;
  lessons?: Lesson[];
  now?: LocalNow;
  parity?: WeekParityName;
}

/**
 * Informational status block in "Azi" mode showing current schedule status
 * relative to Chișinău time (class in progress, break/next class, finished, or none today).
 */
export function CurrentScheduleStatus({
  status: explicitStatus,
  lessons = [],
  now,
  parity = "odd",
}: CurrentScheduleStatusProps) {
  const status = useMemo(() => {
    if (explicitStatus) return explicitStatus;
    if (!now) return null;
    return getScheduleStatus(lessons, now, parity);
  }, [explicitStatus, lessons, now, parity]);

  if (!status) return null;

  if (status.type === "in_progress") {
    return (
      <div
        role="status"
        data-testid="current-schedule-status"
        data-status="in_progress"
        className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-950 transition"
      >
        <div className="flex items-start gap-2.5">
          <span
            className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-100"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-semibold leading-snug text-emerald-900">{status.text}</p>
            {status.subtext && (
              <p className="mt-0.5 font-mono text-xs text-emerald-700">{status.subtext}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status.type === "break") {
    return (
      <div
        role="status"
        data-testid="current-schedule-status"
        data-status="break"
        className="mb-3 rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-950 transition"
      >
        <div className="flex items-start gap-2.5">
          <span
            className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500 ring-4 ring-blue-100"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-semibold leading-snug text-blue-900">{status.text}</p>
            {status.subtext && (
              <p className="mt-0.5 text-xs text-blue-700">{status.subtext}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="current-schedule-status"
      data-status={status.type}
      className="mb-3 rounded-xl border border-slate-200 bg-slate-100/80 px-3.5 py-2.5 text-sm text-slate-700 transition"
    >
      <p className="font-medium text-slate-800">{status.text}</p>
    </div>
  );
}
