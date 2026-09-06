/**
 * Source discovery: read the official FCIM schedule page, locate the
 * "Ciclul I, Licență - învățământ cu frecvență" section and resolve the
 * current "Anul I" semester PDF. Nothing here is hard-coded to a file name.
 */
import * as cheerio from "cheerio";
import { config } from "@/lib/config";
import { cleanText } from "@/lib/parser/normalizer";
import { pdfRevisionFromUrl } from "@/lib/source/revision";

export interface DiscoveredPdf {
  pdf_url: string;
  link_text: string;
  row_label: string;
  academic_year: string | null;
  semester: string | null;
  section_title: string;
  parity_note: string | null;
}

const SECTION_RE = /ciclul\s+i\b.*licen[țţt].*frecven[țţt][aă]/i;
const REDUCED_RE = /redus/i;
const ACADEMIC_YEAR_RE = /(\d{4})\s*[/\-–]\s*(\d{4})/;
const SEMESTER_LABEL_RE = /orar(?:ul)?\s+semestrul/i;
const EXAM_RE = /sesiun|examin|reexamin/i;

/** Roman numeral of the requested course year as it appears in "Anul I", "Anul II", ... */
function romanYear(year: number): string {
  return ["I", "II", "III", "IV", "V", "VI"][year - 1] ?? "I";
}

export function discoverPdf(html: string, courseYear = config.courseYear, now = new Date()): DiscoveredPdf {
  const $ = cheerio.load(html);
  const roman = romanYear(courseYear);
  const anulRe = new RegExp(`^anul\\s+${roman}(?![IVX])`, "i");

  const parityNote = findParityNote($);
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
        candidates.push({
          pdf_url: new URL(href, config.schedulePageUrl).toString(),
          link_text: text,
          row_label: rowLabel,
          academic_year: ACADEMIC_YEAR_RE.exec(rowLabel)?.slice(1, 3).join("/") ?? null,
          semester: semesterFromText(`${rowLabel} ${text}`),
          section_title: section.title,
          parity_note: parityNote,
        });
      });
  });

  if (candidates.length === 0) throw new Error(`No "Anul ${roman}" semester PDF link found in the schedule section`);
  return pickCurrent(candidates, now, roman);
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

function semesterFromText(text: string): string | null {
  const roman = /semestrul\s+([IVX]+)\b/i.exec(text);
  if (roman) return `Semestrul ${roman[1].toUpperCase()}`;
  if (/toamn/i.test(text)) return "Semestrul I";
  if (/prim[aă]var/i.test(text)) return "Semestrul II";
  return null;
}

/**
 * When the page lists more than one semester row (e.g. autumn and spring),
 * prefer the one matching the current season; otherwise keep page order.
 * Only once the course year, academic year and season have narrowed the list
 * does the numeric revision suffix break the remaining tie.
 */
function pickCurrent(candidates: DiscoveredPdf[], now: Date, roman: string): DiscoveredPdf {
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
  const seasonRe = autumn ? /toamn|semestrul i$/i : /prim[aă]var|semestrul ii$/i;
  const seasonal = eligible.filter((candidate) => seasonRe.test(`${candidate.row_label} ${candidate.semester ?? ""}`));
  return newestRevision(seasonal.length > 0 ? seasonal : eligible);
}

/**
 * A corrected timetable is republished as `<same name>-<n+1>.pdf` while the
 * superseded link may linger on the page. The first candidate still decides
 * which document wins — page order keeps its meaning across unrelated file
 * names — and is only upgraded to a higher numeric revision of that same name.
 * An unparseable URL never disqualifies a candidate; it just cannot upgrade one.
 */
function newestRevision(candidates: DiscoveredPdf[]): DiscoveredPdf {
  const anchor = candidates[0];
  const anchorRevision = pdfRevisionFromUrl(anchor.pdf_url);
  if (!anchorRevision) return anchor;

  let best = anchor;
  let bestRevision = anchorRevision.revision;
  for (const candidate of candidates.slice(1)) {
    const parsed = pdfRevisionFromUrl(candidate.pdf_url);
    if (!parsed || parsed.family !== anchorRevision.family || parsed.revision <= bestRevision) continue;
    best = candidate;
    bestRevision = parsed.revision;
  }
  return best;
}

/** FCIM's academic year changes with the autumn timetable publication cycle. */
export function academicYearAt(now: Date): string {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const start = month >= 8 ? year : year - 1;
  return `${start}/${start + 1}`;
}
