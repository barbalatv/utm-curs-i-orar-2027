/**
 * Debug artefacts for the parser: detected_groups.json, detected_days.json,
 * cells.json, lessons.json and page_debug.svg – an overlay of column/row
 * boundaries and lesson bounding boxes drawn over the extracted text, so the
 * geometry can be inspected in any browser without native image libraries.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ParseArtifacts } from "./index";

const SCALE = 3;
const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

export async function writeDebugArtifacts(artifacts: ParseArtifacts, outputDir: string): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const files: [string, string][] = [
    ["detected_groups.json", JSON.stringify(artifacts.layout.groups, null, 2)],
    ["detected_days.json", JSON.stringify({ days: artifacts.layout.days, rows: artifacts.layout.rows }, null, 2)],
    ["cells.json", JSON.stringify(artifacts.cells.map(({ key, bounds, lines, groups, day, rows, background }) => ({ key, bounds, lines, groups, day, slots: rows.map((row) => row.start_time), background })), null, 2)],
    ["orphans.json", JSON.stringify(artifacts.orphans, null, 2)],
    ["lessons.json", JSON.stringify(artifacts.schedule.lessons, null, 2)],
    ["page_debug.svg", renderOverlaySvg(artifacts)],
  ];
  const written: string[] = [];
  for (const [name, content] of files) {
    const target = path.join(outputDir, name);
    await writeFile(target, content, "utf8");
    written.push(target);
  }
  return written;
}

export function renderOverlaySvg(artifacts: ParseArtifacts): string {
  const { layout, cells, schedule } = artifacts;
  const page = artifacts.pages.find((item) => item.page === (cells[0]?.page ?? 1)) ?? artifacts.pages[0];
  const contentBottom = Math.max(layout.bounds.y1 + 20, ...page.texts.map((text) => text.y1)) + 10;
  const width = page.width * SCALE;
  const height = Math.min(page.height, contentBottom) * SCALE;
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">`);
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // Raw text layer (light grey) for orientation.
  for (const text of page.texts) {
    const fontSize = Math.max(3, (text.y1 - text.y0) * SCALE * 0.9);
    parts.push(`<text x="${text.x0 * SCALE}" y="${text.y1 * SCALE}" font-size="${fontSize.toFixed(1)}" fill="#6b7280">${escapeXml(text.text)}</text>`);
  }

  // Day blocks.
  layout.days.forEach((block, index) => {
    const color = PALETTE[index % PALETTE.length];
    parts.push(`<rect x="${layout.bounds.x0 * SCALE}" y="${block.y0 * SCALE}" width="${(layout.bounds.x1 - layout.bounds.x0) * SCALE}" height="${(block.y1 - block.y0) * SCALE}" fill="${color}" fill-opacity="0.04" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<text x="${(layout.bounds.x1 + 2) * SCALE}" y="${(block.y0 + 6) * SCALE}" font-size="14" fill="${color}" font-weight="bold">${block.day}</text>`);
  });

  // Time-slot rows.
  for (const row of layout.rows) {
    parts.push(`<line x1="${layout.bounds.x0 * SCALE}" y1="${row.y0 * SCALE}" x2="${layout.bounds.x1 * SCALE}" y2="${row.y0 * SCALE}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${(layout.bounds.x0 - 24) * SCALE}" y="${((row.y0 + row.y1) / 2 + 1) * SCALE}" font-size="7" fill="#b45309">${row.start_time}</text>`);
  }

  // Group columns.
  for (const group of layout.groups) {
    parts.push(`<line x1="${group.x0 * SCALE}" y1="${layout.bounds.y0 * SCALE}" x2="${group.x0 * SCALE}" y2="${layout.bounds.y1 * SCALE}" stroke="#2563eb" stroke-width="1"/>`);
    parts.push(`<text x="${(group.x0 + 1) * SCALE}" y="${(layout.bounds.y0 - 2) * SCALE}" font-size="8" fill="#1d4ed8" font-weight="bold">${escapeXml(group.name)}</text>`);
  }
  const lastGroup = layout.groups[layout.groups.length - 1];
  if (lastGroup) {
    parts.push(`<line x1="${lastGroup.x1 * SCALE}" y1="${layout.bounds.y0 * SCALE}" x2="${lastGroup.x1 * SCALE}" y2="${layout.bounds.y1 * SCALE}" stroke="#2563eb" stroke-width="1"/>`);
  }

  // Lesson boxes: green = confident, red = uncertain, purple = merged across ≥2 groups.
  for (const lesson of schedule.lessons) {
    const g = lesson.geometry;
    const color = lesson.uncertain ? "#dc2626" : lesson.groups.length > 1 ? "#9333ea" : "#16a34a";
    parts.push(`<rect x="${g.x0 * SCALE}" y="${g.y0 * SCALE}" width="${(g.x1 - g.x0) * SCALE}" height="${(g.y1 - g.y0) * SCALE}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="1"><title>${escapeXml(`${lesson.day} ${lesson.start_time}-${lesson.end_time} | ${lesson.groups.join(", ")} | ${lesson.subject} | ${lesson.teacher ?? "-"} | ${lesson.room ?? "-"} | ${lesson.lesson_type}`)}</title></rect>`);
  }

  for (const orphan of artifacts.orphans) {
    const b = orphan.bounds;
    parts.push(`<rect x="${b.x0 * SCALE}" y="${b.y0 * SCALE}" width="${(b.x1 - b.x0) * SCALE}" height="${(b.y1 - b.y0) * SCALE}" fill="none" stroke="#f97316" stroke-width="1.5" stroke-dasharray="2 2"/>`);
  }

  parts.push("</svg>");
  return parts.join("\n");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
