#!/usr/bin/env tsx
/**
 * Parser CLI.
 *   npm run parser -- parse file.pdf [--json out.json]
 *   npm run parser -- debug file.pdf --output debug/
 *   npm run parser -- stats file.pdf
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsePdf } from "../src/lib/parser";
import { writeDebugArtifacts } from "../src/lib/parser/debug";
import { validateSchedule } from "../src/lib/parser/validator";

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const [command, file, ...rest] = process.argv.slice(2);
  if (!command || !file || !["parse", "debug", "stats"].includes(command)) {
    console.error("usage: parser-cli <parse|debug|stats> <file.pdf> [--output dir] [--json out.json]");
    process.exit(2);
  }

  const bytes = new Uint8Array(await readFile(file));
  const artifacts = await parsePdf(bytes, {
    source_page_url: "file://" + path.resolve(file),
    source_pdf_url: "file://" + path.resolve(file),
    source_kind: "manual",
    downloaded_at: new Date().toISOString(),
  });
  const { schedule } = artifacts;
  const validation = validateSchedule(schedule);

  if (command === "parse") {
    const out = argValue(rest, "--json");
    const json = JSON.stringify(schedule, null, 2);
    if (out) {
      await writeFile(out, json, "utf8");
      console.error(`wrote ${out}`);
    } else {
      console.log(json);
    }
  }

  if (command === "debug") {
    const output = argValue(rest, "--output") ?? "debug";
    const written = await writeDebugArtifacts(artifacts, output);
    console.log(written.join("\n"));
  }

  const perGroup = Object.fromEntries(
    schedule.groups.map((group) => [group.name, schedule.lessons.filter((lesson) => lesson.groups.includes(group.name)).length]),
  );
  const perType = schedule.lessons.reduce<Record<string, number>>((acc, lesson) => {
    acc[lesson.lesson_type] = (acc[lesson.lesson_type] ?? 0) + 1;
    return acc;
  }, {});
  console.error(
    JSON.stringify(
      {
        title: schedule.metadata.pdf_title,
        groups: schedule.groups.length,
        days: schedule.days,
        time_slots: schedule.time_slots.map((slot) => `${slot.start_time}-${slot.end_time}`),
        lessons: schedule.lessons.length,
        uncertain: schedule.lessons.filter((lesson) => lesson.uncertain).length,
        merged_cells: schedule.lessons.filter((lesson) => lesson.groups.length > 1).length,
        per_type: perType,
        per_group: perGroup,
        orphans: artifacts.orphans.length,
        warnings: schedule.warnings,
        validation,
      },
      null,
      2,
    ),
  );
  if (!validation.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
