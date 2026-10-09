/**
 * Worker-side transport URL policy and PDF URL extractor.
 *
 * Strict restrictions:
 * - NO cheerio
 * - NO pdfjs-dist
 * - NO canvas
 * - NO timetable parser / validator
 * - Pure regex and URL checks
 */

export {
  isAllowedPageApiUrl,
  isOfficialTimetablePdfUrl,
} from "../../worker-shared/fcim-policy";

export { extractOfficialPdfUrls } from "../../worker-shared/pdf-inventory";

/**
 * Extract filename from a valid official timetable PDF URL.
 */
export function getPdfFilename(urlStr: string): string {
  const slashIdx = urlStr.lastIndexOf("/");
  if (slashIdx !== -1) {
    return urlStr.slice(slashIdx + 1);
  }
  return "timetable.pdf";
}
