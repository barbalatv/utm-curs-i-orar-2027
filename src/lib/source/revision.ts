/**
 * UTM republishes a corrected timetable under the same file name with an
 * incremented numeric suffix (anul_i_semestrul_i-9.pdf → anul_i_semestrul_i-10.pdf)
 * and sometimes leaves the superseded link in place. Live discovery and packaged
 * seed promotion must read that suffix the same way, so the split lives here once.
 */

export interface PdfRevision {
  /** File name without its numeric revision suffix, lower-cased. */
  family: string;
  /** The numeric suffix. A file published without one counts as revision 0. */
  revision: number;
}

const REVISION_SUFFIX_RE = /^(.+)-(\d+)\.pdf$/i;

/** Split a `*.pdf` file name into the document it belongs to and its numeric revision. */
export function splitPdfRevision(fileName: string): PdfRevision {
  const match = REVISION_SUFFIX_RE.exec(fileName);
  return {
    family: (match?.[1] ?? fileName.replace(/\.pdf$/i, "")).toLowerCase(),
    revision: match ? Number(match[2]) : 0,
  };
}

/**
 * Same split for a full URL. Only the path's last segment is read, so a query
 * string such as `?ver=123` never leaks into the family or the revision number.
 */
export function pdfRevisionFromUrl(rawUrl: string): PdfRevision | null {
  let pathname: string;
  try {
    ({ pathname } = new URL(rawUrl));
  } catch {
    return null;
  }
  const fileName = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (!/\.pdf$/i.test(fileName)) return null;
  return splitPdfRevision(fileName);
}
