/** Canonical FCIM Page API document parsing and endpoint policy for publisher uploads. */

import {
  CANONICAL_PAGE_API_URL,
  isAllowedPageApiUrl,
} from "../../worker-shared/fcim-policy";

export const DEFAULT_PAGE_API_URL = CANONICAL_PAGE_API_URL;

/** WordPress page payloads are small; a much larger body is not the document we asked for. */
export const MAX_PAGE_API_BYTES = 4 * 1024 * 1024;

export class PageApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "PageApiError";
    this.status = status;
  }
}

/**
 * Resolve the configured Page API URL, refusing anything outside the exact approved endpoint.
 */
export function resolvePageApiUrl(configured: string | undefined): string {
  const url = configured ?? DEFAULT_PAGE_API_URL;
  if (!isAllowedPageApiUrl(url)) {
    throw new PageApiError(`Invalid Page API URL: ${url}`);
  }
  return url;
}

export interface PageApiDocument {
  pageId: number | null;
  pageModifiedGmt: string | null;
  renderedHtml: string;
}

/**
 * Pull the three fields the broker is allowed to care about out of a WordPress page payload.
 * Everything else in the document — and every timetable meaning of it — belongs to Render.
 */
export function readPageApiDocument(rawText: string): PageApiDocument {
  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch (err) {
    throw new PageApiError(`Page API returned invalid JSON: ${(err as Error).message}`);
  }

  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== "object") {
    throw new PageApiError("Page API payload is not a page object");
  }

  const record = item as { id?: unknown; modified_gmt?: unknown; content?: { rendered?: unknown } };
  const rendered = record.content?.rendered;
  if (typeof rendered !== "string") {
    throw new PageApiError("Page API payload has no rendered content");
  }

  const pageId =
    typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id > 0 ? record.id : null;

  return {
    pageId,
    pageModifiedGmt: typeof record.modified_gmt === "string" ? record.modified_gmt : null,
    renderedHtml: rendered,
  };
}
