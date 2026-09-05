import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const tempDir = await mkdtemp(path.join(tmpdir(), "fcim-test-"));
process.env.SCHEDULE_DATA_DIR = tempDir;
process.env.DATABASE_URL = "";
process.env.SCHEDULE_WAYBACK_FALLBACK = "0";
process.env.SCHEDULE_SEED_PDF = path.join(tempDir, "missing-seed.pdf");
const SEED_MIRROR_URL = "https://raw.githubusercontent.com/barbalatv/utm-curs-i-orar-2027/main/data/seed/anul_i_semestrul_i-5.pdf";
process.env.SCHEDULE_SEED_PDF_MIRROR_URL = SEED_MIRROR_URL;

const { discoverPdf } = await import("@/lib/source/discovery");
const { isAllowedSourceUrl, fetchPdf, SourceFetchError } = await import("@/lib/source/downloader");
const { checkForUpdates } = await import("@/lib/services/updater");
const { getCurrentSchedule, getSourceState, resetStorageCache } = await import("@/lib/storage");
const { sha256 } = await import("@/lib/parser");

const PAGE_FIXTURE = path.join(__dirname, "fixtures", "orar-page.html");
const PDF_FIXTURE = path.join(__dirname, "fixtures", "anul_i_semestrul_ii-1.pdf");
const PDF_FIXTURE_B = path.join(__dirname, "fixtures", "anul_i_semestrul_i-3.pdf");
const PAGE_URL = "https://fcim.utm.md/procesul-de-studii/orar/";
const PDF_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/03/anul_i_semestrul_ii-1.pdf";
const SPRING_2026 = new Date("2026-03-01T12:00:00.000Z");

let pageHtml: string;
let pdfBytes: Uint8Array;
let pdfBytesB: Uint8Array;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(SPRING_2026);
  pageHtml = await readFile(PAGE_FIXTURE, "utf8");
  pdfBytes = new Uint8Array(await readFile(PDF_FIXTURE));
  pdfBytesB = new Uint8Array(await readFile(PDF_FIXTURE_B));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  vi.useRealTimers();
  await rm(tempDir, { recursive: true, force: true });
});

type Route = { status?: number; body?: Uint8Array | string; headers?: Record<string, string> };

/** Stub global fetch with a tiny router; records requests for assertions. */
function stubFetch(routes: Record<string, Route | ((init: RequestInit) => Route)>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
      calls.push({ url, headers });
      const route = routes[url];
      if (!route) return new Response("not found", { status: 404 });
      const resolved = typeof route === "function" ? route(init ?? {}) : route;
      const body = resolved.body instanceof Uint8Array ? new Uint8Array(resolved.body) : resolved.body ?? "";
      return new Response(resolved.status === 304 ? null : body, { status: resolved.status ?? 200, headers: resolved.headers ?? {} });
    }),
  );
  return calls;
}

describe("test_schedule_page_discovery", () => {
  it("finds the Anul I semester PDF inside the Ciclul I full-time section", () => {
    const found = discoverPdf(pageHtml, 1, SPRING_2026);
    expect(found.pdf_url).toBe(PDF_URL);
    expect(found.link_text).toMatch(/^Anul I\b/);
    expect(found.academic_year).toBe("2025/2026");
    expect(found.semester).toBe("Semestrul II");
    expect(found.section_title).toMatch(/Ciclul I, Licență/);
    expect(found.parity_note).toMatch(/Prima săptămână/);
  });

  it("resolves other course years without touching Anul I", () => {
    expect(discoverPdf(pageHtml, 2, SPRING_2026).pdf_url).toMatch(/anul_ii_/);
    expect(discoverPdf(pageHtml, 3, SPRING_2026).pdf_url).toMatch(/anul_iii_/);
  });

  it("fails loudly when the section is missing", () => {
    expect(() => discoverPdf("<html><body><p>nothing</p></body></html>")).toThrow(/not found/);
  });
});

