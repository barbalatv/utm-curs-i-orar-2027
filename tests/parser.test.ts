import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGrid, mergeSegments } from "@/lib/parser/geometry";
import { buildCells, rowsCoveredBy, groupsCoveredBy } from "@/lib/parser/cell-builder";
import { classifyType, isRoom, isTeacher, isVenue, segmentLines } from "@/lib/parser/lesson-interpreter";
import { normalizeRoom, normalizeSubgroup, normalizeTeacher, normalizeTime } from "@/lib/parser/normalizer";
import { extractPages, type PageExtraction } from "@/lib/parser/pdf-extract";
import { detectDays, detectGroups, detectLayout, detectSlotRows } from "@/lib/parser/table-detector";
import { validateSchedule } from "@/lib/parser/validator";
import { parsePdf, sha256, type ParseArtifacts } from "@/lib/parser";
import type { Grid } from "@/lib/parser/geometry";

const FIXTURE = path.join(__dirname, "fixtures", "anul_i_semestrul_ii-1.pdf");
const SEED = path.join(__dirname, "..", "data", "seed", "anul_i_semestrul_i-5.pdf");
const REGRESSION = path.join(__dirname, "fixtures", "expected-spring-2026.json");

const provenance = {
  source_page_url: "https://fcim.utm.md/procesul-de-studii/orar/",
  source_pdf_url: "https://fcim.utm.md/wp-content/uploads/sites/24/2026/03/anul_i_semestrul_ii-1.pdf",
  source_kind: "manual" as const,
  downloaded_at: "2026-01-01T00:00:00.000Z",
};

let pdfBytes: Uint8Array;
let page: PageExtraction;
let grid: Grid;
let artifacts: ParseArtifacts;

beforeAll(async () => {
  pdfBytes = new Uint8Array(await readFile(FIXTURE));
  [page] = await extractPages(pdfBytes);
  grid = buildGrid(page.rects);
  artifacts = await parsePdf(pdfBytes, provenance);
});

describe("pdf extraction", () => {
  it("extracts positioned text and grid rectangles", () => {
    expect(page.texts.length).toBeGreaterThan(1000);
    expect(grid.vertical.length).toBeGreaterThan(30);
    expect(grid.horizontal.length).toBeGreaterThan(30);
  });
});

describe("grid reconstruction", () => {
  it("keeps the gap a merged cell leaves in a column border", () => {
    // The border of the column is drawn above and below the merged cell only; a stray
    // collinear rectangle must not bridge that gap, or the merged cell disappears.
    const lines = mergeSegments([
      { at: 100, from: 80, to: 116 },
      { at: 100, from: 134, to: 203 },
      { at: 100.1, from: 62, to: 80 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].from).toBeCloseTo(62);
    expect(lines[0].to).toBeCloseTo(116);
    expect(lines[1].from).toBeCloseTo(134);
    expect(lines[1].to).toBeCloseTo(203);
  });

  it("merges rectangles that paint one border a fraction of a point apart", () => {
    const lines = mergeSegments([
      { at: 52, from: 60, to: 720 },
      { at: 52.5, from: 60, to: 300 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].from).toBeCloseTo(60);
    expect(lines[0].to).toBeCloseTo(720);
  });
});

describe("test_group_detection", () => {
  it("finds every group column from the header row without a hard-coded list", () => {
    const groups = detectGroups(page.texts, grid);
    expect(groups.length).toBe(35);
    expect(groups.map((g) => g.name)).toContain("TI-251");
    expect(groups.map((g) => g.name)).toContain("FAF-253");
    expect(groups.map((g) => g.name)).toContain("IBM-251");
    // Columns are contiguous and ordered left → right.
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i].x0).toBeGreaterThanOrEqual(groups[i - 1].x1 - 0.5);
    }
  });
});

describe("test_day_detection", () => {
  it("detects the five working days as vertically ordered blocks", () => {
    const groups = detectGroups(page.texts, grid);
    const days = detectDays(page.texts, grid, groups);
    expect(days.map((d) => d.day)).toEqual(["Luni", "Marți", "Miercuri", "Joi", "Vineri"]);
    for (let i = 1; i < days.length; i += 1) expect(days[i].y0).toBeGreaterThanOrEqual(days[i - 1].y1 - 1);
  });
});

describe("test_time_slot_detection", () => {
  it("detects 7 slots per day with normalised HH:MM times", () => {
    const layout = detectLayout(page.texts, grid);
    const rows = detectSlotRows(page.texts, grid, layout.groups, layout.days);
    expect(rows.length).toBe(35);
    const luni = rows.filter((row) => row.day === "Luni").map((row) => `${row.start_time}-${row.end_time}`);
    expect(luni).toEqual(["08:00-09:30", "09:45-11:15", "11:30-13:00", "13:30-15:00", "15:15-16:45", "17:00-18:30", "18:45-20:15"]);
  });
});

