/**
 * Stage 3–5: locate the structural parts of the timetable –
 * group columns (header row), day blocks (left label column) and time-slot rows.
 * Detection is geometric: regexes only classify text that was found by position.
 */
import { DAY_NAMES, type DayName, type GroupColumn, type TimeSlot } from "@/lib/models";
import { normalizeTime } from "./normalizer";
import { enclosingCell, centerOf, overlap1d, type CellBounds, type Grid } from "./geometry";
import type { TextItem } from "./pdf-extract";

/** Group codes such as SI-261, IBM-261, FAF-261, R-261. */
export const GROUP_CODE_RE = /^([A-ZĂÂÎȘŞȚŢ]{1,5})-(\d{3}[A-Za-z]?)$/;
const TIME_RANGE_RE = /^(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})$/;
/** Share of a candidate header cell that must lie inside the header band. */
const HEADER_BAND_OVERLAP = 0.8;

const DAY_ALIASES: Record<string, DayName> = {
  luni: "Luni",
  marti: "Marți",
  marți: "Marți",
  marţi: "Marți",
  miercuri: "Miercuri",
  joi: "Joi",
  vineri: "Vineri",
};

export interface DayBlock {
  day: DayName;
  y0: number;
  y1: number;
}

export interface SlotRow extends TimeSlot {
  day: DayName;
  y0: number;
  y1: number;
}

export interface TableLayout {
  groups: GroupColumn[];
  days: DayBlock[];
  rows: SlotRow[];
  /** Overall bounding box of the group columns × day blocks. */
  bounds: CellBounds;
}

export function detectGroups(texts: TextItem[], grid: Grid): GroupColumn[] {
  const candidates: Array<{ column: GroupColumn; cell: CellBounds }> = [];
  for (const item of texts) {
    const match = GROUP_CODE_RE.exec(item.text.trim());
    if (!match) continue;
    const { cx, cy } = centerOf(item);
    const cell = enclosingCell(grid, cx, cy);
    if (!cell) continue;
    const name = match[0];
    // Header cells are narrow; a group code inside a lesson cell would be enclosed by a wider box.
    if (cell.x1 - cell.x0 > 60) continue;
    candidates.push({ column: { name, program: match[1], x0: cell.x0, x1: cell.x1 }, cell });
  }

  // Group headers share one ruled row. Restricting detection to the busiest row prevents
  // lesson text that merely looks like a group code (for example "TI-002") from replacing
  // the real header in the same column.
  const headerCandidates = busiestCellRow(candidates);
  const typicalWidth = median(uniqueCellWidths(headerCandidates));
  const groups = headerCandidates
    // The diagonal corner cell beside the timetable is wider and can contain invisible or
    // clipped PDF text; only accept cells whose width matches the run of real group columns.
    .filter(({ cell }) => typicalWidth === null || Math.abs(cell.x1 - cell.x0 - typicalWidth) <= Math.max(1.5, typicalWidth * 0.25))
    .map(({ column }) => column)
    .filter((column, index, all) => all.findIndex((candidate) => candidate.name === column.name) === index)
    .sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
  return dedupeOverlappingColumns(groups);
}

/**
 * The header band: the busiest ruled row plus every candidate whose header cell
 * overlaps it. Header cells are not always ruled identically – a column may carry
 * two group codes and start a line higher – so exact y-equality would drop real
 * columns, while requiring overlap still rejects lesson text one row below.
 */
function busiestCellRow(candidates: Array<{ column: GroupColumn; cell: CellBounds }>) {
  const rows = new Map<string, Array<{ column: GroupColumn; cell: CellBounds }>>();
  for (const candidate of candidates) {
    const key = `${candidate.cell.y0}:${candidate.cell.y1}`;
    const row = rows.get(key) ?? [];
    row.push(candidate);
    rows.set(key, row);
  }
  const busiest = [...rows.values()].sort((a, b) => b.length - a.length)[0];
  if (!busiest) return [];
  const band = busiest[0].cell;
  return candidates.filter(({ cell }) => {
    const reference = Math.min(cell.y1 - cell.y0, band.y1 - band.y0);
    return reference > 0 && overlap1d(cell.y0, cell.y1, band.y0, band.y1) >= reference * HEADER_BAND_OVERLAP;
  });
}

