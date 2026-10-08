/**
 * Source discovery: read the official FCIM full-time embed or historical
 * "Ciclul I, Licență - învățământ cu frecvență" table and resolve the current
 * semester PDF of the requested course year. Nothing here is hard-coded to a file
 * name, and the function is pure: two courses discover from the same HTML without
 * sharing any state.
 */
import * as cheerio from "cheerio";
import { config } from "@/lib/config";
import { DEFAULT_COURSE_YEAR } from "@/lib/courses";
import { cleanText } from "@/lib/parser/normalizer";
import { isNewerPdfPublication } from "@/lib/source/revision";
import { isOfficialTimetablePdfUrl } from "../../../worker-shared/fcim-policy";

/** Where a discovered semester label comes from; an inference never outranks the PDF's own title. */
export type SemesterSource = "explicit" | "inferred";

export interface DiscoveredPdf {
  pdf_url: string;
  link_text: string;
  row_label: string;
  academic_year: string | null;
  semester: string | null;
  /** "explicit" = printed next to the link, "inferred" = derived from the season and course year. */
  semester_source: SemesterSource | null;
  section_title: string;
  parity_note: string | null;
}

const SECTION_RE = /ciclul\s+i\b.*licen[țţt].*frecven[țţt][aă]/i;
const REDUCED_RE = /redus/i;
const ACADEMIC_YEAR_RE = /(\d{4})\s*[/\-–]\s*(\d{4})/;
const SEMESTER_LABEL_RE = /orar(?:ul)?\s+semestrul/i;
const EXAM_RE = /sesiun|examin|reexamin/i;
const EXPLICIT_SEMESTER_RE = /semestrul\s+([IVX]+)\b/i;
const AUTUMN_RE = /toamn/i;
const SPRING_RE = /prim[aă]var/i;

const ROMAN_STEPS = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
] as const;

/** Roman numeral of a small positive integer, as printed in "Anul II" / "Semestrul III". */
function toRoman(value: number): string {
  let left = value;
  let numeral = "";
  for (const [amount, symbol] of ROMAN_STEPS) {
    while (left >= amount) {
      numeral += symbol;
      left -= amount;
    }
  }
  return numeral;
}

function normalizeCourseYear(courseYear: number): number {
  return Number.isInteger(courseYear) && courseYear > 0 ? courseYear : 1;
}

/**
 * Course year N runs semesters 2N-1 (autumn) and 2N (spring): Anul I → I/II,
 * Anul II → III/IV, and so on. Used only when nothing spells the semester out.
 */
export function semesterForSeason(courseYear: number, season: "autumn" | "spring"): string {
  const year = normalizeCourseYear(courseYear);
  return `Semestrul ${toRoman(year * 2 - (season === "autumn" ? 1 : 0))}`;
}

export function discoverPdf(html: string, courseYear = DEFAULT_COURSE_YEAR, now = new Date()): DiscoveredPdf {
  const $ = cheerio.load(html);
  const year = normalizeCourseYear(courseYear);
  const roman = toRoman(year);
  const anulRe = new RegExp(`^anul\\s+${roman}(?![IVX])`, "i");

  const parityNote = findParityNote($);
  if ($("#orar-fcim-root").length) return discoverEmbeddedPdf($, year, roman, now);
  const section = findSection($);
  if (!section) throw new Error('Section "Ciclul I, Licență - învățământ cu frecvență" not found on schedule page');

  const candidates: DiscoveredPdf[] = [];
  section.container.find("tr").each((_, tr) => {
    const cells = $(tr).find("td,th");
    if (cells.length === 0) return;
    const rowLabel = cleanText(cells.first().text());
    if (!SEMESTER_LABEL_RE.test(rowLabel) || EXAM_RE.test(rowLabel)) return;

    $(tr)
      .find("a[href]")
      .each((__, anchor) => {
        const text = cleanText($(anchor).text());
        const href = $(anchor).attr("href") ?? "";
        if (!anulRe.test(text) || !/\.pdf(\?|$)/i.test(href)) return;
        const semester = semesterFor(text, rowLabel, year);
        candidates.push({
          pdf_url: new URL(href, config.schedulePageUrl).toString(),
          link_text: text,
          row_label: rowLabel,
          academic_year: ACADEMIC_YEAR_RE.exec(rowLabel)?.slice(1, 3).join("/") ?? null,
          semester: semester.value,
          semester_source: semester.source,
          section_title: section.title,
          parity_note: parityNote,
        });
      });
  });

  if (candidates.length === 0) throw new Error(`No "Anul ${roman}" semester PDF link found in the schedule section`);
  return pickCurrent(candidates, now, year, roman);
}

