import { describe, expect, it } from "vitest";
import { lessonsThisWeek } from "@/lib/client/time";
import type { DayName, Lesson } from "@/lib/models";

function createLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: "test-lesson",
    day: "Luni",
    slot_index: 0,
    slot_span: 1,
    start_time: "08:00",
    end_time: "09:30",
    subject: "Matematica",
    teacher: "Profesor",
    room: "3-1",
    lesson_type: "lecture",
    subgroup: null,
    groups: ["SI-261"],
    week_parity: "both",
    notes: [],
    raw_text: "Matematica",
    geometry: { page: 1, x0: 0, y0: 0, x1: 10, y1: 10 },
    confidence: 1,
    uncertain: false,
    ...overrides,
  };
}

describe("day button lesson counts in Azi mode", () => {
  const days: DayName[] = ["Luni", "Marți", "Miercuri", "Joi", "Vineri"];

  it("counts lessons only for the selected group", () => {
    const allLessons: Lesson[] = [
      createLesson({ id: "1", day: "Luni", groups: ["SI-261"] }),
      createLesson({ id: "2", day: "Luni", groups: ["SI-261", "SI-262"] }),
      createLesson({ id: "3", day: "Luni", groups: ["SI-262"] }),
    ];

    const targetGroup = "SI-261";
    const groupLessons = allLessons.filter((l) => l.groups.includes(targetGroup));
    const lessonsFor = (day: DayName) => groupLessons.filter((l) => l.day === day);

    const countLuni = lessonsThisWeek(lessonsFor("Luni"), "odd").length;
    expect(countLuni).toBe(2);
  });

  it("respects odd vs even week parity and excludes other week", () => {
    const groupLessons: Lesson[] = [
      createLesson({ id: "1", day: "Marți", week_parity: "both" }),
      createLesson({ id: "2", day: "Marți", week_parity: "odd" }),
      createLesson({ id: "3", day: "Marți", week_parity: "even" }),
    ];

    const lessonsFor = (day: DayName) => groupLessons.filter((l) => l.day === day);

    // On odd week: "both" and "odd" count (2 lessons)
    expect(lessonsThisWeek(lessonsFor("Marți"), "odd")).toHaveLength(2);

    // On even week: "both" and "even" count (2 lessons)
    expect(lessonsThisWeek(lessonsFor("Marți"), "even")).toHaveLength(2);
  });

  it("shows 0 when there are no lessons on that day", () => {
    const groupLessons: Lesson[] = [
      createLesson({ id: "1", day: "Luni" }),
    ];

    const lessonsFor = (day: DayName) => groupLessons.filter((l) => l.day === day);

    // Miercuri has no lessons
    expect(lessonsThisWeek(lessonsFor("Miercuri"), "odd")).toHaveLength(0);
    expect(lessonsThisWeek(lessonsFor("Vineri"), "even")).toHaveLength(0);
  });

  it("shows 0 when all lessons on that day belong to the other week", () => {
    const groupLessons: Lesson[] = [
      createLesson({ id: "1", day: "Joi", week_parity: "even" }),
    ];

    const lessonsFor = (day: DayName) => groupLessons.filter((l) => l.day === day);

    // Current week is odd, but only lesson is even -> 0
    expect(lessonsThisWeek(lessonsFor("Joi"), "odd")).toHaveLength(0);
    // When week switches to even -> 1
    expect(lessonsThisWeek(lessonsFor("Joi"), "even")).toHaveLength(1);
  });

  it("calculates counts for all days of the week correctly", () => {
    const groupLessons: Lesson[] = [
      createLesson({ id: "1", day: "Luni", week_parity: "both" }),
      createLesson({ id: "2", day: "Luni", week_parity: "odd" }),
      createLesson({ id: "3", day: "Luni", week_parity: "odd" }),
      createLesson({ id: "4", day: "Marți", week_parity: "both" }),
      createLesson({ id: "5", day: "Marți", week_parity: "both" }),
      createLesson({ id: "6", day: "Marți", week_parity: "both" }),
      createLesson({ id: "7", day: "Marți", week_parity: "odd" }),
      // Miercuri: 0 lessons
      createLesson({ id: "8", day: "Joi", week_parity: "even" }),
      createLesson({ id: "9", day: "Vineri", week_parity: "both" }),
    ];

    const lessonsFor = (day: DayName) => groupLessons.filter((l) => l.day === day);

    const countsOdd = days.map((day) => ({
      day,
      count: lessonsThisWeek(lessonsFor(day), "odd").length,
    }));

    expect(countsOdd).toEqual([
      { day: "Luni", count: 3 },
      { day: "Marți", count: 4 },
      { day: "Miercuri", count: 0 },
      { day: "Joi", count: 0 },
      { day: "Vineri", count: 1 },
    ]);

    const countsEven = days.map((day) => ({
      day,
      count: lessonsThisWeek(lessonsFor(day), "even").length,
    }));

    expect(countsEven).toEqual([
      { day: "Luni", count: 1 },
      { day: "Marți", count: 3 },
      { day: "Miercuri", count: 0 },
      { day: "Joi", count: 1 },
      { day: "Vineri", count: 1 },
    ]);
  });
});
