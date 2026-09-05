/**
 * Stage 7: lesson interpretation. Converts the text lines of a reconstructed
 * cell into one or more lessons (subject / teacher / room / type / subgroup).
 * The line *roles* are decided by small classifiers; layout order is never
 * assumed blindly, and anything ambiguous is flagged as uncertain.
 */
import { createHash } from "node:crypto";
import type { Lesson, LessonType, WeekParity } from "@/lib/models";
import type { TableCell } from "./cell-builder";
import { normalizeRoom, normalizeSubgroup, normalizeSubject, normalizeTeacher, cleanText } from "./normalizer";

/** "606", "3-3", "5-114", "D01-03", "D-01-02", "D 01,03" – but not "A1" (language level). */
const ROOM_RE = /^(?:[A-Z]\s?-?\s?\d{2}(?:\s?[-,]\s?\d{2})?|\d\s?-\s?\d{1,3}[a-z]?|\d{3}[a-z]?)$/i;
const NAME_WORD = "[A-ZĂÂÎȘȚ][a-zăâîșț]+(?:-[A-Za-zĂÂÎȘȚăâîșț][a-zăâîșț]+)?";
const TEACHER_RE = new RegExp(`^${NAME_WORD}(?: ${NAME_WORD})?\\s+(?:[A-ZĂÂÎȘȚ][a-zăâîșț]{0,2}\\.?|[a-z]\\.)$`);
const SUBGROUP_RE = /(?:\b0\s*[.,]\s*5\s*[,.]?\s*gr\.?|\b05\s*,\s*gr\.?)/i;
const LONE_MARKER_RE = /^(c|lab|sem|pr|proiect)\.?$/i;
const PHYS_ED_RE = /^ed\.?\s*fizic[aă](?![a-zăâîșț])/i;
const LANGUAGE_RE = /^(?:l\.?\s*|limba\s+|limbă\s+)?(?:engleză|engleza|română|romana|rom\.?|străină|straina|franceză|germană)(?![a-zăâîșț])/i;

const TYPE_PREFIXES: { pattern: RegExp; type: LessonType }[] = [
  { pattern: /^c\.\s*/i, type: "lecture" },
  { pattern: /^curs\b\.?\s*/i, type: "lecture" },
  { pattern: /^lab(?:orator)?\.?\s+/i, type: "lab" },
  { pattern: /^sem(?:inar)?\.?\s+/i, type: "seminar" },
  { pattern: /^pr(?:act)?\.?\s+/i, type: "practice" },
  { pattern: /^proiect\.?\s+/i, type: "project" },
];

interface Segment {
  subjectLines: string[];
  teacher: string | null;
  room: string | null;
  subgroup: string | null;
  leadingType: LessonType | null;
}

function emptySegment(): Segment {
  return { subjectLines: [], teacher: null, room: null, subgroup: null, leadingType: null };
}

export function isRoom(text: string): boolean {
  return ROOM_RE.test(text.trim());
}

export function isTeacher(text: string): boolean {
  return TEACHER_RE.test(text.trim());
}

/** Split the visual lines of a cell into logical lessons. */
export function segmentLines(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let current = emptySegment();
  let pendingType: LessonType | null = null;

  const hasContent = (segment: Segment) =>
    segment.subjectLines.length > 0 || segment.teacher !== null || segment.room !== null;

  const startNew = () => {
    if (hasContent(current)) segments.push(current);
    current = emptySegment();
  };

  for (const rawLine of lines) {
    let line = cleanText(rawLine);
    const subgroupMatch = SUBGROUP_RE.exec(line);
    if (subgroupMatch) {
      line = cleanText(line.replace(subgroupMatch[0], ""));
      if (current.room !== null && current.subjectLines.length > 0) startNew();
      current.subgroup = normalizeSubgroup(subgroupMatch[0]);
      if (!line) continue;
    }

    const loneMarker = LONE_MARKER_RE.exec(line);
    if (loneMarker) {
      pendingType = TYPE_PREFIXES.find((entry) => entry.pattern.test(`${line} `))?.type ?? null;
      continue;
    }

    for (const part of splitMixedLine(line)) {
      if (isRoom(part)) {
        if (current.room !== null) startNew();
        current.room = normalizeRoom(part);
      } else if (isTeacher(part)) {
        if (current.teacher !== null) startNew();
        current.teacher = normalizeTeacher(part);
      } else {
        if (current.teacher !== null || current.room !== null) startNew();
        if (pendingType && current.subjectLines.length === 0) {
          current.leadingType = pendingType;
          pendingType = null;
        }
        current.subjectLines.push(part);
      }
    }
  }
  if (hasContent(current)) segments.push(current);
  return segments;
}