describe("test_merged_cell_assignment", () => {
  it("assigns a lecture spanning several columns to all covered groups", () => {
    const layout = detectLayout(page.texts, grid);
    const { cells } = buildCells(page.texts, grid, layout, 1);
    const merged = cells.find((cell) => cell.lines[0]?.startsWith("c. Matematica Discretă și Probabilitatea Statistică"));
    expect(merged).toBeDefined();
    expect(merged!.groups.length).toBeGreaterThanOrEqual(8);
    expect(merged!.groups.slice(0, 5)).toEqual(["TI-251", "TI-252", "TI-253", "TI-254", "TI-255"]);
  });

  it("resolves colspan/rowspan purely from rectangle overlap", () => {
    const layout = detectLayout(page.texts, grid);
    const [first, second] = layout.groups;
    const twoColumns = groupsCoveredBy({ x0: first.x0, x1: second.x1, y0: 0, y1: 1 }, layout);
    expect(twoColumns).toEqual([first.name, second.name]);
    const luniRows = layout.rows.filter((row) => row.day === "Luni");
    const tall = rowsCoveredBy({ x0: 0, x1: 1, y0: luniRows[0].y0, y1: luniRows[1].y1 }, layout.rows);
    expect(tall.map((row) => row.start_time)).toEqual(["08:00", "09:45"]);
  });

  it("maps half-height cells to odd/even weeks", () => {
    const parities = new Set(artifacts.schedule.lessons.map((lesson) => lesson.week_parity));
    expect(parities.has("odd")).toBe(true);
    expect(parities.has("even")).toBe(true);
    expect(parities.has("both")).toBe(true);
  });
});

describe("test_schedule_normalization", () => {
  it("normalises times, teachers, rooms and subgroups", () => {
    expect(normalizeTime("8.00")).toBe("08:00");
    expect(normalizeTime("18:45")).toBe("18:45");
    expect(normalizeTeacher("Cuciuc V")).toBe("Cuciuc V.");
    expect(normalizeTeacher("Prozor-Barbalat l.")).toBe("Prozor-Barbalat L.");
    expect(normalizeRoom("D 01-03")).toBe("D01-03");
    expect(normalizeRoom("5 - 114")).toBe("5-114");
    expect(normalizeSubgroup("0,5 gr.")).toBe("0.5 gr.");
    expect(normalizeSubgroup("05,gr.")).toBe("0.5 gr.");
  });

  it("classifies line roles and splits stacked lessons", () => {
    expect(isRoom("606")).toBe(true);
    expect(isRoom("3-3")).toBe(true);
    expect(isRoom("D01-03")).toBe(true);
    expect(isRoom("A1")).toBe(false);
    // Two rooms for the two subgroups of one lesson.
    expect(isRoom("D02/04")).toBe(true);
    expect(isRoom("110/112")).toBe(true);
    expect(isRoom("301-304")).toBe(true);
    expect(isRoom("D-01 / D-03")).toBe(true);
    expect(isVenue("3-3 Amdaris")).toBe(true);
    expect(isVenue("Aula 6-2 Henri Coanda")).toBe(true);
    expect(isVenue("Sala sportiva")).toBe(true);
    expect(isVenue("Analiza Matematica")).toBe(false);
    expect(isTeacher("Costaș A.")).toBe(true);
    expect(isTeacher("Ceban Gh.")).toBe(true);
    expect(isTeacher("Analiza Matematică")).toBe(false);
    expect(isTeacher("Lab BB")).toBe(false);

    const segments = segmentLines(["L. Engleză", "Tintiuc C.", "606", "L. engleză A1", "Prozor-Barbalat L.", "611"]);
    expect(segments).toHaveLength(2);
    expect(segments[1].room).toBe("611");

    const half = segmentLines(["0,5 gr.", "RC", "Dubciuc D.", "215"]);
    expect(half).toHaveLength(1);
    expect(half[0].subgroup).toBe("0.5 gr.");

    // One lesson in two rooms, and an auditorium named after its patron: both used to
    // be split off into a second, subject-less lesson.
    const twoRooms = segmentLines(["L. Engleză", "720", "601"]);
    expect(twoRooms).toHaveLength(1);
    expect(twoRooms[0].room).toBe("720/601");
    const named = segmentLines(["c. Analiza Matematică", "Costaș A.", "3-3 Amdaris"]);
    expect(named).toHaveLength(1);
    expect(named[0].teacher).toBe("Costaș A.");
    expect(named[0].room).toBe("3-3 Amdaris");
    const paired = segmentLines(["Criptografie", "Reșetnicov M.", "D02/04"]);
    expect(paired).toHaveLength(1);
    expect(paired[0].room).toBe("D02/04");

    expect(classifyType("c. Analiza Matematică", null)).toEqual({ type: "lecture", subject: "Analiza Matematică" });
    expect(classifyType("Ed. fizică", null).type).toBe("physical_education");
    expect(classifyType("Educație fizică", null).type).toBe("physical_education");
    expect(classifyType("L. Engleză A1", null).type).toBe("language");
    expect(classifyType("MDPS", null).type).toBe("unknown");
  });
});

