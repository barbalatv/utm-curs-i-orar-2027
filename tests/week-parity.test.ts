import { describe, expect, it } from "vitest";
import { currentWeek, DEFAULT_ODD_WEEK_ANCHOR, isOtherWeek } from "@/lib/client/time";
import type { Lesson } from "@/lib/models";

/** Noon in Chișinău, so the civil date never depends on the UTC offset of the day. */
function noon(date: string): Date {
  return new Date(`${date}T09:00:00.000Z`);
}

function lesson(week_parity: Lesson["week_parity"]): Lesson {
  return { week_parity } as Lesson;
}

describe("test_week_parity", () => {
  it("counts semester weeks from the anchor Monday", () => {
    // 31 August 2026 is the Monday that opens the autumn semester: week 1, odd.
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-08-31"))).toMatchObject({ number: 1, parity: "odd" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-01"))).toMatchObject({ number: 1, parity: "odd" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-04"))).toMatchObject({ number: 1, parity: "odd" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-07"))).toMatchObject({ number: 2, parity: "even" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-11"))).toMatchObject({ number: 2, parity: "even" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-14"))).toMatchObject({ number: 3, parity: "odd" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-12-21"))).toMatchObject({ number: 17, parity: "odd" });
  });

  it("shows the week ahead on Saturday and Sunday", () => {
    // The teaching week is over; what matters on the weekend is the Monday coming up.
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-05"))).toMatchObject({ number: 2, parity: "even", lookingAhead: true });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-06"))).toMatchObject({ number: 2, parity: "even", lookingAhead: true });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-12"))).toMatchObject({ number: 3, parity: "odd", lookingAhead: true });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-13"))).toMatchObject({ number: 3, parity: "odd", lookingAhead: true });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-10")).lookingAhead).toBe(false);
  });

  it("keeps working before the anchor and around midnight in Chișinău", () => {
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-08-24"))).toMatchObject({ number: 0, parity: "even" });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-08-17"))).toMatchObject({ number: -1, parity: "odd" });
    // 22:30 UTC on Sunday is already Monday 01:30 in Chișinău (UTC+3 in September).
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, new Date("2026-09-06T22:30:00.000Z"))).toMatchObject({ number: 2, lookingAhead: false });
    expect(currentWeek(DEFAULT_ODD_WEEK_ANCHOR, new Date("2026-09-06T20:30:00.000Z"))).toMatchObject({ number: 2, lookingAhead: true });
  });

  it("falls back to the built-in anchor for a missing or malformed one", () => {
    const expected = currentWeek(DEFAULT_ODD_WEEK_ANCHOR, noon("2026-09-09"));
    expect(currentWeek(undefined, noon("2026-09-09"))).toEqual(expected);
    expect(currentWeek("not-a-date", noon("2026-09-09"))).toEqual(expected);
    // An anchor given mid-week still identifies its Monday.
    expect(currentWeek("2026-09-02", noon("2026-09-09"))).toMatchObject({ number: 2, parity: "even" });
  });

  it("fades only the lessons of the opposite week", () => {
    expect(isOtherWeek(lesson("odd"), "even")).toBe(true);
    expect(isOtherWeek(lesson("even"), "even")).toBe(false);
    // A lesson held every week is never faded.
    expect(isOtherWeek(lesson("both"), "odd")).toBe(false);
    expect(isOtherWeek(lesson("unknown"), "odd")).toBe(false);
  });
});
