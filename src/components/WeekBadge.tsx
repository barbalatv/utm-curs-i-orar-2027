"use client";

import { WEEK_PARITY_LABEL, type WeekInfo } from "@/lib/client/time";

const PILL_STYLE: Record<WeekInfo["parity"], string> = {
  odd: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  even: "bg-sky-50 text-sky-700 ring-sky-200",
};

/** Which week is on show, and why the other week's lessons are faded. */
export function WeekBadge({ week, compact = false }: { week: WeekInfo; compact?: boolean }) {
  const parity = WEEK_PARITY_LABEL[week.parity];
  const other = WEEK_PARITY_LABEL[week.parity === "odd" ? "even" : "odd"];
  const explanation = `${week.lookingAhead ? `săptămâna ${week.number}, de luni` : `săptămâna ${week.number}`} · lecțiile din săptămâna ${other} sunt estompate`;

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" title={compact ? explanation : undefined}>
      <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PILL_STYLE[week.parity]}`}>
        Săptămâna {parity}
      </span>
      {!compact && <span className="text-xs text-slate-500">{explanation}</span>}
    </span>
  );
}
