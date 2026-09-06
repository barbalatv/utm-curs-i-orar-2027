/**
 * Hardened HTTP client for the FCIM page and PDF: allow-listed hosts only,
 * HTTPS only, bounded redirects, timeouts, size cap and conditional requests.
 */
import { config } from "@/lib/config";
import { getLogger } from "@/lib/logger";

const log = getLogger("downloader");

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "network" | "invalid" | "too_large" | "http",
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

export interface FetchedResource {
  url: string;
  finalUrl: string;
  status: number;
  bytes: Uint8Array;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

const OFFICIAL_TIMETABLE_PDF_PATH =
  /^\/wp-content\/uploads\/sites\/24\/\d{4}\/(?:0[1-9]|1[0-2])\/[^/]+\.pdf$/i;

export function isAllowedSourceUrl(rawUrl: string, extraHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const allowed = [...config.allowedHosts, ...extraHosts];
  return allowed.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/** Strict policy for administrator-supplied recovery URLs. */
export function isOfficialTimetablePdfUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (/%2f|%5c/i.test(url.pathname)) return false;
  return (
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "fcim.utm.md" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    OFFICIAL_TIMETABLE_PDF_PATH.test(url.pathname)
  );
}

/** Build a Wayback Machine URL that serves the raw archived resource. */
export function waybackUrl(originalUrl: string): string {
  return `https://${config.waybackHost}/web/2id_/${originalUrl}`;
}

function assertAllowed(url: string, extraHosts: string[], urlPolicy?: (candidate: string) => boolean) {
  if (!isAllowedSourceUrl(url, extraHosts)) {
    throw new SourceFetchError(`Refusing to fetch non-allow-listed URL: ${url}`, "blocked");
  }
  if (urlPolicy && !urlPolicy(url)) {
    throw new SourceFetchError(`Refusing URL outside the official FCIM timetable PDF path: ${url}`, "blocked");
  }
}

/** Fetch with manual redirect handling so every hop is validated against the allow-list. */
export async function fetchResource(
  url: string,
  options: {
    accept: string;
    conditional?: ConditionalHeaders;
    extraHosts?: string[];
    maxBytes?: number;
    /** Optional stricter policy, re-evaluated before every request/redirect hop. */
    urlPolicy?: (candidate: string) => boolean;
  },
): Promise<FetchedResource> {
  const extraHosts = options.extraHosts ?? [];
  const maxBytes = options.maxBytes ?? config.maxPdfBytes;
  let currentUrl = url;

  for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
    assertAllowed(currentUrl, extraHosts, options.urlPolicy);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    const headers: Record<string, string> = {
      "user-agent": config.userAgent,
      accept: options.accept,
      "accept-language": "ro,en;q=0.8",
    };
    if (options.conditional?.etag) headers["if-none-match"] = options.conditional.etag;
    if (options.conditional?.lastModified) headers["if-modified-since"] = options.conditional.lastModified;

    let response: Response;
    try {
      response = await fetch(currentUrl, { headers, redirect: "manual", signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      throw new SourceFetchError(`Network error fetching ${currentUrl}: ${(error as Error).message}`, "network");
    }

    try {
      const mitigation = response.headers.get("cf-mitigated");
      if (mitigation) {
        throw new SourceFetchError(
          `Cloudflare ${mitigation} response (HTTP ${response.status}) from ${currentUrl}`,
          "http",
          response.status,
        );
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new SourceFetchError(`Redirect without Location from ${currentUrl}`, "http", response.status);
        currentUrl = new URL(location, currentUrl).toString();
        log.debug("following redirect", { to: currentUrl, hop });
        continue;
      }

      if (response.status === 304) {
        return {
          url,
          finalUrl: currentUrl,
          status: 304,
          bytes: new Uint8Array(),
          contentType: response.headers.get("content-type"),
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          notModified: true,
        };
      }

      if (!response.ok) {
        throw new SourceFetchError(`HTTP ${response.status} from ${currentUrl}`, "http", response.status);
      }

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new SourceFetchError(`Resource too large: ${declared} bytes`, "too_large");

      const bytes = await readWithLimit(response, maxBytes);
      return {
        url,
        finalUrl: currentUrl,
        status: response.status,
        bytes,
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        notModified: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SourceFetchError(`Too many redirects starting at ${url}`, "http");
}

async function readWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SourceFetchError(`Resource exceeds ${maxBytes} bytes`, "too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export function assertLooksLikePdf(resource: FetchedResource) {
  const header = new TextDecoder("latin1").decode(resource.bytes.subarray(0, 5));
  const typeOk = !resource.contentType || /pdf|octet-stream/i.test(resource.contentType);
  if (!typeOk || header !== "%PDF-") {
    throw new SourceFetchError(
      `Downloaded resource is not a PDF (content-type=${resource.contentType ?? "?"}, header=${JSON.stringify(header)})`,
      "invalid",
    );
  }
}

export async function fetchSchedulePage(url: string, extraHosts: string[] = []): Promise<string> {
  const resource = await fetchResource(url, { accept: "text/html,application/xhtml+xml", extraHosts, maxBytes: 5 * 1024 * 1024 });
  return new TextDecoder("utf-8").decode(resource.bytes);
}

/** Fetch the same published page through WordPress' official read-only REST endpoint. */
export async function fetchWordPressSchedulePage(url: string): Promise<string> {
  const resource = await fetchResource(url, { accept: "application/json", maxBytes: 5 * 1024 * 1024 });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8").decode(resource.bytes));
  } catch (error) {
    throw new SourceFetchError(`Invalid JSON from ${url}: ${(error as Error).message}`, "invalid");
  }

  const page = Array.isArray(payload) ? payload[0] : null;
  const rendered = page && typeof page === "object"
    ? (page as { content?: { rendered?: unknown } }).content?.rendered
    : null;
  if (typeof rendered !== "string" || rendered.trim() === "") {
    throw new SourceFetchError(`WordPress API returned no rendered schedule page from ${url}`, "invalid");
  }
  return rendered;
}

export async function fetchPdf(url: string, conditional: ConditionalHeaders, extraHosts: string[] = []): Promise<FetchedResource> {
  const resource = await fetchResource(url, { accept: "application/pdf,*/*;q=0.8", conditional, extraHosts });
  if (!resource.notModified) assertLooksLikePdf(resource);
  return resource;
}

/** Fetch an administrator-selected official FCIM timetable PDF without creating a generic proxy. */
export async function fetchOfficialTimetablePdf(
  url: string,
  conditional: ConditionalHeaders = {},
): Promise<FetchedResource> {
  const resource = await fetchResource(url, {
    accept: "application/pdf,*/*;q=0.8",
    conditional,
    urlPolicy: isOfficialTimetablePdfUrl,
  });
  if (!resource.notModified) assertLooksLikePdf(resource);
  return resource;
}
