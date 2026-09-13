"use client";

import type { AziScheduleStatus } from "@/lib/client/time";

interface AziStatusCardProps {
  status: AziScheduleStatus;
}

export function AziStatusCard({ status }: AziStatusCardProps) {
  if (status.state === "no_lessons") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 shadow-sm"
      >
        <p className="font-semibold text-slate-800">Astăzi nu sunt ore</p>
      </div>
    );
  }

  if (status.state === "finished") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 shadow-sm"
      >
        <p className="font-semibold text-slate-800">Pentru azi nu mai sunt ore</p>
      </div>
    );
  }

  if (status.state === "current") {
    const subjects = [...new Set(status.lessons.map((lesson) => lesson.subject))];
    const startTime = status.lessons[0].start_time;
    const endTime = status.lessons[status.lessons.length - 1].end_time;

    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50/70 p-3.5 text-sm text-emerald-950 shadow-sm"
      >
        <p className="font-semibold text-emerald-900">
          Acum:{subjects.length === 1 ? ` ${subjects[0]}` : ""}
        </p>
        {subjects.length > 1 && (
          <ul className="mt-0.5 space-y-0.5 pl-2 font-semibold text-emerald-950">
            {subjects.map((subject) => (
              <li key={subject}>{subject}</li>
            ))}
          </ul>
        )}
        <p className="mt-1 font-mono text-xs font-medium text-emerald-700">
          {startTime}–{endTime}
        </p>
      </div>
    );
  }

  if (status.state === "next") {
    const subjects = [...new Set(status.lessons.map((lesson) => lesson.subject))];
    const startTime = status.lessons[0].start_time;
    const endTime = status.lessons[status.lessons.length - 1].end_time;

    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-3 rounded-xl border border-blue-300 bg-blue-50/70 p-3.5 text-sm text-blue-950 shadow-sm"
      >
        <p className="font-semibold text-blue-900">
          Urmează:{subjects.length === 1 ? ` ${subjects[0]}` : ""}
        </p>
        {subjects.length > 1 && (
          <ul className="mt-0.5 space-y-0.5 pl-2 font-semibold text-blue-950">
            {subjects.map((subject) => (
              <li key={subject}>{subject}</li>
            ))}
          </ul>
        )}
        <p className="mt-1 font-mono text-xs font-medium text-blue-700">
          peste {status.minutesUntil} min · {startTime}–{endTime}
        </p>
      </div>
    );
  }

  return null;
}
