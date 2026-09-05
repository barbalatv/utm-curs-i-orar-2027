import type { LessonType, WeekParity } from "@/lib/models";

export const TYPE_LABEL: Record<LessonType, string> = {
  lecture: "Curs",
  lab: "Laborator",
  seminar: "Seminar",
  practice: "Practică",
  physical_education: "Educație fizică",
  language: "Limbă străină",
  project: "Proiect",
  unknown: "Tip nespecificat",
};

export const TYPE_STYLE: Record<LessonType, string> = {
  lecture: "bg-blue-50 text-blue-700 ring-blue-200",
  lab: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  seminar: "bg-amber-50 text-amber-700 ring-amber-200",
  practice: "bg-teal-50 text-teal-700 ring-teal-200",
  physical_education: "bg-rose-50 text-rose-700 ring-rose-200",
  language: "bg-violet-50 text-violet-700 ring-violet-200",
  project: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200",
};

export const PARITY_LABEL: Record<WeekParity, string | null> = {
  odd: "Săpt. impară",
  even: "Săpt. pară",
  both: null,
  unknown: null,
};
