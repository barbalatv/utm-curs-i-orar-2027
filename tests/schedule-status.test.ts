import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTodayScheduleStatus, type ScheduleLessonItem } from "@/lib/client/schedule-status";
import { ScheduleStatusBlock } from "@/components/ScheduleStatusBlock";
import type { DayName, Lesson } from "@/lib/models";

function createLesson(partial: Partial<Lesson> & { subject: string; start_time: string; end_time: string }): Lesson {
  return {
    id: partial.id ?? `lesson-${Math.random().toString(36).slice(2, 9)}`,
    day: partial.day ?? ("Luni" as DayName),
    slot_index: partial.slot_index ?? 0,
    slot_span: partial.slot_span ?? 1,
    start_time: partial.start_time,
    end_time: partial.end_time,
    groups: partial.groups ?? ["SI-261"],
    subject: partial.subject,
    teacher: partial.teacher ?? "Profesor Test",
    room: partial.room ?? "3-101",
    lesson_type: partial.lesson_type ?? "lecture",
    subgroup: partial.subgroup ?? null,
    week_parity: partial.week_parity ?? "both",
    notes: partial.notes ?? [],
    raw_text: partial.raw_text ?? partial.subject,
    geometry: partial.geometry ?? { page: 1, x0: 0, y0: 0, x1: 100, y1: 100 },
    confidence: 1,
    uncertain: false,
  };
}

