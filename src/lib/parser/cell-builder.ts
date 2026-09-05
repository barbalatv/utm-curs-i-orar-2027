/**
 * Stage 6: cell reconstruction. Every text item is attributed to the drawn
 * cell that encloses it; items inside the same cell are grouped into visual
 * lines. The cell rectangle is then projected onto the group columns and slot
 * rows, which is how merged cells (colspan / rowspan) are resolved.
 */
import { backgroundAt, cellKey, centerOf, enclosingCell, overlap1d, type CellBounds, type Grid } from "./geometry";
import type { TextItem } from "./pdf-extract";
import type { SlotRow, TableLayout } from "./table-detector";
import type { DayName } from "@/lib/models";

/** Items whose vertical centres differ by less than this belong to the same visual line. */
const SAME_LINE_TOLERANCE_PT = 1.0;
/** A column/row counts as covered when at least this share of it lies under the cell. */
const MIN_COVERAGE_RATIO = 0.5;

export interface TableCell {
  key: string;
  page: number;
  bounds: CellBounds;
  lines: string[];
  background: string | null;
  groups: string[];
  day: DayName | null;
  rows: SlotRow[];
  position: RowPosition;
}

export interface CellBuildResult {
  cells: TableCell[];
  /** Cells with text that are inside the table but could not be assigned to any group/slot. */
  orphans: TableCell[];
}

export function buildCells(texts: TextItem[], grid: Grid, layout: TableLayout, page: number): CellBuildResult {
  const byCell = new Map<string, { bounds: CellBounds; items: TextItem[] }>();

  for (const item of texts) {
    const { cx, cy } = centerOf(item);
    if (!isInsideTable(cx, cy, layout)) continue;
    const bounds = enclosingCell(grid, cx, cy);
    if (!bounds) continue;
    const key = cellKey(bounds);
    const bucket = byCell.get(key) ?? { bounds, items: [] };
    bucket.items.push(item);
    byCell.set(key, bucket);
  }

  const cells: TableCell[] = [];
  const orphans: TableCell[] = [];
  for (const [key, bucket] of byCell) {
    const groups = groupsCoveredBy(bucket.bounds, layout);
    const rows = rowsCoveredBy(bucket.bounds, layout.rows);
    const cell: TableCell = {
      key,
      page,
      bounds: bucket.bounds,
      lines: itemsToLines(bucket.items),
      background: backgroundAt(grid, bucket.bounds),
      groups,
      day: rows[0]?.day ?? null,
      rows,
      position: rowPosition(bucket.bounds, rows),
    };
    if (groups.length === 0 || rows.length === 0) orphans.push(cell);
    else cells.push(cell);
  }

  cells.sort((a, b) => a.bounds.y0 - b.bounds.y0 || a.bounds.x0 - b.bounds.x0);
  return { cells, orphans };
}

function isInsideTable(cx: number, cy: number, layout: TableLayout): boolean {
  const { bounds } = layout;
  return cx >= bounds.x0 - 1 && cx <= bounds.x1 + 1 && cy >= bounds.y0 - 1 && cy <= bounds.y1 + 1;
}

/** Colspan resolution: which group columns does the cell rectangle cover? */
export function groupsCoveredBy(bounds: CellBounds, layout: TableLayout): string[] {
  return layout.groups
    .filter((group) => {
      const width = group.x1 - group.x0;
      return overlap1d(bounds.x0, bounds.x1, group.x0, group.x1) >= width * MIN_COVERAGE_RATIO;
    })
    .map((group) => group.name);
}

/**
 * Rowspan resolution: which slot rows does the cell rectangle cover?
 * A cell may be a half-row (week parity split), so coverage is measured
 * against the smaller of the two heights.
 */
export function rowsCoveredBy(bounds: CellBounds, rows: SlotRow[]): SlotRow[] {
  const cellHeight = bounds.y1 - bounds.y0;
  return rows
    .filter((row) => {
      const reference = Math.min(row.y1 - row.y0, cellHeight);
      return overlap1d(bounds.y0, bounds.y1, row.y0, row.y1) >= reference * MIN_COVERAGE_RATIO;
    })
    .sort((a, b) => a.y0 - b.y0);
}

/** A cell shorter than this share of its slot row is a top/bottom half (odd/even week). */
const FULL_ROW_RATIO = 0.75;

export type RowPosition = "full" | "top" | "bottom";

/** Where does the cell sit inside its (single) slot row? */
export function rowPosition(bounds: CellBounds, rows: SlotRow[]): RowPosition {
  if (rows.length !== 1) return "full";
  const row = rows[0];
  const rowHeight = row.y1 - row.y0;
  if (bounds.y1 - bounds.y0 >= rowHeight * FULL_ROW_RATIO) return "full";
  const cellCenter = (bounds.y0 + bounds.y1) / 2;
  const rowCenter = (row.y0 + row.y1) / 2;
  return cellCenter < rowCenter ? "top" : "bottom";
}

/** Group text items into visual lines (top→bottom, left→right within a line). */
export function itemsToLines(items: TextItem[]): string[] {
  const sorted = [...items].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const lines: { cy: number; parts: TextItem[] }[] = [];
  for (const item of sorted) {
    const cy = (item.y0 + item.y1) / 2;
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.cy - cy) <= SAME_LINE_TOLERANCE_PT) current.parts.push(item);
    else lines.push({ cy, parts: [item] });
  }
  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x0 - b.x0)
        .map((part) => part.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}
