"use client";

import type { TodayStatusResult } from "@/lib/client/time";

interface TodayStatusCardProps {
  status: TodayStatusResult;
}

export function TodayStatusCard({ status }: TodayStatusCardProps) {
  return (
    <aside
      aria-label="Статус занятий на сегодня"
      className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      {status.kind === "current" && (
        <div className="space-y-1">
          <p className="text-base font-semibold text-slate-900">
            Сейчас: {status.subject}
          </p>
          <p className="font-mono text-sm text-slate-500">
            {status.startTime}–{status.endTime}
          </p>
        </div>
      )}

      {status.kind === "next" && (
        <div className="space-y-1">
          <p className="text-base font-semibold text-slate-900">
            Следующее: {status.subject}
          </p>
          <p className="font-mono text-sm text-slate-500">
            через {status.minutesUntil} мин · {status.startTime}–{status.endTime}
          </p>
        </div>
      )}

      {status.kind === "finished" && (
        <p className="text-sm font-medium text-slate-700">
          На сегодня занятий больше нет
        </p>
      )}

      {status.kind === "no_lessons" && (
        <p className="text-sm font-medium text-slate-700">
          Сегодня занятий нет
        </p>
      )}
    </aside>
  );
}
