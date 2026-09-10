import { describe, expect, it } from "vitest";
import { getScheduleStatus, type LocalNow } from "@/lib/client/time";
import type { Lesson } from "@/lib/models";

function makeLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: "test-lesson-id",
    day: "Luni",
    slot_index: 0,
    slot_span: 1,
    start_time: "08:00",
    end_time: "09:30",
    groups: ["CR-231"],
    subject: "Programarea calculatoarelor",
    teacher: "Ion Popescu",
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

function makeNow(day: LocalNow["day"], time: string): LocalNow {
  const [h, m] = time.split(":").map(Number);
  return {
    day,
    minutes: h * 60 + m,
    dateLabel: "Test Date",
    timeLabel: time,
  };
}

describe("Current Schedule Status in Azi Mode", () => {
  const sampleLessons: Lesson[] = [
    makeLesson({
      id: "l1",
      day: "Luni",
      start_time: "08:00",
      end_time: "09:30",
      subject: "Programarea calculatoarelor",
    }),
    makeLesson({
      id: "l2",
      day: "Luni",
      start_time: "09:45",
      end_time: "11:15",
      subject: "Matematica discretă",
    }),
    makeLesson({
      id: "l3",
      day: "Luni",
      start_time: "11:30",
      end_time: "13:00",
      subject: "Fizica",
    }),
  ];

  it("Scenario 1: Time before the first class", () => {
    // 07:23 is 37 minutes before the 08:00 class
    const now = makeNow("Luni", "07:23");
    const status = getScheduleStatus(sampleLessons, now, "odd");

    expect(status.type).toBe("break");
    expect(status.text).toBe("Следующее: Programarea calculatoarelor");
    expect(status.subtext).toBe("через 37 мин · 08:00–09:30");
    expect(status.remainingMinutes).toBe(37);
    expect(status.lesson?.id).toBe("l1");

    // 07:59: exactly 1 minute before first class
    const oneMinBefore = makeNow("Luni", "07:59");
    const status1m = getScheduleStatus(sampleLessons, oneMinBefore, "odd");
    expect(status1m.type).toBe("break");
    expect(status1m.subtext).toBe("через 1 мин · 08:00–09:30");
    expect(status1m.remainingMinutes).toBe(1);
  });

  it("Scenario 2: Time inside a class", () => {
    // Exactly at start time (08:00)
    const atStart = makeNow("Luni", "08:00");
    const statusStart = getScheduleStatus(sampleLessons, atStart, "odd");
    expect(statusStart.type).toBe("in_progress");
    expect(statusStart.text).toBe("Сейчас: Programarea calculatoarelor");
    expect(statusStart.subtext).toBe("08:00–09:30");
    expect(statusStart.lesson?.id).toBe("l1");

    // Mid-class (08:45)
    const midClass = makeNow("Luni", "08:45");
    const statusMid = getScheduleStatus(sampleLessons, midClass, "odd");
    expect(statusMid.type).toBe("in_progress");
    expect(statusMid.text).toBe("Сейчас: Programarea calculatoarelor");
    expect(statusMid.subtext).toBe("08:00–09:30");

    // One minute before end (09:29)
    const beforeEnd = makeNow("Luni", "09:29");
    const statusEnd = getScheduleStatus(sampleLessons, beforeEnd, "odd");
    expect(statusEnd.type).toBe("in_progress");
  });

  it("Scenario 3: Break between two classes", () => {
    // Exactly at end of class 1 (09:30): class 1 has ended, break begins
    const atBreakStart = makeNow("Luni", "09:30");
    const statusBreakStart = getScheduleStatus(sampleLessons, atBreakStart, "odd");
    expect(statusBreakStart.type).toBe("break");
    expect(statusBreakStart.text).toBe("Следующее: Matematica discretă");
    expect(statusBreakStart.subtext).toBe("через 15 мин · 09:45–11:15");
    expect(statusBreakStart.remainingMinutes).toBe(15);
    expect(statusBreakStart.lesson?.id).toBe("l2");

    // Mid-break at 09:38: 7 minutes before class 2 (09:45)
    const midBreak = makeNow("Luni", "09:38");
    const statusMidBreak = getScheduleStatus(sampleLessons, midBreak, "odd");
    expect(statusMidBreak.type).toBe("break");
    expect(statusMidBreak.text).toBe("Следующее: Matematica discretă");
    expect(statusMidBreak.subtext).toBe("через 7 мин · 09:45–11:15");
    expect(statusMidBreak.remainingMinutes).toBe(7);
  });

  it("Scenario 4: Time after the last class", () => {
    // Exactly at end of last class (13:00)
    const atLastEnd = makeNow("Luni", "13:00");
    const statusEnd = getScheduleStatus(sampleLessons, atLastEnd, "odd");
    expect(statusEnd.type).toBe("finished");
    expect(statusEnd.text).toBe("На сегодня занятий больше нет");
    expect(statusEnd.subtext).toBeUndefined();

    // Later in the evening (20:30)
    const evening = makeNow("Luni", "20:30");
    const statusEvening = getScheduleStatus(sampleLessons, evening, "odd");
    expect(statusEvening.type).toBe("finished");
    expect(statusEvening.text).toBe("На сегодня занятий больше нет");
  });

  it("Scenario 5: A day with no classes", () => {
    // 5a: Weekend day (day is null)
    const weekend = makeNow(null, "12:00");
    const statusWeekend = getScheduleStatus(sampleLessons, weekend, "odd");
    expect(statusWeekend.type).toBe("none_today");
    expect(statusWeekend.text).toBe("Сегодня занятий нет");

    // 5b: Weekday with no classes scheduled for the group (e.g. Wednesday)
    const freeWednesday = makeNow("Miercuri", "10:00");
    const statusFree = getScheduleStatus(sampleLessons, freeWednesday, "odd");
    expect(statusFree.type).toBe("none_today");
    expect(statusFree.text).toBe("Сегодня занятий нет");

    // 5c: Empty lesson list on any weekday
    const emptyDay = makeNow("Luni", "10:00");
    const statusEmpty = getScheduleStatus([], emptyDay, "odd");
    expect(statusEmpty.type).toBe("none_today");
    expect(statusEmpty.text).toBe("Сегодня занятий нет");
  });

  it("Scenario 6: A class that exists only on a specific parity week", () => {
    const parityLessons: Lesson[] = [
      makeLesson({
        id: "odd-only",
        day: "Marți",
        start_time: "10:15",
        end_time: "11:45",
        subject: "Structuri de date (impar)",
        week_parity: "odd",
      }),
      makeLesson({
        id: "even-only",
        day: "Marți",
        start_time: "10:15",
        end_time: "11:45",
        subject: "Arhitectura calculatoarelor (par)",
        week_parity: "even",
      }),
      makeLesson({
        id: "odd-afternoon",
        day: "Marți",
        start_time: "13:30",
        end_time: "15:00",
        subject: "Laborator Fizica",
        week_parity: "odd",
      }),
    ];

    const timeDuringMorningClass = makeNow("Marți", "10:30");

    // On odd week: odd-only lesson runs
    const oddStatus = getScheduleStatus(parityLessons, timeDuringMorningClass, "odd");
    expect(oddStatus.type).toBe("in_progress");
    expect(oddStatus.text).toBe("Сейчас: Structuri de date (impar)");
    expect(oddStatus.lesson?.id).toBe("odd-only");

    // On even week: even-only lesson runs
    const evenStatus = getScheduleStatus(parityLessons, timeDuringMorningClass, "even");
    expect(evenStatus.type).toBe("in_progress");
    expect(evenStatus.text).toBe("Сейчас: Arhitectura calculatoarelor (par)");
    expect(evenStatus.lesson?.id).toBe("even-only");

    // During break before afternoon class on odd week (12:30):
    // Next lesson is odd-afternoon
    const breakOdd = makeNow("Marți", "12:30");
    const oddBreakStatus = getScheduleStatus(parityLessons, breakOdd, "odd");
    expect(oddBreakStatus.type).toBe("break");
    expect(oddBreakStatus.text).toBe("Следующее: Laborator Fizica");
    expect(oddBreakStatus.remainingMinutes).toBe(60);

    // On even week at 12:30: even-only ended at 11:45, and odd-afternoon does NOT run on even week
    // Therefore all classes for the day have finished!
    const evenBreakStatus = getScheduleStatus(parityLessons, breakOdd, "even");
    expect(evenBreakStatus.type).toBe("finished");
    expect(evenBreakStatus.text).toBe("На сегодня занятий больше нет");

    // Single parity-only class day on the opposite week -> "Сегодня занятий нет"
    const singleOddLesson = [
      makeLesson({
        id: "only-odd",
        day: "Vineri",
        start_time: "08:00",
        end_time: "09:30",
        subject: "Seminar Filosofie",
        week_parity: "odd",
      }),
    ];
    const fridayTime = makeNow("Vineri", "08:30");
    const fridayOdd = getScheduleStatus(singleOddLesson, fridayTime, "odd");
    expect(fridayOdd.type).toBe("in_progress");
    expect(fridayOdd.text).toBe("Сейчас: Seminar Filosofie");

    const fridayEven = getScheduleStatus(singleOddLesson, fridayTime, "even");
    expect(fridayEven.type).toBe("none_today");
    expect(fridayEven.text).toBe("Сегодня занятий нет");
  });

  it("Scenario 7: Timezone evaluation is strictly Europe/Chisinau", () => {
    // 2026-09-07 is Monday in Chișinău.
    // In September, Chișinău is EEST (UTC+3).
    // 05:00:00Z UTC corresponds to 08:00:00 Chișinău time.
    const dateAtStartUTC = new Date("2026-09-07T05:00:00.000Z");
    const statusAtStart = getScheduleStatus(sampleLessons, dateAtStartUTC, "odd");
    expect(statusAtStart.type).toBe("in_progress");
    expect(statusAtStart.text).toBe("Сейчас: Programarea calculatoarelor");
    expect(statusAtStart.subtext).toBe("08:00–09:30");

    // 04:35:00Z UTC corresponds to 07:35:00 Chișinău time (25 mins before 08:00).
    const dateBeforeStartUTC = new Date("2026-09-07T04:35:00.000Z");
    const statusBefore = getScheduleStatus(sampleLessons, dateBeforeStartUTC, "odd");
    expect(statusBefore.type).toBe("break");
    expect(statusBefore.remainingMinutes).toBe(25);
    expect(statusBefore.subtext).toBe("через 25 мин · 08:00–09:30");

    // Sunday evening UTC (2026-09-06T22:30:00Z) is Monday 01:30:00 in Chișinău!
    const dateSundayUtcIsMondayChisinau = new Date("2026-09-06T22:30:00.000Z");
    const statusMondayMorning = getScheduleStatus(sampleLessons, dateSundayUtcIsMondayChisinau, "odd");
    expect(statusMondayMorning.type).toBe("break");
    expect(statusMondayMorning.lesson?.id).toBe("l1");
  });

  it("Scenario 8: Subgroups with concurrent lessons", () => {
    const subgroupLessons: Lesson[] = [
      makeLesson({
        id: "sg1",
        day: "Joi",
        start_time: "10:15",
        end_time: "11:45",
        subject: "Programarea calculatoarelor",
        subgroup: "gr. 1",
      }),
      makeLesson({
        id: "sg2",
        day: "Joi",
        start_time: "10:15",
        end_time: "11:45",
        subject: "Programarea calculatoarelor",
        subgroup: "gr. 2",
      }),
    ];

    const at1030 = makeNow("Joi", "10:30");
    const status = getScheduleStatus(subgroupLessons, at1030, "odd");
    expect(status.type).toBe("in_progress");
    // Duplicate subject names from subgroups should be deduplicated
    expect(status.text).toBe("Сейчас: Programarea calculatoarelor");
    expect(status.subtext).toBe("10:15–11:45");
  });
});
