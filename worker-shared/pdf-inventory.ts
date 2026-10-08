/** Transport-only official PDF inventory; no timetable interpretation. */
import { isOfficialTimetablePdfUrl } from "./fcim-policy";

const HREF_PDF_REGEX =
  /href\s*=\s*["']([^"']*(?:\/wp-content\/uploads\/sites\/24\/\d{4}\/(?:0[1-9]|1[0-2])\/[^"'\s<>]+\.pdf))["']/gi;
const RAW_URL_REGEX =
  /(?:^|[\s"'<>])(https:\/\/fcim\.utm\.md\/wp-content\/uploads\/sites\/24\/\d{4}\/(?:0[1-9]|1[0-2])\/[a-zA-Z0-9_\-.]+\.pdf)(?=[\s"'<>&,]|$)/gi;

/**
 * Extract official timetable PDF URLs from HTML without using cheerio or heavy DOM libraries.
 * Scans anchor hrefs, or raw URLs in the embedded data when no hrefs match.
 */
export function extractOfficialPdfUrls(html: string, baseUrl = "https://fcim.utm.md"): string[] {
  const urlSet = new Set<string>();

  HREF_PDF_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = HREF_PDF_REGEX.exec(html)) !== null) {
    const candidateHref = match[1].trim();
    let resolved: string;
    if (candidateHref.startsWith("https://fcim.utm.md/")) {
      resolved = candidateHref;
    } else if (candidateHref.startsWith("/")) {
      resolved = `https://fcim.utm.md${candidateHref}`;
    } else {
      try {
        resolved = new URL(candidateHref, baseUrl).toString();
      } catch {
        continue;
      }
    }
    if (isOfficialTimetablePdfUrl(resolved)) {
      urlSet.add(resolved);
    }
  }

  // Scan raw URLs in embedded data or text, deduplicating with anchor hrefs
  RAW_URL_REGEX.lastIndex = 0;
  while ((match = RAW_URL_REGEX.exec(html)) !== null) {
    const rawMatch = match[1].trim();
    if (isOfficialTimetablePdfUrl(rawMatch)) {
      urlSet.add(rawMatch);
    }
  }

  return Array.from(urlSet);
}
