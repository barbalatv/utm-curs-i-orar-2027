/**
 * Stage 2: table geometry. Classifies fill rectangles into grid lines and cell
 * backgrounds, merges collinear segments, and answers "which drawn borders
 * enclose this point?" – the primitive on which merged-cell detection rests.
 */
import type { FillRect, TextItem } from "./pdf-extract";

/** Fill rectangles thinner than this are treated as ruling lines, not backgrounds. */
const LINE_THICKNESS_PT = 1.5;
/** Segments closer than this on the perpendicular axis are considered the same line. */
const COLLINEAR_TOLERANCE_PT = 0.6;
/** Small overshoot allowed when merging touching segments. */
const JOIN_GAP_PT = 0.8;

export interface LineSegment {
  /** Position on the axis perpendicular to the line (x for vertical, y for horizontal). */
  at: number;
  from: number;
  to: number;
}

export interface Grid {
  vertical: LineSegment[];
  horizontal: LineSegment[];
  backgrounds: FillRect[];
}

export interface CellBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function buildGrid(rects: FillRect[]): Grid {
  const vertical: LineSegment[] = [];
  const horizontal: LineSegment[] = [];
  const backgrounds: FillRect[] = [];

  for (const rect of rects) {
    const width = rect.x1 - rect.x0;
    const height = rect.y1 - rect.y0;
    if (width < LINE_THICKNESS_PT && height >= LINE_THICKNESS_PT) {
      vertical.push({ at: (rect.x0 + rect.x1) / 2, from: rect.y0, to: rect.y1 });
    } else if (height < LINE_THICKNESS_PT && width >= LINE_THICKNESS_PT) {
      horizontal.push({ at: (rect.y0 + rect.y1) / 2, from: rect.x0, to: rect.x1 });
    } else if (width >= LINE_THICKNESS_PT && height >= LINE_THICKNESS_PT) {
      backgrounds.push(rect);
    }
  }

  return {
    vertical: mergeSegments(vertical),
    horizontal: mergeSegments(horizontal),
    backgrounds,
  };
}

/**
 * Merge overlapping/touching collinear segments so partial borders behave like one line.
 *
 * Segments are first bucketed by their perpendicular position, then merged *within* a
 * bucket in `from` order. Doing it in one pass over a list sorted by `at` would let a
 * segment that merely shares the bucket (a border drawn 0.1 pt aside) swallow the gaps
 * between the others – and those gaps are exactly what marks a merged (colspan/rowspan)
 * cell, whose internal borders are simply not drawn.
 */
export function mergeSegments(segments: LineSegment[]): LineSegment[] {
  const merged: LineSegment[] = [];
  for (const bucket of bucketByPosition(segments)) {
    // One representative position per bucket keeps cell keys stable when the same
    // border is drawn as several rectangles rounded slightly differently.
    const at = representativePosition(bucket);
    let run: LineSegment | null = null;
    for (const segment of [...bucket].sort((a, b) => a.from - b.from)) {
      if (run && segment.from <= run.to + JOIN_GAP_PT) {
        run.to = Math.max(run.to, segment.to);
      } else {
        run = { at, from: segment.from, to: segment.to };
        merged.push(run);
      }
    }
  }
  return merged.sort((a, b) => a.at - b.at || a.from - b.from);
}

/**
 * Collinear segments, grouped by position. A border can be painted as several
 * rectangles a fraction of a point apart (solid edge + dashed overlay), so
 * neighbours within COLLINEAR_TOLERANCE_PT chain into the same bucket, bounded
 * by the thickness a single border may plausibly have.
 */
function bucketByPosition(segments: LineSegment[]): LineSegment[][] {
  const buckets: LineSegment[][] = [];
  let previous = Number.NaN;
  let start = Number.NaN;
  for (const segment of [...segments].sort((a, b) => a.at - b.at)) {
    const current = buckets[buckets.length - 1];
    const chains =
      current !== undefined && segment.at - previous <= COLLINEAR_TOLERANCE_PT && segment.at - start <= LINE_THICKNESS_PT;
    if (chains) {
      current.push(segment);
    } else {
      buckets.push([segment]);
      start = segment.at;
    }
    previous = segment.at;
  }
  return buckets;
}

/** Length-weighted centre of a bucket: the long ruling wins over short stubs. */
function representativePosition(bucket: LineSegment[]): number {
  let weight = 0;
  let sum = 0;
  for (const segment of bucket) {
    const length = Math.max(segment.to - segment.from, 0.01);
    weight += length;
    sum += segment.at * length;
  }
  return round2(sum / weight);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Find the nearest drawn borders around a point. Returns null when the point
 * is not enclosed on all four sides (e.g. document title outside the table).
 */
export function enclosingCell(grid: Grid, cx: number, cy: number): CellBounds | null {
  // Near zero on purpose: a ruling the point sits *on* still bounds it, so text drawn
  // across a row separator stays in the row it mostly covers instead of merging both.
  const epsilon = 0.01;
  let left = -Infinity;
  let right = Infinity;
  let top = -Infinity;
  let bottom = Infinity;

  for (const line of grid.vertical) {
    if (line.from > cy || line.to < cy) continue;
    if (line.at < cx - epsilon && line.at > left) left = line.at;
    if (line.at > cx + epsilon && line.at < right) right = line.at;
  }
  for (const line of grid.horizontal) {
    if (line.from > cx || line.to < cx) continue;
    if (line.at < cy - epsilon && line.at > top) top = line.at;
    if (line.at > cy + epsilon && line.at < bottom) bottom = line.at;
  }

  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { x0: round1(left), y0: round1(top), x1: round1(right), y1: round1(bottom) };
}

export function cellKey(bounds: CellBounds): string {
  return `${bounds.x0},${bounds.y0},${bounds.x1},${bounds.y1}`;
}

export function centerOf(item: TextItem): { cx: number; cy: number } {
  return { cx: (item.x0 + item.x1) / 2, cy: (item.y0 + item.y1) / 2 };
}

export function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Background fill (if any) that covers the centre of the given bounds. */
export function backgroundAt(grid: Grid, bounds: CellBounds): string | null {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  for (const rect of grid.backgrounds) {
    if (rect.color === "#ffffff") continue;
    if (rect.x0 <= cx && rect.x1 >= cx && rect.y0 <= cy && rect.y1 >= cy) return rect.color;
  }
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
