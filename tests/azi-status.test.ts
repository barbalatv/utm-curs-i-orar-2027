import { describe, expect, it } from "vitest";
import { getAziScheduleStatus, lessonsThisWeek, type LocalNow } from "@/lib/client/time";
import type { Lesson } from "@/lib/models";

function mockNow(time: string): LocalNow {
  const [h, m] = time.split(":").map(Number);
  return {
    day: "Luni",
    minutes: h * 60 + m,
    dateLabel: "Luni, 1 septembrie",
    timeLabel: time,
  };
}

function makeLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: overrides.id ?? "test-id",
    day: overrides.day ?? "Luni",
    slot_index: overrides.slot_index ?? 0,
    slot_span: overrides.slot_span ?? 1,
    start_time: overrides.start_time ?? "08:00",
    end_time: overrides.end_time ?? "09:30",
    groups: overrides.groups ?? ["SI-261"],
    subject: overrides.subject ?? "Matematică",
    teacher: overrides.teacher ?? "Profesor Test",
    room: overrides.room ?? "101",
    lesson_type: overrides.lesson_type ?? "lecture",
    subgroup: overrides.subgroup ?? null,
    week_parity: overrides.week_parity ?? "both",
    notes: overrides.notes ?? [],
    raw_text: overrides.raw_text ?? "Test raw",
    geometry: overrides.geometry ?? { page: 1, x0: 0, y0: 0, x1: 100, y1: 100 },
    confidence: overrides.confidence ?? 1,
    uncertain: overrides.uncertain ?? false,
  };
}

describe("getAziScheduleStatus", () => {
  it("1. returns no_lessons for an empty list", () => {
    expect(getAziScheduleStatus([], mockNow("08:00"))).toEqual({
      state: "no_lessons",
    });
  });

  it("2. returns next before the first lesson with correct minutesUntil", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const status = getAziScheduleStatus([l1], mockNow("07:30"));
    expect(status).toEqual({
      state: "next",
      lessons: [l1],
      minutesUntil: 30,
    });
  });

  it("3. returns current exactly at start_time", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const status = getAziScheduleStatus([l1], mockNow("08:00"));
    expect(status).toEqual({
      state: "current",
      lessons: [l1],
    });
  });

  it("4. returns current inside the lesson time", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const status = getAziScheduleStatus([l1], mockNow("08:45"));
    expect(status).toEqual({
      state: "current",
      lessons: [l1],
    });
  });

  it("5. does not consider lesson current exactly at end_time", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const l2 = makeLesson({ id: "l2", start_time: "09:45", end_time: "11:15" });
    const status = getAziScheduleStatus([l1, l2], mockNow("09:30"));
    expect(status.state).toBe("next");
    if (status.state === "next") {
      expect(status.lessons).toEqual([l2]);
      expect(status.minutesUntil).toBe(15);
    }
  });

  it("6. returns next during a break with correct minutesUntil", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const l2 = makeLesson({ id: "l2", start_time: "09:45", end_time: "11:15" });
    const status = getAziScheduleStatus([l1, l2], mockNow("09:35"));
    expect(status).toEqual({
      state: "next",
      lessons: [l2],
      minutesUntil: 10,
    });
  });

  it("7. returns finished exactly at the end of the last lesson", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const status = getAziScheduleStatus([l1], mockNow("09:30"));
    expect(status).toEqual({
      state: "finished",
    });
  });

  it("8. returns finished after the last lesson of the day", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const status = getAziScheduleStatus([l1], mockNow("15:00"));
    expect(status).toEqual({
      state: "finished",
    });
  });

  it("9. handles unsorted input without mutating array and selects earliest future lesson", () => {
    const l1 = makeLesson({ id: "l1", start_time: "08:00", end_time: "09:30" });
    const l2 = makeLesson({ id: "l2", start_time: "13:30", end_time: "15:00" });
    const l3 = makeLesson({ id: "l3", start_time: "15:15", end_time: "16:45" });
    const unsorted = [l3, l1, l2];
    const originalFirst = unsorted[0];

    const status = getAziScheduleStatus(unsorted, mockNow("10:00"));
    expect(status).toEqual({
      state: "next",
      lessons: [l2],
      minutesUntil: 210,
    });
    expect(unsorted[0]).toBe(originalFirst);
  });

  it("10. returns all concurrent lessons in current when multiple lessons share the slot", () => {
    const l1 = makeLesson({ id: "eng1", subject: "English 1", start_time: "08:00", end_time: "09:30", subgroup: "gr. 1" });
    const l2 = makeLesson({ id: "eng2", subject: "English 2", start_time: "08:00", end_time: "09:30", subgroup: "gr. 2" });
    const status = getAziScheduleStatus([l1, l2], mockNow("08:30"));
    expect(status).toEqual({
      state: "current",
      lessons: [l1, l2],
    });
  });

  it("11. returns all future parallel lessons starting at earliest future start in next", () => {
    const l1 = makeLesson({ id: "eng1", subject: "English 1", start_time: "13:30", end_time: "15:00", subgroup: "gr. 1" });
    const l2 = makeLesson({ id: "eng2", subject: "English 2", start_time: "13:30", end_time: "15:00", subgroup: "gr. 2" });
    const l3 = makeLesson({ id: "math", subject: "Math", start_time: "15:15", end_time: "16:45" });
    const status = getAziScheduleStatus([l3, l1, l2], mockNow("12:00"));
    expect(status).toEqual({
      state: "next",
      lessons: [l1, l2],
      minutesUntil: 90,
    });
  });

  it("12. correctly handles lessons spanning multiple slots (slot_span > 1)", () => {
    const lab = makeLesson({ id: "lab", slot_index: 3, slot_span: 2, start_time: "13:30", end_time: "16:45" });
    expect(getAziScheduleStatus([lab], mockNow("13:29"))).toEqual({
      state: "next",
      lessons: [lab],
      minutesUntil: 1,
    });
    expect(getAziScheduleStatus([lab], mockNow("13:30"))).toEqual({
      state: "current",
      lessons: [lab],
    });
    expect(getAziScheduleStatus([lab], mockNow("16:44"))).toEqual({
      state: "current",
      lessons: [lab],
    });
    expect(getAziScheduleStatus([lab], mockNow("16:45"))).toEqual({
      state: "finished",
    });
  });

  it("13. seamlessly integrates with existing lessonsThisWeek parity filter", () => {
    const oddLesson = makeLesson({ id: "odd", subject: "Physics", start_time: "08:00", end_time: "09:30", week_parity: "odd" });
    const evenLesson = makeLesson({ id: "even", subject: "Math", start_time: "08:00", end_time: "09:30", week_parity: "even" });
    const allDayLessons = [oddLesson, evenLesson];

    // During odd week, only oddLesson is active:
    const runningOdd = lessonsThisWeek(allDayLessons, "odd");
    const statusOdd = getAziScheduleStatus(runningOdd, mockNow("08:15"));
    expect(statusOdd).toEqual({
      state: "current",
      lessons: [oddLesson],
    });

    // During even week, only evenLesson is active:
    const runningEven = lessonsThisWeek(allDayLessons, "even");
    const statusEven = getAziScheduleStatus(runningEven, mockNow("08:15"));
    expect(statusEven).toEqual({
      state: "current",
      lessons: [evenLesson],
    });
  });
});