type Container = cheerio.Cheerio<import("domhandler").AnyNode>;

function findSection($: cheerio.CheerioAPI): { title: string; container: Container } | null {
  let found: { title: string; container: Container } | null = null;
  $("[data-title], h1, h2, h3, h4, p, span, strong").each((_, element) => {
    if (found) return;
    const title = cleanText($(element).attr("data-title") ?? $(element).text());
    if (!SECTION_RE.test(title) || REDUCED_RE.test(title)) return;
    // Avia toggles: the title element is followed by the toggle content; fall back to the closest section.
    const section = $(element).closest("section, .togglecontainer, article, div");
    let container: Container = section.length ? section : $(element).parent();
    if (container.find("table").length === 0) {
      const sibling = $(element).nextAll().filter((__, node) => $(node).find("table").length > 0).first();
      if (sibling.length) container = sibling;
    }
    if (container.find("table").length > 0) found = { title, container };
  });
  return found;
}

function findParityNote($: cheerio.CheerioAPI): string | null {
  let note: string | null = null;
  $("p, b, strong").each((_, element) => {
    if (note) return;
    const text = cleanText($(element).text());
    if (/prima\s+s[aă]pt[aă]m[aâ]n[aă].*(par[aă]|impar[aă])/i.test(text)) note = text;
  });
  return note;
}

function explicitSemester(text: string): string | null {
  const roman = EXPLICIT_SEMESTER_RE.exec(text);
  return roman ? `Semestrul ${roman[1].toUpperCase()}` : null;
}

/**
 * A semester printed next to the link ("Anul II semestrul III") outranks the one
 * printed on the row, which outranks the season inference. Rows are frequently
 * labelled with the season alone, and that label says nothing about the course year.
 */
function semesterFor(
  linkText: string,
  rowLabel: string,
  courseYear: number,
): { value: string | null; source: SemesterSource | null } {
  const explicit = explicitSemester(linkText) ?? explicitSemester(rowLabel);
  if (explicit) return { value: explicit, source: "explicit" };

  const labels = `${rowLabel} ${linkText}`;
  if (AUTUMN_RE.test(labels)) return { value: semesterForSeason(courseYear, "autumn"), source: "inferred" };
  if (SPRING_RE.test(labels)) return { value: semesterForSeason(courseYear, "spring"), source: "inferred" };
  return { value: null, source: null };
}

/**
 * When the page lists more than one semester row (e.g. autumn and spring),
 * prefer the one matching the current season; otherwise keep page order.
 * Only once the course year, academic year and season have narrowed the list
 * do publication month and then numeric revision suffix break the remaining tie.
 */
function pickCurrent(candidates: DiscoveredPdf[], now: Date, courseYear: number, roman: string): DiscoveredPdf {
  const expectedYear = academicYearAt(now);
  const dated = candidates.filter((candidate) => candidate.academic_year !== null);
  const currentYear = dated.filter((candidate) => candidate.academic_year === expectedYear);
  if (dated.length > 0 && currentYear.length === 0) {
    const foundYears = [...new Set(dated.map((candidate) => candidate.academic_year))].join(", ");
    throw new Error(`No "Anul ${roman}" PDF for current academic year ${expectedYear} (found ${foundYears})`);
  }

  const eligible = currentYear.length > 0 ? currentYear : candidates;
  const month = now.getUTCMonth() + 1;
  const autumn = month >= 8 || month === 1;
  const seasonRe = autumn ? AUTUMN_RE : SPRING_RE;
  const seasonSemester = semesterForSeason(courseYear, autumn ? "autumn" : "spring");
  const seasonal = eligible.filter(
    (candidate) => seasonRe.test(candidate.row_label) || candidate.semester === seasonSemester,
  );
  return newestRevision(seasonal.length > 0 ? seasonal : eligible);
}

/**
 * A corrected timetable is republished as `<same name>-<n+1>.pdf` while the
 * superseded link may linger on the page. The first candidate still decides
 * which document wins — page order keeps its meaning across unrelated file
 * names — and is only upgraded to a later publication of that same name.
 * An unparseable URL never disqualifies a candidate; it just cannot upgrade one.
 */
function newestRevision(candidates: DiscoveredPdf[]): DiscoveredPdf {
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (isNewerPdfPublication(candidate.pdf_url, best.pdf_url)) best = candidate;
  }
  return best;
}