describe("test_pdf_download", () => {
  it("only allows https URLs on FCIM/UTM hosts", () => {
    expect(isAllowedSourceUrl(PDF_URL)).toBe(true);
    expect(isAllowedSourceUrl("https://utm.md/x.pdf")).toBe(true);
    expect(isAllowedSourceUrl("http://fcim.utm.md/x.pdf")).toBe(false);
    expect(isAllowedSourceUrl("https://evil.com/fcim.utm.md/x.pdf")).toBe(false);
    expect(isAllowedSourceUrl("https://fcim.utm.md.evil.com/x.pdf")).toBe(false);
    expect(isAllowedSourceUrl("https://127.0.0.1/x.pdf")).toBe(false);
  });

  it("downloads a PDF, keeps validators and rejects non-PDF bodies", async () => {
    stubFetch({
      [PDF_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf", etag: '"abc"', "last-modified": "Mon, 01 Sep 2026 10:00:00 GMT" } },
      "https://fcim.utm.md/fake.pdf": { body: "<html>challenge</html>", headers: { "content-type": "text/html" } },
    });
    const resource = await fetchPdf(PDF_URL, {});
    expect(resource.bytes.byteLength).toBe(pdfBytes.byteLength);
    expect(resource.etag).toBe('"abc"');
    await expect(fetchPdf("https://fcim.utm.md/fake.pdf", {})).rejects.toBeInstanceOf(SourceFetchError);
    await expect(fetchPdf("https://example.com/x.pdf", {})).rejects.toThrow(/allow-list/);
  });
});

describe("test_hash_change_detection & test_invalid_pdf_keeps_old_schedule", () => {
  it("bootstraps, detects unchanged hash, applies a changed PDF and keeps the old schedule on failure", async () => {
    resetStorageCache();

    // 1. Cold start: page + PDF available → schedule created.
    stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf", etag: '"v1"' } },
    });
    const first = await checkForUpdates();
    expect(first.outcome).toBe("updated");
    const initial = await getCurrentSchedule();
    expect(initial).not.toBeNull();
    expect(initial!.metadata.source_pdf_url).toBe(PDF_URL);
    expect(initial!.metadata.source_pdf_hash).toBe(sha256(pdfBytes));
    expect(initial!.lessons.length).toBeGreaterThan(300);

    // 2. Same hash → nothing happens, conditional headers are sent.
    const calls = stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf", etag: '"v1"' } },
    });
    const second = await checkForUpdates();
    expect(second.outcome).toBe("unchanged");
    expect(calls.find((call) => call.url === PDF_URL)?.headers["if-none-match"]).toBe('"v1"');

    // 3. Server answers 304 → unchanged without download.
    stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { status: 304, headers: { etag: '"v1"' } },
    });
    expect((await checkForUpdates()).outcome).toBe("unchanged");

    // 4. New PDF content at the same URL → hash differs → re-parsed and replaced.
    stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: pdfBytesB, headers: { "content-type": "application/pdf", etag: '"v2"' } },
    });
    const fourth = await checkForUpdates();
    expect(fourth.outcome).toBe("updated");
    const replaced = await getCurrentSchedule();
    expect(replaced!.metadata.source_pdf_hash).toBe(sha256(pdfBytesB));
    expect(replaced!.metadata.pdf_title).toMatch(/SEMESTRUL I$/);

    // 5. Corrupt PDF → parse fails → previous schedule kept, error recorded.
    stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: new TextEncoder().encode("%PDF-1.7 garbage garbage garbage"), headers: { "content-type": "application/pdf", etag: '"v3"' } },
    });
    const fifth = await checkForUpdates();
    expect(fifth.outcome).toBe("rejected");
    const kept = await getCurrentSchedule();
    expect(kept!.metadata.source_pdf_hash).toBe(sha256(pdfBytesB));
    const state = await getSourceState();
    expect(state.last_result).toBe("rejected");
    expect(state.last_error).toMatch(/parser failed/);
    expect(state.current_pdf_hash).toBe(sha256(pdfBytesB));

    // 6. Site unreachable (Cloudflare 403) → error recorded, schedule still served.
    stubFetch({ [PAGE_URL]: { status: 403, body: "Just a moment...", headers: { "cf-mitigated": "challenge" } } });
    const sixth = await checkForUpdates();
    expect(sixth.outcome).toBe("error");
    expect(sixth.message).toMatch(/Cloudflare challenge/);
    expect((await getCurrentSchedule())!.metadata.source_pdf_hash).toBe(sha256(pdfBytesB));

    // Cache files exist on disk and survive a cold in-memory reset.
    resetStorageCache();
    const reloaded = await getCurrentSchedule();
    expect(reloaded!.metadata.source_pdf_hash).toBe(sha256(pdfBytesB));
  });
});

describe("test_remote_seed_bootstrap", () => {
  it("loads the repository mirror when the live sources and local seed are unavailable", async () => {
    await Promise.all([
      rm(path.join(tempDir, "current_schedule.json"), { force: true }),
      rm(path.join(tempDir, "metadata.json"), { force: true }),
    ]);
    resetStorageCache();

    const wordpressUrl = "https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar&context=view";
    const calls = stubFetch({
      [PAGE_URL]: { status: 403, body: "Just a moment...", headers: { "cf-mitigated": "challenge" } },
      [wordpressUrl]: { status: 403, body: "Just a moment...", headers: { "cf-mitigated": "challenge" } },
      [SEED_MIRROR_URL]: { body: pdfBytes, headers: { "content-type": "application/octet-stream" } },
    });

    const result = await checkForUpdates();
    expect(result.outcome).toBe("seeded");
    expect(calls.some((call) => call.url === SEED_MIRROR_URL)).toBe(true);
    const schedule = await getCurrentSchedule();
    expect(schedule?.metadata.source_kind).toBe("seed");
    expect(schedule?.lessons.length).toBeGreaterThan(300);
  });
});
