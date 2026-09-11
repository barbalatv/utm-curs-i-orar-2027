import { describe, expect, it } from "vitest";
import { computeNowScheduleStatus, currentWeek, DEFAULT_ODD_WEEK_ANCHOR, isOtherWeek, lessonsThisWeek, type LocalNow } from "@/lib/client/time";
import type { DayName, Lesson } from "@/lib/models";

/** Noon in Chișinău, so the civil date never depends on the UTC offset of the day. */
function noon(date: string): Date {
  return new Date(`${date}T09:00:00.000Z`);
}

function lesson(week_parity: Lesson["week_parity"]): Lesson {
  return { week_parity } as Lesson;
}

function makeLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: "test-lesson-1",
    day: "Luni",
    slot_index: 0,
    slot_span: 1,
    start_time: "10:15",
    end_time: "11:45",
    groups: ["TI-251"],
    subject: "Programarea calculatoarelor",
    teacher: "Costaș A.",
    room: "3-3",
    lesson_type: "lecture",
    subgroup: null,
    week_parity: "both",
    notes: [],
    raw_text: "",
    geometry: { page: 1, x0: 0, y0: 0, x1: 0, y1: 0 },
    confidence: 1,
    uncertain: false,
    ...overrides,
  };
}

function makeNow(day: DayName | null, minutes: number): LocalNow {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return {
    day,
    minutes,
    dateLabel: "test-date",
    timeLabel: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  };
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

  it("counts only the lessons running on the week shown", () => {
    const day = [lesson("both"), lesson("odd"), lesson("even"), lesson("odd")];
    expect(lessonsThisWeek(day, "odd")).toHaveLength(3);
    expect(lessonsThisWeek(day, "even")).toHaveLength(2);
    expect(lessonsThisWeek([lesson("odd")], "even")).toHaveLength(0);
  });

  it("fades only the lessons of the opposite week", () => {
    expect(isOtherWeek(lesson("odd"), "even")).toBe(true);
    expect(isOtherWeek(lesson("even"), "even")).toBe(false);
    // A lesson held every week is never faded.
    expect(isOtherWeek(lesson("both"), "odd")).toBe(false);
    expect(isOtherWeek(lesson("unknown"), "odd")).toBe(false);
  });
});

