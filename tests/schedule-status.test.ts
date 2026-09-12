import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getScheduleStatus, type ScheduleLessonInput } from "@/utils/schedule-status";
import { ScheduleStatusBlock } from "@/components/ScheduleStatusBlock";
import React from "react";

function createLesson(overrides: Partial<ScheduleLessonInput> & { subject: string; start_time: string }): ScheduleLessonInput {
  return {
    id: "lesson-1",
    day: "Luni",
    slot_index: 0,
    slot_span: 1,
    end_time: "09:30",
    groups: ["FAF-261"],
    teacher: "Prof. Test",
    room: "3-101",
    lesson_type: "lecture",
    subgroup: null,
    week_parity: "both",
    notes: [],
    raw_text: overrides.subject,
    geometry: { page: 1, x0: 0, y0: 0, x1: 100, y1: 100 },
    confidence: 1,
    uncertain: false,
    ...overrides,
  };
}

describe("Schedule Status: getScheduleStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Monday in September 2026 (Chisinau is in EEST, UTC+3)
  // 2026-09-14 is a Monday (Luni).
  // 04:30 UTC is 07:30 in Chisinau.
  // 05:00 UTC is 08:00 in Chisinau.
  // 05:45 UTC is 08:45 in Chisinau.
  // 06:30 UTC is 09:30 in Chisinau.
  // 06:35 UTC is 09:35 in Chisinau.
  // 06:45 UTC is 09:45 in Chisinau.
  // 08:15 UTC is 11:15 in Chisinau.

  const baseLessons: ScheduleLessonInput[] = [
    createLesson({ id: "l1", subject: "Математика", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    createLesson({ id: "l2", subject: "Физика", start_time: "09:45", end_time: "11:15", day: "Luni" }),
  ];

  it("1. Scenario: time before the first lesson -> 'Далее: <Subject> в HH:MM'", () => {
    // 07:30 Chisinau (04:30 UTC)
    vi.setSystemTime(new Date("2026-09-14T04:30:00.000Z"));
    const status = getScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("next_today");
    expect(status.text).toBe("Далее: Математика в 08:00");
  });

  it("2. Scenario: exact start time of lesson -> 'Сейчас: <Subject> [HH:MM–HH:MM]'", () => {
    // 08:00 Chisinau (05:00 UTC)
    vi.setSystemTime(new Date("2026-09-14T05:00:00.000Z"));
    const status = getScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Математика [08:00–09:30]");
  });

  it("3. Scenario: time inside lesson -> 'Сейчас: <Subject> [HH:MM–HH:MM]'", () => {
    // 08:45 Chisinau (05:45 UTC)
    vi.setSystemTime(new Date("2026-09-14T05:45:00.000Z"));
    const status = getScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Математика [08:00–09:30]");
  });

  it("4. Scenario: exact end time of lesson (half-open [start, end) interval)", () => {
    // 09:30 Chisinau (06:30 UTC): Lesson 1 ends, next is Lesson 2 at 09:45
    vi.setSystemTime(new Date("2026-09-14T06:30:00.000Z"));
    const status = getScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("next_today");
    expect(status.text).toBe("Далее: Физика в 09:45");
  });

  it("4b. Scenario: back-to-back lessons (end1 === start2) transition at now === end1 without duplicate state", () => {
    const consecutiveLessons: ScheduleLessonInput[] = [
      createLesson({ id: "l1", subject: "Математика", start_time: "08:00", end_time: "09:30", day: "Luni" }),
      createLesson({ id: "l2", subject: "Физика", start_time: "09:30", end_time: "11:00", day: "Luni" }),
    ];
    // Exactly at 09:30 (06:30 UTC): Lesson 1 is ended, Lesson 2 is current
    vi.setSystemTime(new Date("2026-09-14T06:30:00.000Z"));
    const status = getScheduleStatus(consecutiveLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Физика [09:30–11:00]");
  });

  it("5. Scenario: break between two lessons -> 'Далее: <Subject> в HH:MM'", () => {
    // 09:35 Chisinau (06:35 UTC)
    vi.setSystemTime(new Date("2026-09-14T06:35:00.000Z"));
    const status = getScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("next_today");
    expect(status.text).toBe("Далее: Физика в 09:45");
  });

  it("6. Scenario: time after the last lesson today (with future lessons on subsequent days)", () => {
    const lessonsWithFuture: ScheduleLessonInput[] = [
      ...baseLessons,
      createLesson({ id: "l3", subject: "Программирование", start_time: "08:00", end_time: "09:30", day: "Marți" }),
    ];
    // 11:15 Chisinau (08:15 UTC) on Monday: Monday lessons are done, next is Tuesday
    vi.setSystemTime(new Date("2026-09-14T08:15:00.000Z"));
    const status = getScheduleStatus(lessonsWithFuture, new Date());
    expect(status.type).toBe("next_future");
    expect(status.text).toBe("Следующая пара: Программирование в 15.09 08:00");
  });

  it("6b. Scenario: time after the last lesson today (no more lessons this week)", () => {
    // 11:15 Chisinau (08:15 UTC): no future lessons in list
    vi.setSystemTime(new Date("2026-09-14T08:15:00.000Z"));
    const status = getScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("empty");
    expect(status.text).toBe("Сегодня пар нет");
  });

  it("7. Scenario: day without lessons (empty array) -> 'Сегодня пар нет'", () => {
    vi.setSystemTime(new Date("2026-09-14T08:00:00.000Z"));
    const status = getScheduleStatus([], new Date());
    expect(status.type).toBe("empty");
    expect(status.text).toBe("Сегодня пар нет");
  });

  it("8. Scenario: inactive week parity modeled as empty array -> 'Сегодня пар нет'", () => {
    // Parent component filters parity before calling getScheduleStatus; inactive week yields []
    vi.setSystemTime(new Date("2026-09-14T08:00:00.000Z"));
    const activeThisWeek: ScheduleLessonInput[] = [];
    const status = getScheduleStatus(activeThisWeek, new Date());
    expect(status.type).toBe("empty");
    expect(status.text).toBe("Сегодня пар нет");
  });

  it("9. Scenario: subgroups in the same time slot aggregated as 'Subj1 / Subj2'", () => {
    const subgroupLessons: ScheduleLessonInput[] = [
      createLesson({ id: "sg1", subject: "Английский", subgroup: "1", start_time: "08:00", end_time: "09:30", day: "Luni" }),
      createLesson({ id: "sg2", subject: "Французский", subgroup: "2", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    // 08:15 Chisinau (05:15 UTC)
    vi.setSystemTime(new Date("2026-09-14T05:15:00.000Z"));
    const status = getScheduleStatus(subgroupLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Английский / Французский [08:00–09:30]");

    // Also test same subject for both subgroups does not duplicate
    const sameSubjLessons: ScheduleLessonInput[] = [
      createLesson({ id: "sg3", subject: "Информатика", subgroup: "1", start_time: "08:00", end_time: "09:30", day: "Luni" }),
      createLesson({ id: "sg4", subject: "Информатика", subgroup: "2", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    const statusSame = getScheduleStatus(sameSubjLessons, new Date());
    expect(statusSame.text).toBe("Сейчас: Информатика [08:00–09:30]");
  });

  it("10. Scenario: DST handling in Europe/Chisinau (winter EET vs summer EEST)", () => {
    // Winter EET is UTC+2. 06:00 UTC = 08:00 in Chisinau.
    // 2026-01-19 is a Monday in winter.
    vi.setSystemTime(new Date("2026-01-19T06:00:00.000Z"));
    const winterLesson = [
      createLesson({ id: "w1", subject: "Химия", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    const winterStatus = getScheduleStatus(winterLesson, new Date());
    expect(winterStatus.type).toBe("current");
    expect(winterStatus.text).toBe("Сейчас: Химия [08:00–09:30]");

    // Summer EEST is UTC+3. 05:00 UTC = 08:00 in Chisinau.
    // 2026-06-15 is a Monday in summer.
    vi.setSystemTime(new Date("2026-06-15T05:00:00.000Z"));
    const summerLesson = [
      createLesson({ id: "s1", subject: "Биология", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    const summerStatus = getScheduleStatus(summerLesson, new Date());
    expect(summerStatus.type).toBe("current");
    expect(summerStatus.text).toBe("Сейчас: Биология [08:00–09:30]");
  });
});

describe("ScheduleStatusBlock component", () => {
  it("renders null when view !== 'week'", () => {
    const elementToday = ScheduleStatusBlock({ view: "today", lessons: [] });
    expect(elementToday).toBeNull();

    const elementAll = ScheduleStatusBlock({ view: "all", lessons: [] });
    expect(elementAll).toBeNull();
  });

  it("renders status block when view === 'week'", () => {
    const element = ScheduleStatusBlock({
      view: "week",
      status: {
        type: "current",
        kind: "current",
        status: "current",
        text: "Сейчас: Математика [08:00–09:30]",
      },
    });
    expect(element).not.toBeNull();
    expect(element?.props["role"]).toBe("status");
    expect(element?.props["children"]).toBeDefined();
  });
});