describe("getTodayScheduleStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Monday lessons
  const baseLessons: Lesson[] = [
    createLesson({ id: "l1", subject: "Programarea calculatoarelor", start_time: "10:15", end_time: "11:45", day: "Luni" }),
    createLesson({ id: "l2", subject: "Matematica discretă", start_time: "13:30", end_time: "15:00", day: "Luni" }),
  ];

  it("1. Scenario: time before the first lesson today -> state 2 (Следующее: [предмет] через [N] мин · [start]–[end])", () => {
    // 09:30 Chisinau (06:30 UTC on Monday 2026-09-14)
    // 45 min before 10:15
    vi.setSystemTime(new Date("2026-09-14T06:30:00.000Z"));
    const status = getTodayScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("break");
    expect(status.text).toBe("Следующее: Programarea calculatoarelor через 45 мин · 10:15–11:45");
  });

  it("1b. Scenario: time before the first lesson today when only one lesson exists", () => {
    // Single lesson today
    const singleLesson = [baseLessons[0]];
    vi.setSystemTime(new Date("2026-09-14T06:30:00.000Z"));
    const status = getTodayScheduleStatus(singleLesson, new Date());
    expect(status.type).toBe("break");
    expect(status.text).toBe("Следующее: Programarea calculatoarelor через 45 мин · 10:15–11:45");
  });

  it("2. Scenario: exact start time of lesson -> state 1 (Сейчас: [предмет] [start]–[end])", () => {
    // 10:15 Chisinau (07:15 UTC): exact start moment
    vi.setSystemTime(new Date("2026-09-14T07:15:00.000Z"));
    const status = getTodayScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Programarea calculatoarelor 10:15–11:45");
  });

  it("3. Scenario: time inside lesson -> state 1 (Сейчас: [предмет] [start]–[end])", () => {
    // 11:00 Chisinau (08:00 UTC): midway through lesson
    vi.setSystemTime(new Date("2026-09-14T08:00:00.000Z"));
    const status = getTodayScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Programarea calculatoarelor 10:15–11:45");
  });

  it("4. Scenario: break between two lessons today -> state 2 (Следующее: [предмет] через [N] мин · [start]–[end])", () => {
    // 12:53 Chisinau (09:53 UTC)
    // 13:30 - 12:53 = 37 min
    vi.setSystemTime(new Date("2026-09-14T09:53:00.000Z"));
    const status = getTodayScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("break");
    expect(status.text).toBe("Следующее: Matematica discretă через 37 мин · 13:30–15:00");
  });

  it("4b. Scenario: exact end time of lesson completes it and starts break until next lesson", () => {
    // 11:45 Chisinau (08:45 UTC): Lesson 1 ends at 11:45; next is at 13:30 (105 min later)
    vi.setSystemTime(new Date("2026-09-14T08:45:00.000Z"));
    const status = getTodayScheduleStatus(baseLessons, new Date());
    expect(status.type).toBe("break");
    expect(status.text).toBe("Следующее: Matematica discretă через 105 мин · 13:30–15:00");
  });

  it("4c. Scenario: back-to-back lessons (end1 === start2) transition at now === end1 without duplicate state", () => {
    const consecutiveLessons: Lesson[] = [
      createLesson({ id: "c1", subject: "Математика", start_time: "08:00", end_time: "09:30", day: "Luni" }),
      createLesson({ id: "c2", subject: "Физика", start_time: "09:30", end_time: "11:00", day: "Luni" }),
    ];
    // Exactly at 09:30 Chisinau (06:30 UTC): Lesson 1 has ended, Lesson 2 is current
    vi.setSystemTime(new Date("2026-09-14T06:30:00.000Z"));
    const status = getTodayScheduleStatus(consecutiveLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Физика 09:30–11:00");
  });

  it("5. Scenario: time after the last lesson today -> state 3 (На сегодня занятий больше нет.)", () => {
    // 15:00 Chisinau (12:00 UTC): exact end time of last lesson
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    const statusExactEnd = getTodayScheduleStatus(baseLessons, new Date());
    expect(statusExactEnd.type).toBe("ended");
    expect(statusExactEnd.text).toBe("На сегодня занятий больше нет.");

    // 18:30 Chisinau (15:30 UTC): later in the evening
    vi.setSystemTime(new Date("2026-09-14T15:30:00.000Z"));
    const statusEvening = getTodayScheduleStatus(baseLessons, new Date());
    expect(statusEvening.type).toBe("ended");
    expect(statusEvening.text).toBe("На сегодня занятий больше нет.");
  });

  it("6. Scenario: day without lessons for group/parity -> state 4 (Сегодня занятий нет.)", () => {
    // Empty array of lessons today
    vi.setSystemTime(new Date("2026-09-14T08:00:00.000Z"));
    const status = getTodayScheduleStatus([], new Date());
    expect(status.type).toBe("no_lessons");
    expect(status.text).toBe("Сегодня занятий нет.");
  });

  it("7. Scenario: lesson belonging to only one parity week is ignored when inactive or used when active", () => {
    const parityLessons: Lesson[] = [
      createLesson({ id: "p1", subject: "Физика (лабораторные)", start_time: "08:00", end_time: "09:30", day: "Luni", week_parity: "odd" }),
    ];
    vi.setSystemTime(new Date("2026-09-14T05:00:00.000Z")); // 08:00 Chisinau

    // When week is even: odd lesson is ignored -> no lessons today
    const statusEven = getTodayScheduleStatus(parityLessons, new Date(), { parity: "even" });
    expect(statusEven.type).toBe("no_lessons");
    expect(statusEven.text).toBe("Сегодня занятий нет.");

    // When week is odd: odd lesson is active -> ongoing now
    const statusOdd = getTodayScheduleStatus(parityLessons, new Date(), { parity: "odd" });
    expect(statusOdd.type).toBe("current");
    expect(statusOdd.text).toBe("Сейчас: Физика (лабораторные) 08:00–09:30");
  });

  it("8. Scenario: subgroups in the same time slot aggregated as 'Subj1 / Subj2' without duplicates", () => {
    const subgroupLessons: Lesson[] = [
      createLesson({ id: "sg1", subject: "Английский", subgroup: "1", start_time: "08:00", end_time: "09:30", day: "Luni" }),
      createLesson({ id: "sg2", subject: "Французский", subgroup: "2", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    // 08:15 Chisinau (05:15 UTC)
    vi.setSystemTime(new Date("2026-09-14T05:15:00.000Z"));
    const status = getTodayScheduleStatus(subgroupLessons, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Английский / Французский 08:00–09:30");

    // Two subgroups with identical subject do not duplicate
    const sameSubjLessons: Lesson[] = [
      createLesson({ id: "sg3", subject: "Информатика", subgroup: "1", start_time: "08:00", end_time: "09:30", day: "Luni" }),
      createLesson({ id: "sg4", subject: "Информатика", subgroup: "2", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    const statusSame = getTodayScheduleStatus(sameSubjLessons, new Date());
    expect(statusSame.text).toBe("Сейчас: Информатика 08:00–09:30");
  });

  it("9. Scenario: DST handling in Europe/Chisinau (winter EET UTC+2 vs summer EEST UTC+3)", () => {
    // Winter EET is UTC+2: 06:00 UTC is 08:00 in Chisinau
    // 2026-01-19 is a Monday in winter
    vi.setSystemTime(new Date("2026-01-19T06:00:00.000Z"));
    const winterLesson = [
      createLesson({ id: "w1", subject: "Химия", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    const winterStatus = getTodayScheduleStatus(winterLesson, new Date());
    expect(winterStatus.type).toBe("current");
    expect(winterStatus.text).toBe("Сейчас: Химия 08:00–09:30");

    // Summer EEST is UTC+3: 05:00 UTC is 08:00 in Chisinau
    // 2026-06-15 is a Monday in summer
    vi.setSystemTime(new Date("2026-06-15T05:00:00.000Z"));
    const summerLesson = [
      createLesson({ id: "s1", subject: "Биология", start_time: "08:00", end_time: "09:30", day: "Luni" }),
    ];
    const summerStatus = getTodayScheduleStatus(summerLesson, new Date());
    expect(summerStatus.type).toBe("current");
    expect(summerStatus.text).toBe("Сейчас: Биология 08:00–09:30");
  });

  it("10. Scenario: accepts lightweight schedule items without full Lesson metadata", () => {
    const lightweightItems: ScheduleLessonItem[] = [
      { subject: "Алгебра", start_time: "10:15", end_time: "11:45" },
    ];
    vi.setSystemTime(new Date("2026-09-14T07:15:00.000Z")); // 10:15 Chisinau
    const status = getTodayScheduleStatus(lightweightItems, new Date());
    expect(status.type).toBe("current");
    expect(status.text).toBe("Сейчас: Алгебра 10:15–11:45");
  });
});

describe("ScheduleStatusBlock component", () => {
  it("renders null when view is not 'today'", () => {
    const elementWeek = ScheduleStatusBlock({ view: "week", lessons: [] });
    expect(elementWeek).toBeNull();

    const elementAll = ScheduleStatusBlock({ view: "all", lessons: [] });
    expect(elementAll).toBeNull();
  });

  it("renders status block with accessibility attributes when view is 'today'", () => {
    const element = ScheduleStatusBlock({
      view: "today",
      status: {
        type: "current",
        text: "Сейчас: Programarea calculatoarelor 10:15–11:45",
      },
    });
    expect(element).not.toBeNull();
    expect(element?.props["role"]).toBe("status");
    expect(element?.props["aria-live"]).toBe("polite");
  });
});