/** "5-511 Cuciuc V" → ["5-511", "Cuciuc V"]; otherwise the line unchanged. */
function splitMixedLine(line: string): string[] {
  const tokens = line.split(" ");
  if (tokens.length < 2) return [line];
  for (let split = 1; split < tokens.length; split += 1) {
    const head = tokens.slice(0, split).join(" ");
    const tail = tokens.slice(split).join(" ");
    if ((isRoom(head) && (isTeacher(tail) || !isRoom(tail))) || (isRoom(tail) && (isTeacher(head) || !isRoom(head)))) {
      if (isRoom(head) || isRoom(tail)) return [head, tail];
    }
  }
  return [line];
}

export function classifyType(subject: string, leadingType: LessonType | null): { type: LessonType; subject: string } {
  let text = subject;
  let type: LessonType | null = leadingType;
  for (const entry of TYPE_PREFIXES) {
    if (entry.pattern.test(text)) {
      type = entry.type;
      text = text.replace(entry.pattern, "");
      break;
    }
  }
  if (type === null) {
    if (PHYS_ED_RE.test(text)) type = "physical_education";
    else if (LANGUAGE_RE.test(text)) type = "language";
  }
  return { type: type ?? "unknown", subject: text };
}

export function interpretCell(cell: TableCell): Lesson[] {
  if (cell.rows.length === 0 || cell.groups.length === 0) return [];
  const segments = segmentLines(cell.lines);
  const rawText = cell.lines.join(" | ");
  const firstRow = cell.rows[0];
  const lastRow = cell.rows[cell.rows.length - 1];
  const lessons: Lesson[] = [];

  const notes: string[] = [];
  const parity = parityFromPosition(cell.position);
  if (parity === "odd") notes.push("Jumătatea de sus a celulei – săptămâna impară");
  if (parity === "even") notes.push("Jumătatea de jos a celulei – săptămâna pară");
  if (cell.rows.length > 1) notes.push(`Ocupă ${cell.rows.length} intervale consecutive`);
  if (cell.background) notes.push(`Evidențiat în PDF (${cell.background})`);

  segments.forEach((segment, index) => {
    const joinedSubject = segment.subjectLines.join(" ");
    const { type, subject } = classifyType(joinedSubject, segment.leadingType);
    const normalizedSubject = normalizeSubject(subject);
    const hasSubject = normalizedSubject.length > 0;
    const uncertain = !hasSubject || (segment.teacher === null && segment.room === null && !isSelfContained(type));
    const confidence = scoreConfidence(hasSubject, segment, type, segments.length);

    lessons.push({
      id: lessonId(cell, index),
      day: firstRow.day,
      slot_index: firstRow.index,
      slot_span: cell.rows.length,
      start_time: firstRow.start_time,
      end_time: lastRow.end_time,
      groups: cell.groups,
      subject: hasSubject ? normalizedSubject : rawText || "Nerecunoscut",
      teacher: segment.teacher,
      room: segment.room,
      lesson_type: type,
      subgroup: segment.subgroup,
      week_parity: parity,
      notes: uncertain ? [...notes, "Conținutul celulei nu a putut fi interpretat cu certitudine"] : notes,
      raw_text: rawText,
      geometry: { page: cell.page, ...cell.bounds },
      confidence,
      uncertain,
    });
  });

  return lessons;
}

/**
 * UTM timetables split a slot cell horizontally when a lesson alternates weekly:
 * upper half = odd (impar) week, lower half = even (par) week. A full-height
 * cell happens every week. This is a geometric fact of the PDF, not a guess.
 */
function parityFromPosition(position: TableCell["position"]): WeekParity {
  if (position === "top") return "odd";
  if (position === "bottom") return "even";
  return "both";
}

/** Physical education / language cells frequently omit room or teacher on purpose. */
function isSelfContained(type: LessonType): boolean {
  return type === "physical_education" || type === "language";
}

function scoreConfidence(hasSubject: boolean, segment: Segment, type: LessonType, segmentCount: number): number {
  if (!hasSubject) return 0.3;
  let score = 0.6;
  if (segment.teacher) score += 0.2;
  if (segment.room) score += 0.15;
  if (type !== "unknown") score += 0.05;
  if (segmentCount > 1) score -= 0.1;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function lessonId(cell: TableCell, index: number): string {
  const seed = `${cell.page}:${cell.key}:${index}:${cell.lines.join("|")}`;
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}
