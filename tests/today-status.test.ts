import { describe, expect, it } from "vitest";
import { computeTodayStatus, toMinutes } from "@/lib/client/time";
import type { Lesson } from "@/lib/models";

function mockLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: "lesson-1",
    day: "Luni",
    slot_index: 0,
    slot_span: 1,
    start_time: "08:00",
    end_time: "09:30",
    groups: ["SI-261"],
    subject: "Programarea calculatoarelor",
    teacher: "Profesor",
    room: "3-101",
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

describe("computeTodayStatus", () => {
  const lesson1 = mockLesson({
    id: "l1",
    start_time: "08:00",
    end_time: "09:30",
    subject: "Programarea calculatoarelor",
  });
  const lesson2 = mockLesson({
    id: "l2",
    start_time: "09:45",
    end_time: "11:15",
    subject: "Matematica discretă",
  });
  const lessons = [lesson1, lesson2];

  it("returns 'next' state before the first lesson with correct countdown", () => {
    // 07:45 (15 min before 08:00)
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("07:45") },
      parity: "odd",
    });
    expect(status).toEqual({
      kind: "next",
      subject: "Programarea calculatoarelor",
      startTime: "08:00",
      endTime: "09:30",
      minutesUntil: 15,
      lessons: [lesson1],
    });
  });

  it("returns 'next' state 1 minute before start_time", () => {
    // 07:59
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("07:59") },
      parity: "odd",
    });
    expect(status).toMatchObject({
      kind: "next",
      subject: "Programarea calculatoarelor",
      startTime: "08:00",
      minutesUntil: 1,
    });
  });

  it("returns 'current' state exactly at start_time", () => {
    // 08:00
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("08:00") },
      parity: "odd",
    });
    expect(status).toEqual({
      kind: "current",
      subject: "Programarea calculatoarelor",
      startTime: "08:00",
      endTime: "09:30",
      lessons: [lesson1],
    });
  });

  it("returns 'current' state in the middle of a lesson", () => {
    // 08:45
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("08:45") },
      parity: "odd",
    });
    expect(status).toMatchObject({
      kind: "current",
      subject: "Programarea calculatoarelor",
      startTime: "08:00",
      endTime: "09:30",
    });
  });

  it("returns 'current' state 1 minute before end_time", () => {
    // 09:29
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("09:29") },
      parity: "odd",
    });
    expect(status).toMatchObject({
      kind: "current",
      subject: "Programarea calculatoarelor",
      startTime: "08:00",
      endTime: "09:30",
    });
  });

  it("returns 'next' state during break exactly at previous end_time", () => {
    // 09:30 -> lesson1 finished, next is lesson2 at 09:45 (15 min away)
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("09:30") },
      parity: "odd",
    });
    expect(status).toEqual({
      kind: "next",
      subject: "Matematica discretă",
      startTime: "09:45",
      endTime: "11:15",
      minutesUntil: 15,
      lessons: [lesson2],
    });
  });

  it("returns 'next' state in the middle of a break", () => {
    // 09:35 -> 10 minutes until 09:45
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("09:35") },
      parity: "odd",
    });
    expect(status).toMatchObject({
      kind: "next",
      subject: "Matematica discretă",
      startTime: "09:45",
      minutesUntil: 10,
    });
  });

  it("returns 'finished' state exactly at end_time of the last lesson", () => {
    // 11:15 -> lesson2 finishes
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("11:15") },
      parity: "odd",
    });
    expect(status).toEqual({ kind: "finished" });
  });

  it("returns 'finished' state after the last lesson ends", () => {
    // 15:00
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: "Luni", minutes: toMinutes("15:00") },
      parity: "odd",
    });
    expect(status).toEqual({ kind: "finished" });
  });

  it("returns 'no_lessons' on weekends (now.day is null)", () => {
    const status = computeTodayStatus({
      todayLessons: lessons,
      now: { day: null, minutes: toMinutes("10:00") },
      parity: "odd",
    });
    expect(status).toEqual({ kind: "no_lessons" });
  });

  it("returns 'no_lessons' when 0 lessons are scheduled for today", () => {
    const status = computeTodayStatus({
      todayLessons: [],
      now: { day: "Vineri", minutes: toMinutes("10:00") },
      parity: "odd",
    });
    expect(status).toEqual({ kind: "no_lessons" });
  });

  it("filters out opposite parity week lessons", () => {
    const oddLesson = mockLesson({
      id: "odd-1",
      subject: "Laborator POO",
      week_parity: "odd",
      start_time: "08:00",
      end_time: "09:30",
    });
    const evenLesson = mockLesson({
      id: "even-1",
      subject: "Laborator BD",
      week_parity: "even",
      start_time: "08:00",
      end_time: "09:30",
    });

    // When parity is odd, evenLesson is ignored
    const statusOdd = computeTodayStatus({
      todayLessons: [oddLesson, evenLesson],
      now: { day: "Luni", minutes: toMinutes("08:15") },
      parity: "odd",
    });
    expect(statusOdd).toMatchObject({
      kind: "current",
      subject: "Laborator POO",
    });

    // When parity is even, oddLesson is ignored
    const statusEven = computeTodayStatus({
      todayLessons: [oddLesson, evenLesson],
      now: { day: "Luni", minutes: toMinutes("08:15") },
      parity: "even",
    });
    expect(statusEven).toMatchObject({
      kind: "current",
      subject: "Laborator BD",
    });

    // If today only has an even lesson but we are on odd week -> no_lessons
    const statusNone = computeTodayStatus({
      todayLessons: [evenLesson],
      now: { day: "Luni", minutes: toMinutes("08:15") },
      parity: "odd",
    });
    expect(statusNone).toEqual({ kind: "no_lessons" });
  });

  it("handles multiple subgroup lessons starting at the same time", () => {
    const sub1 = mockLesson({
      id: "s1",
      subject: "Structuri de date",
      subgroup: "gr. 1",
      start_time: "08:00",
      end_time: "09:30",
    });
    const sub2 = mockLesson({
      id: "s2",
      subject: "Structuri de date",
      subgroup: "gr. 2",
      start_time: "08:00",
      end_time: "09:30",
    });

    // Same subject deduplicated
    const status = computeTodayStatus({
      todayLessons: [sub1, sub2],
      now: { day: "Luni", minutes: toMinutes("08:10") },
      parity: "odd",
    });
    expect(status).toMatchObject({
      kind: "current",
      subject: "Structuri de date",
      startTime: "08:00",
      endTime: "09:30",
    });
    expect((status as any).lessons).toHaveLength(2);

    // Different subjects joined with " / "
    const sub3 = mockLesson({
      id: "s3",
      subject: "Arhitectura calculatoarelor",
      subgroup: "gr. 2",
      start_time: "08:00",
      end_time: "09:30",
    });
    const statusSplit = computeTodayStatus({
      todayLessons: [sub1, sub3],
      now: { day: "Luni", minutes: toMinutes("08:10") },
      parity: "odd",
    });
    expect(statusSplit).toMatchObject({
      kind: "current",
      subject: "Structuri de date / Arhitectura calculatoarelor",
      startTime: "08:00",
      endTime: "09:30",
    });
  });
});