describe("computeNowScheduleStatus", () => {
  const lesson1 = makeLesson({
    id: "l1",
    day: "Luni",
    start_time: "10:15",
    end_time: "11:45",
    subject: "Programarea calculatoarelor",
  });
  const lesson2 = makeLesson({
    id: "l2",
    day: "Luni",
    start_time: "12:00",
    end_time: "13:30",
    subject: "Matematica discretă",
  });
  const lessons = [lesson1, lesson2];

  // 1. время до первого занятия
  it("scenario 1: before first lesson returns NEXT_LESSON with minutes until start", () => {
    // 09:30 is 570 min; first lesson starts at 10:15 (615 min) -> diff = 45 min
    const status = computeNowScheduleStatus(lessons, makeNow("Luni", 570), "odd");
    expect(status).toMatchObject({
      state: "NEXT_LESSON",
      subject: "Programarea calculatoarelor",
      timeSlot: "10:15–11:45",
      minutesUntil: 45,
    });
  });

  // 2. время внутри занятия и ровно в начало занятия
  it("scenario 2: inside lesson interval [start, end) returns CURRENT_LESSON", () => {
    // Exactly at start: 10:15 (615 min)
    const atStart = computeNowScheduleStatus(lessons, makeNow("Luni", 615), "odd");
    expect(atStart).toMatchObject({
      state: "CURRENT_LESSON",
      subject: "Programarea calculatoarelor",
      timeSlot: "10:15–11:45",
    });

    // During lesson: 11:00 (660 min)
    const midLesson = computeNowScheduleStatus(lessons, makeNow("Luni", 660), "odd");
    expect(midLesson).toMatchObject({
      state: "CURRENT_LESSON",
      subject: "Programarea calculatoarelor",
      timeSlot: "10:15–11:45",
    });

    // 1 minute before end: 11:44 (704 min)
    const justBeforeEnd = computeNowScheduleStatus(lessons, makeNow("Luni", 704), "odd");
    expect(justBeforeEnd).toMatchObject({
      state: "CURRENT_LESSON",
      subject: "Programarea calculatoarelor",
      timeSlot: "10:15–11:45",
    });
  });

  // 3. перерыв между двумя занятиями и ровно в конец занятия
  it("scenario 3: break between lessons and exactly at lesson end returns NEXT_LESSON", () => {
    // Exactly at end of lesson 1: 11:45 (705 min). Lesson 2 starts at 12:00 (720 min) -> diff = 15 min
    const atEnd = computeNowScheduleStatus(lessons, makeNow("Luni", 705), "odd");
    expect(atEnd).toMatchObject({
      state: "NEXT_LESSON",
      subject: "Matematica discretă",
      timeSlot: "12:00–13:30",
      minutesUntil: 15,
    });

    // During break: 11:55 (715 min) -> diff = 5 min
    const midBreak = computeNowScheduleStatus(lessons, makeNow("Luni", 715), "odd");
    expect(midBreak).toMatchObject({
      state: "NEXT_LESSON",
      subject: "Matematica discretă",
      timeSlot: "12:00–13:30",
      minutesUntil: 5,
    });
  });

  // 4. время после последнего занятия и ровно в момент окончания
  it("scenario 4: after last lesson and exactly at its end returns AFTER_LAST", () => {
    // Exactly at end of last lesson: 13:30 (810 min)
    const atEnd = computeNowScheduleStatus(lessons, makeNow("Luni", 810), "odd");
    expect(statusMatches(atEnd, "AFTER_LAST")).toBe(true);

    // After last lesson: 15:00 (900 min)
    const afterLast = computeNowScheduleStatus(lessons, makeNow("Luni", 900), "odd");
    expect(statusMatches(afterLast, "AFTER_LAST")).toBe(true);
  });

  // 5. день без занятий
  it("scenario 5: day without lessons (weekend or empty schedule) returns NO_LESSONS_TODAY", () => {
    // Weekend (day is null)
    const weekend = computeNowScheduleStatus(lessons, makeNow(null, 600), "odd");
    expect(statusMatches(weekend, "NO_LESSONS_TODAY")).toBe(true);

    // Weekday with empty lesson list
    const emptyList = computeNowScheduleStatus([], makeNow("Luni", 600), "odd");
    expect(statusMatches(emptyList, "NO_LESSONS_TODAY")).toBe(true);

    // Weekday with lessons on other days only
    const otherDayLesson = [makeLesson({ day: "Marți" })];
    const noLessonsToday = computeNowScheduleStatus(otherDayLesson, makeNow("Luni", 600), "odd");
    expect(statusMatches(noLessonsToday, "NO_LESSONS_TODAY")).toBe(true);
  });

  // 6. занятие, относящееся только к одной parity-неделе
  it("scenario 6: parity-specific lesson runs only on its parity week", () => {
    const oddOnlyLesson = [
      makeLesson({
        id: "odd-1",
        day: "Luni",
        start_time: "10:15",
        end_time: "11:45",
        week_parity: "odd",
        subject: "Fizica",
      }),
    ];

    // On odd week at 10:30 (630 min) -> CURRENT_LESSON
    const onOddWeek = computeNowScheduleStatus(oddOnlyLesson, makeNow("Luni", 630), "odd");
    expect(onOddWeek).toMatchObject({
      state: "CURRENT_LESSON",
      subject: "Fizica",
    });

    // On even week at 10:30 (630 min) -> NO_LESSONS_TODAY
    const onEvenWeek = computeNowScheduleStatus(oddOnlyLesson, makeNow("Luni", 630), "even");
    expect(statusMatches(onEvenWeek, "NO_LESSONS_TODAY")).toBe(true);
  });
});

function statusMatches(status: ReturnType<typeof computeNowScheduleStatus>, expectedState: string): boolean {
  return status.state === expectedState;
}