/**
 * Deterministically extract a bounded, balanced JSON object literal starting at `{`.
 * Correctly accounts for string literals, escape sequences, line breaks, and nested braces.
 * Never executes JavaScript.
 */
export function extractJsonObjectLiteral(source: string, openBraceIndex: number): string | null {
  if (source[openBraceIndex] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const remainder = source.slice(i + 1);
          if (!/^\s*;/.test(remainder)) return null;
          return source.slice(openBraceIndex, i + 1);
        }
      }
    }
  }
  return null;
}

/** Read the new FCIM embed's data literals. Upstream JavaScript is never executed. */
function discoverEmbeddedPdf($: cheerio.CheerioAPI, year: number, roman: string, now: Date): DiscoveredPdf {
  const scripts = $("script").map((_, node) => $(node).html() ?? "").get().join("\n");
  const maps = [...scripts.matchAll(/window\.ORAR_FCIM_EXCEL\s*=\s*(\{[^{}]*\})\s*;/g)];
  const layouts = [...scripts.matchAll(/root\.innerHTML\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g)];
  const dMatches = [...scripts.matchAll(/const\s+D\s*=\s*\{/g)];
  if (maps.length !== 1 || layouts.length !== 1 || dMatches.length !== 1) {
    throw new Error("Invalid or ambiguous FCIM embedded timetable data");
  }

  const dStartIndex = dMatches[0].index! + dMatches[0][0].lastIndexOf("{");
  const dLiteral = extractJsonObjectLiteral(scripts, dStartIndex);
  if (!dLiteral) throw new Error("Invalid or ambiguous FCIM embedded timetable data");

  let links: Record<string, unknown>;
  let layoutRaw: string;
  let metadata: { years?: Array<{ y?: unknown; sem?: unknown }> };
  try {
    links = JSON.parse(maps[0][1]) as Record<string, unknown>;
    layoutRaw = JSON.parse(layouts[0][1]) as string;
    metadata = JSON.parse(dLiteral) as { years?: Array<{ y?: unknown; sem?: unknown }> };
  } catch {
    throw new Error("Invalid or ambiguous FCIM embedded timetable data");
  }

  const layout = cheerio.load(layoutRaw);
  const title = cleanText(layout("h1").text());
  const subtitle = cleanText(layout("p.sub").text());
  const academicYear = ACADEMIC_YEAR_RE.exec(title)?.slice(1, 3).join("/") ?? null;
  if (!/^Orar FCIM\b/.test(title) || !academicYear || !/înv[aă][țţt][aă]m[aâ]nt cu frecven[țţt][aă]/i.test(subtitle) || REDUCED_RE.test(subtitle)) {
    throw new Error("FCIM embed lacks full-time timetable academic-year metadata");
  }

  if (!Array.isArray(metadata.years)) throw new Error("FCIM embed lacks course metadata");
  const courses = metadata.years.filter((entry) => entry.y === roman);
  if (courses.length !== 1 || typeof courses[0].sem !== "string") throw new Error(`Invalid "Anul ${roman}" embedded semester`);
  const semester = `Semestrul ${courses[0].sem}`;
  const autumn = now.getUTCMonth() + 1 >= 8 || now.getUTCMonth() === 0;
  if (semester !== semesterForSeason(year, autumn ? "autumn" : "spring")) throw new Error(`No current semester for "Anul ${roman}" in FCIM embed`);
  const rawUrl = links[`Anul ${roman}`];
  const url = typeof rawUrl === "string" ? rawUrl.trim() : null;
  if (!url || !isOfficialTimetablePdfUrl(url)) throw new Error(`No official "Anul ${roman}" embedded PDF`);
  const file = new URL(url).pathname.split("/").at(-1)!;
  const filePattern = new RegExp(`^anul_${roman.toLowerCase()}_semestrul_${courses[0].sem.toLowerCase()}(?:-\\d+)?\\.pdf$`, "i");
  if (!filePattern.test(file)) throw new Error(`Embedded PDF disagrees with "Anul ${roman}" semester metadata`);
  return pickCurrent([{
    pdf_url: url, link_text: `Anul ${roman}`, row_label: `${title} ${subtitle}`,
    academic_year: academicYear, semester, semester_source: "explicit",
    section_title: subtitle, parity_note: null,
  }], now, year, roman);
}

/** FCIM's academic year changes with the autumn timetable publication cycle. */
export function academicYearAt(now: Date): string {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const start = month >= 8 ? year : year - 1;
  return `${start}/${start + 1}`;
}
