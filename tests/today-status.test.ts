import { describe, expect, it } from "vitest";
import { getTodayStatus, toMinutes, type LocalNow } from "@/lib/client/time";
import type { DayName, Lesson } from "@/lib/models";

function createLesson(id: string, start_time: string, end_time: string, subject = "Matematica"): Lesson {
  return {
    id,
    day: "Luni",
    slot_index: 0,
    slot_span: 1,
    start_time,
    end_time,
    groups: ["FAF-241"],
    subject,
    teacher: "Prof. Popescu",
    room: "3-101",
    lesson_type: "lecture",
    subgroup: null,
    week_parity: "both",
    notes: [],
    raw_text: "",
    geometry: { page: 1, x0: 0, y0: 0, x1: 100, y1: 100 },
    confidence: 1,
    uncertain: false,
  };
}

function createNow(day: DayName, time: string): LocalNow {
  return {
    day,
    minutes: toMinutes(time),
    dateLabel: "luni, 1 septembrie",
    timeLabel: time,
  };
}

describe("getTodayStatus", () => {
  const lesson1 = createLesson("1", "08:00", "09:30", "Matematica");
  const lesson2 = createLesson("2", "09:45", "11:15", "Fizica");
  const lessons = [lesson1, lesson2];

  it("returns 'next' before the first lesson", () => {
    const now = createNow("Luni", "07:30");
    const status = getTodayStatus(lessons, now, "Luni");

    expect(status.type).toBe("next");
    expect(status.lesson).toEqual(lesson1);
    expect(status.minutesUntil).toBe(30);
  });

  it("returns 'current' during a lesson", () => {
    // Exactly at start time 08:00
    const nowStart = createNow("Luni", "08:00");
    const statusStart = getTodayStatus(lessons, nowStart, "Luni");
    expect(statusStart.type).toBe("current");
    expect(statusStart.lesson).toEqual(lesson1);

    // Inside lesson at 08:45
    const nowMid = createNow("Luni", "08:45");
    const statusMid = getTodayStatus(lessons, nowMid, "Luni");
    expect(statusMid.type).toBe("current");
    expect(statusMid.lesson).toEqual(lesson1);

    // Right before end time (09:29)
    const nowEndMinus1 = createNow("Luni", "09:29");
    const statusEndMinus1 = getTodayStatus(lessons, nowEndMinus1, "Luni");
    expect(statusEndMinus1.type).toBe("current");
    expect(statusEndMinus1.lesson).toEqual(lesson1);
  });

  it("returns 'next' during the break between two lessons with correct minutesUntil", () => {
    // Exactly at 09:30 lesson1 ends (boundary rule: becomes past)
    const nowBreakStart = createNow("Luni", "09:30");
    const statusBreakStart = getTodayStatus(lessons, nowBreakStart, "Luni");
    expect(statusBreakStart.type).toBe("next");
    expect(statusBreakStart.lesson).toEqual(lesson2);
    expect(statusBreakStart.minutesUntil).toBe(15); // 09:45 - 09:30 = 15 min

    // At 09:40 in the break
    const nowMidBreak = createNow("Luni", "09:40");
    const statusMidBreak = getTodayStatus(lessons, nowMidBreak, "Luni");
    expect(statusMidBreak.type).toBe("next");
    expect(statusMidBreak.lesson).toEqual(lesson2);
    expect(statusMidBreak.minutesUntil).toBe(5);
  });

  it("returns 'finished' after the last lesson has ended", () => {
    // Exactly at 11:15 lesson2 ends
    const nowEnd = createNow("Luni", "11:15");
    const statusEnd = getTodayStatus(lessons, nowEnd, "Luni");
    expect(statusEnd.type).toBe("finished");
    expect(statusEnd.lesson).toBeUndefined();

    // Later in the evening
    const nowEvening = createNow("Luni", "18:00");
    const statusEvening = getTodayStatus(lessons, nowEvening, "Luni");
    expect(statusEvening.type).toBe("finished");
  });

  it("returns 'none' when there are no lessons for the day", () => {
    const now = createNow("Luni", "10:00");
    const status = getTodayStatus([], now, "Luni");
    expect(status.type).toBe("none");
    expect(status.lesson).toBeUndefined();
  });

  it("returns 'none' when opposite parity lessons are filtered out before getTodayStatus", () => {
    // Demonstrating the contract where filtered lessons is empty
    const now = createNow("Luni", "10:00");
    const filteredLessons: Lesson[] = [];
    const status = getTodayStatus(filteredLessons, now, "Luni");
    expect(status.type).toBe("none");
  });

  it("returns 'none' if now.day does not match the day", () => {
    const now = createNow("Marți", "08:30");
    const status = getTodayStatus(lessons, now, "Luni");
    expect(status.type).toBe("none");
  });
});