describe("test_parser_validation", () => {
  it("accepts the real PDF and rejects suspicious drops", () => {
    const ok = validateSchedule(artifacts.schedule, { previousLessonCount: 400 });
    expect(ok.ok).toBe(true);
    const suspicious = validateSchedule({ ...artifacts.schedule, lessons: artifacts.schedule.lessons.slice(0, 40) }, { previousLessonCount: 442 });
    expect(suspicious.ok).toBe(false);
    expect(suspicious.errors.join(" ")).toMatch(/dropped/);
    const noDays = validateSchedule({ ...artifacts.schedule, days: ["Luni"] });
    expect(noDays.errors.join(" ")).toMatch(/missing day/);
  });

  it("produces lessons with valid times and at least one group", () => {
    for (const lesson of artifacts.schedule.lessons) {
      expect(lesson.groups.length).toBeGreaterThan(0);
      expect(lesson.start_time < lesson.end_time).toBe(true);
    }
  });
});

describe("test_merged_lectures_reach_every_group", () => {
  it("hands the lecture drawn across a block of columns to every one of those groups", async () => {
    const { schedule } = await parsePdf(new Uint8Array(await readFile(SEED)), provenance);
    const lecture = schedule.lessons.find(
      (lesson) => lesson.day === "Luni" && lesson.start_time === "11:30" && lesson.groups.includes("SI-261"),
    );
    expect(lecture).toBeDefined();
    expect(lecture!.subject).toBe("Analiza Matematică");
    expect(lecture!.lesson_type).toBe("lecture");
    expect(lecture!.teacher).toBe("Costaș A.");
    expect(lecture!.groups).toEqual(["SI-261", "SI-262", "SI-263", "SI-264", "SI-265", "SI-266"]);

    // A merged cell is only recognisable by the borders its columns do *not* draw, so a
    // grid that bridged those gaps left most groups without a single lecture.
    for (const group of schedule.groups) {
      const own = schedule.lessons.filter((lesson) => lesson.groups.includes(group.name));
      expect(own.length, group.name).toBeGreaterThanOrEqual(15);
      expect(own.some((lesson) => lesson.lesson_type === "lecture"), group.name).toBe(true);
    }
    expect(schedule.lessons.filter((lesson) => lesson.uncertain)).toHaveLength(0);
  });

  it("reads the room a lesson shares, the named auditorium and sports hall", async () => {
    const { schedule } = await parsePdf(new Uint8Array(await readFile(SEED)), provenance);
    const byRaw = (raw: string) => schedule.lessons.find((lesson) => lesson.raw_text === raw);

    const split = byRaw("Criptografie | Reșetnicov M. | D02/04");
    expect(split).toMatchObject({ subject: "Criptografie", teacher: "Reșetnicov M.", room: "D02/04", uncertain: false });

    const patron = byRaw("c. Tehnici de Programare | Roșca V. | 3-3 Amdaris");
    expect(patron).toMatchObject({ subject: "Tehnici de Programare", room: "3-3 Amdaris", lesson_type: "lecture" });

    const sports = byRaw("Educație fizică | Sala sportivă");
    expect(sports).toMatchObject({ lesson_type: "physical_education", room: "Sala sportivă", uncertain: false });
  });
});

describe("regression fixture", () => {
  it("matches the recorded statistics for the spring 2026 PDF", async () => {
    const expected = JSON.parse(await readFile(REGRESSION, "utf8"));
    const { schedule } = artifacts;
    expect(schedule.metadata.source_pdf_hash).toBe(sha256(pdfBytes));
    expect(schedule.metadata.pdf_title).toBe(expected.title);
    expect(schedule.groups.map((g) => g.name)).toEqual(expected.groups);
    expect(schedule.lessons.length).toBe(expected.lessons);
    expect(schedule.lessons.filter((l) => l.groups.length > 1).length).toBe(expected.merged_lessons);
    expect(schedule.lessons.filter((l) => l.uncertain).length).toBeLessThanOrEqual(expected.max_uncertain);
    const perGroup = Object.fromEntries(schedule.groups.map((g) => [g.name, schedule.lessons.filter((l) => l.groups.includes(g.name)).length]));
    expect(perGroup).toEqual(expected.per_group);
    for (const sample of expected.samples) {
      const found = schedule.lessons.find((l) => l.day === sample.day && l.start_time === sample.start_time && l.groups.includes(sample.group) && l.subject === sample.subject && l.week_parity === sample.week_parity);
      expect(found, JSON.stringify(sample)).toBeDefined();
      expect(found!.teacher).toBe(sample.teacher);
      expect(found!.room).toBe(sample.room);
      expect(found!.lesson_type).toBe(sample.lesson_type);
      expect(found!.week_parity).toBe(sample.week_parity);
      expect(found!.groups.length, JSON.stringify(sample)).toBe(sample.group_count);
    }
  });
});
