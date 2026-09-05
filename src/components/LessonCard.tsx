"use client";

import type { Lesson } from "@/lib/models";
import { PARITY_LABEL, TYPE_LABEL, TYPE_STYLE } from "@/lib/client/labels";
import type { LessonStatus } from "@/lib/client/time";

interface LessonCardProps {
  lesson: Lesson;
  status?: LessonStatus;
  compact?: boolean;
  /** Group whose schedule is being viewed – other groups sharing the lesson are listed. */
  focusGroup?: string | null;
  showTime?: boolean;
  /** Runs on the opposite week: kept visible but faded, so this week reads at a glance. */
  otherWeek?: boolean;
}

const STATUS_STYLE: Record<LessonStatus, string> = {
  past: "opacity-60",
  current: "ring-2 ring-emerald-500 border-emerald-500 shadow-md",
  next: "ring-2 ring-blue-400 border-blue-400",
  upcoming: "",
};

export function LessonCard({ lesson, status = "upcoming", compact = false, focusGroup = null, showTime = false, otherWeek = false }: LessonCardProps) {
  const parity = PARITY_LABEL[lesson.week_parity];
  const sharedWith = lesson.groups.filter((group) => group !== focusGroup);
  const displayNotes = lesson.notes.filter((note) => !note.startsWith("Jumătatea") && !note.startsWith("Evidențiat"));

  return (
    <article
      className={`relative rounded-xl border border-slate-200 bg-white p-3 text-sm transition ${STATUS_STYLE[status]} ${compact ? "p-2.5" : "p-3.5"} ${otherWeek ? "opacity-45 grayscale" : ""}`}
      aria-label={`${lesson.subject}, ${lesson.start_time}–${lesson.end_time}${otherWeek ? `, săptămâna ${PARITY_LABEL[lesson.week_parity] ?? ""}` : ""}`}
    >
      {status === "current" && (
        <span className="absolute -top-2 left-3 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Acum</span>
      )}
      {status === "next" && (
        <span className="absolute -top-2 left-3 rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Urmează</span>
      )}
      {showTime && (
        <p className="mb-1 font-mono text-xs text-slate-500">
          {lesson.start_time} – {lesson.end_time}
        </p>
      )}
      <h4 className={`font-semibold leading-snug text-slate-900 ${compact ? "text-[13px]" : "text-[15px]"}`}>{lesson.subject}</h4>
      {lesson.teacher && <p className="mt-0.5 text-slate-600">{lesson.teacher}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {lesson.room && (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
            <span aria-hidden="true">📍</span>
            {lesson.room}
          </span>
        )}
        <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TYPE_STYLE[lesson.lesson_type]}`}>{TYPE_LABEL[lesson.lesson_type]}</span>
        {lesson.subgroup && <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-inset ring-orange-200">{lesson.subgroup}</span>}
        {parity && <span className="rounded-md bg-fuchsia-50 px-1.5 py-0.5 text-xs font-medium text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200">{parity}</span>}
        {lesson.slot_span > 1 && <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">{lesson.slot_span} intervale</span>}
      </div>
      {!compact && sharedWith.length > 0 && sharedWith.length <= 12 && (
        <p className="mt-2 text-xs text-slate-500">Împreună cu: {sharedWith.join(", ")}</p>
      )}
      {!compact && sharedWith.length > 12 && <p className="mt-2 text-xs text-slate-500">Lecție comună pentru {lesson.groups.length} grupe</p>}
      {lesson.uncertain && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800" title={lesson.raw_text}>
          Materia nu a putut fi identificată în celulă. Text din PDF: „{lesson.raw_text}”
        </p>
      )}
      {!compact && displayNotes.length > 0 && <p className="mt-1 text-xs text-slate-500">{displayNotes.join(" · ")}</p>}
    </article>
  );
}
