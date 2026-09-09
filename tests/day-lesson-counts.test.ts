import { describe, expect, it } from "vitest";
import { DAY_SHORT, lessonsThisWeek, type WeekParityName } from "@/lib/client/time";
import type { DayName, Lesson } from "@/lib/models";

function createLesson(id: string, day: DayName, week_parity: Lesson["week_parity"] = "both"): Lesson {
  return {
    id,
    day,
    start_time: "08:00",
    end_time: "09:30",
    subject: "Programare",
    lesson_type: "lab",
    teacher: "Profesor",
    room: "3-101",
    groups: ["IA-261"],
    week_parity,
  } as Lesson;
}

function computeDayLessonCounts(days: DayName[], lessons: Lesson[], parity: WeekParityName): Map<DayName, number> {
  const counts = new Map<DayName, number>();
  for (const day of days) {
    const dayLessons = lessons.filter((lesson) => lesson.day === day);
    counts.set(day, lessonsThisWeek(dayLessons, parity).length);
  }
  return counts;
}

describe("day buttons lesson counts in Azi mode", () => {
  const days: DayName[] = ["Luni", "Marți", "Miercuri", "Joi", "Vineri"];

  it("calculates correct lesson counts for each day on odd week", () => {
    const lessons: Lesson[] = [
      createLesson("1", "Luni", "both"),
      createLesson("2", "Luni", "odd"),
      createLesson("3", "Luni", "even"), // other week: should be excluded
      createLesson("4", "Marți", "odd"),
      createLesson("5", "Miercuri", "both"),
      createLesson("6", "Miercuri", "both"),
      // Joi has 0 lessons
      createLesson("7", "Vineri", "even"), // other week: should be excluded on odd
    ];

    const counts = computeDayLessonCounts(days, lessons, "odd");

    expect(counts.get("Luni")).toBe(2);      // "both" + "odd"
    expect(counts.get("Marți")).toBe(1);     // "odd"
    expect(counts.get("Miercuri")).toBe(2);  // 2x "both"
    expect(counts.get("Joi")).toBe(0);       // 0 lessons
    expect(counts.get("Vineri")).toBe(0);    // only "even" lesson, excluded
  });

  it("calculates correct lesson counts for each day on even week", () => {
    const lessons: Lesson[] = [
      createLesson("1", "Luni", "both"),
      createLesson("2", "Luni", "odd"),    // other week: should be excluded on even
      createLesson("3", "Luni", "even"),
      createLesson("4", "Marți", "odd"),   // other week: should be excluded on even
      createLesson("5", "Miercuri", "both"),
      createLesson("6", "Miercuri", "both"),
      createLesson("7", "Vineri", "even"),
    ];

    const counts = computeDayLessonCounts(days, lessons, "even");

    expect(counts.get("Luni")).toBe(2);      // "both" + "even"
    expect(counts.get("Marți")).toBe(0);     // "odd" excluded -> 0
    expect(counts.get("Miercuri")).toBe(2);  // 2x "both"
    expect(counts.get("Joi")).toBe(0);       // 0 lessons
    expect(counts.get("Vineri")).toBe(1);    // "even"
  });

  it("formats desktop labels as '<Day> <Count>'", () => {
    const counts = new Map<DayName, number>([
      ["Luni", 3],
      ["Marți", 0],
    ]);

    expect(`Luni ${counts.get("Luni") ?? 0}`).toBe("Luni 3");
    expect(`Marți ${counts.get("Marți") ?? 0}`).toBe("Marți 0");
  });

  it("formats mobile labels as '<DayShort> <Count>'", () => {
    const counts = new Map<DayName, number>([
      ["Luni", 3],
      ["Marți", 0],
    ]);

    expect(`${DAY_SHORT["Luni"]} ${counts.get("Luni") ?? 0}`).toBe("Lu 3");
    expect(`${DAY_SHORT["Marți"]} ${counts.get("Marți") ?? 0}`).toBe("Ma 0");
  });
});