function uniqueCellWidths(candidates: Array<{ cell: CellBounds }>): number[] {
  const cells = new Map<string, number>();
  for (const { cell } of candidates) cells.set(`${cell.x0}:${cell.x1}`, cell.x1 - cell.x0);
  return [...cells.values()];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Keep aliases sharing the exact header cell, but reject accidental overlapping columns. */
function dedupeOverlappingColumns(groups: GroupColumn[]): GroupColumn[] {
  const result: GroupColumn[] = [];
  for (const group of groups) {
    const last = result[result.length - 1];
    if (last && group.x0 < last.x1 - 1) {
      const sameCell = Math.abs(group.x0 - last.x0) <= 0.2 && Math.abs(group.x1 - last.x1) <= 0.2;
      if (!sameCell) continue;
    }
    result.push(group);
  }
  return result;
}

export function detectDays(texts: TextItem[], grid: Grid, groups: GroupColumn[]): DayBlock[] {
  const tableLeft = groups.length > 0 ? groups[0].x0 : Infinity;
  const blocks = new Map<DayName, DayBlock>();
  for (const item of texts) {
    const day = DAY_ALIASES[item.text.trim().toLowerCase()];
    if (!day) continue;
    const { cx, cy } = centerOf(item);
    // Day labels live in the left margin column; the right margin repeats them.
    if (cx > tableLeft) continue;
    const cell = enclosingCell(grid, cx, cy);
    if (!cell) continue;
    if (!blocks.has(day)) blocks.set(day, { day, y0: cell.y0, y1: cell.y1 });
  }
  return [...blocks.values()].sort((a, b) => a.y0 - b.y0);
}

export function detectSlotRows(texts: TextItem[], grid: Grid, groups: GroupColumn[], days: DayBlock[]): SlotRow[] {
  const tableLeft = groups.length > 0 ? groups[0].x0 : Infinity;
  const rows = new Map<string, SlotRow>();

  for (const item of texts) {
    const match = TIME_RANGE_RE.exec(item.text.trim());
    if (!match) continue;
    const { cx, cy } = centerOf(item);
    if (cx > tableLeft) continue;
    const cell = enclosingCell(grid, cx, cy);
    if (!cell) continue;
    const day = days.find((block) => cy >= block.y0 && cy <= block.y1);
    if (!day) continue;
    const key = `${day.day}:${cell.y0}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      day: day.day,
      index: -1,
      start_time: normalizeTime(`${match[1]}.${match[2]}`),
      end_time: normalizeTime(`${match[3]}.${match[4]}`),
      raw: item.text.trim(),
      y0: cell.y0,
      y1: cell.y1,
    });
  }

  const sorted = [...rows.values()].sort((a, b) => a.y0 - b.y0);
  const slotIndexByStart = buildSlotIndex(sorted);
  return sorted.map((row) => ({ ...row, index: slotIndexByStart.get(row.start_time) ?? 0 }));
}

/** Canonical slot list (distinct start times across all days, sorted). */
export function canonicalTimeSlots(rows: SlotRow[]): TimeSlot[] {
  const byStart = new Map<string, TimeSlot>();
  for (const row of rows) {
    if (!byStart.has(row.start_time)) {
      byStart.set(row.start_time, { index: 0, start_time: row.start_time, end_time: row.end_time, raw: row.raw });
    }
  }
  return [...byStart.values()]
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((slot, index) => ({ ...slot, index }));
}

function buildSlotIndex(rows: SlotRow[]): Map<string, number> {
  const starts = [...new Set(rows.map((row) => row.start_time))].sort();
  return new Map(starts.map((start, index) => [start, index]));
}

export function detectLayout(texts: TextItem[], grid: Grid): TableLayout {
  const groups = detectGroups(texts, grid);
  const days = detectDays(texts, grid, groups);
  const rows = detectSlotRows(texts, grid, groups, days);
  const bounds: CellBounds = {
    x0: groups[0]?.x0 ?? 0,
    x1: groups[groups.length - 1]?.x1 ?? 0,
    y0: days[0]?.y0 ?? 0,
    y1: days[days.length - 1]?.y1 ?? 0,
  };
  return { groups, days, rows, bounds };
}

export const KNOWN_DAYS: readonly DayName[] = DAY_NAMES;
