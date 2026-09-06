import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const NEW_SEED_HASH = "52e7f14be27a996e17d0614c1f9fe769d63bdf76876fce6d4fc60f026bf8c015";
const tempDir = await mkdtemp(path.join(tmpdir(), "fcim-test-"));
const packagedSeedPath = path.join(tempDir, "packaged-seed.pdf");
process.env.SCHEDULE_DATA_DIR = tempDir;
process.env.DATABASE_URL = "";
process.env.SCHEDULE_WAYBACK_FALLBACK = "0";
process.env.SCHEDULE_SEED_PDF = packagedSeedPath;
process.env.SCHEDULE_ADMIN_TOKEN = "test-admin-token";
const SEED_MIRROR_URL = "https://raw.githubusercontent.com/barbalatv/utm-curs-i-orar-2027/main/data/seed/anul_i_semestrul_i-9.pdf";
process.env.SCHEDULE_SEED_PDF_MIRROR_URL = SEED_MIRROR_URL;
process.env.SCHEDULE_SEED_PDF_SHA256 = NEW_SEED_HASH;

const { NextRequest: NextRequestCtor } = await import("next/server");
const { discoverPdf } = await import("@/lib/source/discovery");
const { isAllowedSourceUrl, isOfficialTimetablePdfUrl, fetchPdf, SourceFetchError } =
  await import("@/lib/source/downloader");
const { checkForUpdates, refreshFromExplicitPdf } = await import("@/lib/services/updater");
const {
  getCurrentSchedule,
  getSourceState,
  replaceCurrentSchedule,
  resetStorageCache,
  saveSourceState,
} = await import("@/lib/storage");
const { parsePdf, sha256 } = await import("@/lib/parser");
const { validateSchedule } = await import("@/lib/parser/validator");
const { buildStatus } = await import("@/lib/services/schedule-service");
const adminRefresh = (await import("@/app/api/admin/refresh/route")).POST;

const PAGE_FIXTURE = path.join(__dirname, "fixtures", "orar-page.html");
const PDF_FIXTURE = path.join(__dirname, "fixtures", "anul_i_semestrul_ii-1.pdf");
const PDF_FIXTURE_B = path.join(__dirname, "fixtures", "anul_i_semestrul_i-3.pdf");
const OLD_SEED_FIXTURE = path.join(__dirname, "fixtures", "anul_i_semestrul_i-5.pdf");
const NEW_SEED_FIXTURE = path.join(__dirname, "..", "data", "seed", "anul_i_semestrul_i-9.pdf");
const PAGE_URL = "https://fcim.utm.md/procesul-de-studii/orar/";
const WORDPRESS_URL = "https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar&context=view";
const PDF_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/03/anul_i_semestrul_ii-1.pdf";
const OLD_SEED_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-5.pdf";
const NEW_SEED_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-9.pdf";
const SPRING_2026 = new Date("2026-03-01T12:00:00.000Z");

let pageHtml: string;
let pdfBytes: Uint8Array;
let pdfBytesB: Uint8Array;
let oldSeedBytes: Uint8Array;
let newSeedBytes: Uint8Array;
let oldSeedSchedule: Awaited<ReturnType<typeof parsePdf>>["schedule"];

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(SPRING_2026);
  const [html, fixture, fixtureB, oldSeed, newSeed] = await Promise.all([
    readFile(PAGE_FIXTURE, "utf8"),
    readFile(PDF_FIXTURE),
    readFile(PDF_FIXTURE_B),
    readFile(OLD_SEED_FIXTURE),
    readFile(NEW_SEED_FIXTURE),
  ]);
  pageHtml = html;
  pdfBytes = new Uint8Array(fixture);
  pdfBytesB = new Uint8Array(fixtureB);
  oldSeedBytes = new Uint8Array(oldSeed);
  newSeedBytes = new Uint8Array(newSeed);
  ({ schedule: oldSeedSchedule } = await parsePdf(oldSeedBytes, {
    source_page_url: PAGE_URL,
    source_pdf_url: OLD_SEED_URL,
    source_kind: "seed",
    downloaded_at: "2026-09-01T00:00:00.000Z",
  }));
});

beforeEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all([
    rm(path.join(tempDir, "current_schedule.json"), { force: true }),
    rm(path.join(tempDir, "metadata.json"), { force: true }),
    rm(packagedSeedPath, { force: true }),
  ]);
  resetStorageCache();
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cloudflareDiscoveryRoutes(): Record<string, Route> {
  return {
    [PAGE_URL]: {
      status: 403,
      body: "Just a moment...",
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
    },
    [WORDPRESS_URL]: {
      status: 403,
      body: "Just a moment...",
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
    },
  };
}

async function persistOldSchedule(sourceKind: "seed" | "live" | "manual" = "seed") {
  const schedule = {
    ...oldSeedSchedule,
    metadata: { ...oldSeedSchedule.metadata, source_kind: sourceKind },
  };
  await replaceCurrentSchedule(schedule);
  await saveSourceState({
    current_pdf_url: OLD_SEED_URL,
    current_pdf_hash: schedule.metadata.source_pdf_hash,
    last_check_at: "2026-09-01T00:00:00.000Z",
    last_success_at: "2026-09-01T00:00:00.000Z",
    last_result: sourceKind === "seed" ? "seeded" : "updated",
    academic_year: schedule.metadata.academic_year,
    semester: schedule.metadata.semester,
  });
  return schedule;
}

function adminRequest(body: unknown, token = "test-admin-token"): NextRequest {
  return new NextRequestCtor("http://localhost:8000/api/admin/refresh", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function responseJson<T>(response: Response, status = 200): Promise<T> {
  const payload = (await response.json()) as T;
  expect(response.status, JSON.stringify(payload)).toBe(status);
  return payload;
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

  it("accepts only the exact official FCIM timetable-PDF URL shape for explicit recovery", () => {
    expect(isOfficialTimetablePdfUrl(NEW_SEED_URL)).toBe(true);
    expect(isOfficialTimetablePdfUrl("https://example.com/wp-content/uploads/sites/24/2026/09/x.pdf")).toBe(false);
    expect(isOfficialTimetablePdfUrl("https://localhost/wp-content/uploads/sites/24/2026/09/x.pdf")).toBe(false);
    expect(isOfficialTimetablePdfUrl("https://127.0.0.1/wp-content/uploads/sites/24/2026/09/x.pdf")).toBe(false);
    expect(isOfficialTimetablePdfUrl("http://fcim.utm.md/wp-content/uploads/sites/24/2026/09/x.pdf")).toBe(false);
    expect(isOfficialTimetablePdfUrl("https://fcim.utm.md/other/x.pdf")).toBe(false);
    expect(isOfficialTimetablePdfUrl("https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/x.txt")).toBe(false);
    expect(isOfficialTimetablePdfUrl("https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/..%2fprivate.pdf")).toBe(false);
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

  it("reports a Cloudflare challenge before treating its body as source content", async () => {
    stubFetch({
      [PDF_URL]: {
        status: 200,
        body: "<html>Just a moment...</html>",
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      },
    });
    await expect(fetchPdf(PDF_URL, {})).rejects.toThrow(/Cloudflare challenge/);
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
    const discoveryFailure = await getSourceState();
    expect(discoveryFailure.last_result).toBe("error");
    expect(discoveryFailure.last_error).toMatch(/Cloudflare challenge/);
    expect(discoveryFailure.last_error_at).not.toBeNull();

    // Cache files exist on disk and survive a cold in-memory reset.
    resetStorageCache();
    const reloaded = await getCurrentSchedule();
    expect(reloaded!.metadata.source_pdf_hash).toBe(sha256(pdfBytesB));
  });
});

describe("test_parser_upgrade_reparses_cached_pdf", () => {
  it("re-parses an unchanged PDF when the cache came from an older parser", async () => {
    resetStorageCache();
    stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf", etag: '"v1"' } },
    });
    expect((await checkForUpdates()).outcome).toBe("updated");

    // Pretend the cache on disk was written by the previous parser release. Fixing a
    // parsing bug must reach users without waiting for the university to republish.
    const cached = await getCurrentSchedule();
    await replaceCurrentSchedule({ ...cached!, metadata: { ...cached!.metadata, parser_version: "0.0.1" } });
    resetStorageCache();

    const calls = stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf", etag: '"v1"' } },
    });
    const upgraded = await checkForUpdates();
    expect(upgraded.outcome).toBe("updated");
    // The conditional headers are dropped, otherwise a 304 would hide the PDF body.
    expect(calls.find((call) => call.url === PDF_URL)?.headers["if-none-match"]).toBeUndefined();
    expect((await getCurrentSchedule())!.metadata.parser_version).not.toBe("0.0.1");

    // A second run finds a matching parser version again and stops re-parsing.
    stubFetch({
      [PAGE_URL]: { body: pageHtml, headers: { "content-type": "text/html" } },
      [PDF_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf", etag: '"v1"' } },
    });
    expect((await checkForUpdates()).outcome).toBe("unchanged");
  });
});

describe("automatic update queueing", () => {
  it("runs a force refresh after an in-flight ordinary check and preserves force semantics", async () => {
    const firstPageStarted = deferred();
    const releaseFirstPage = deferred();
    const events: string[] = [];
    const pdfHeaders: Headers[] = [];
    let pageRequests = 0;
    let pdfRequests = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === PAGE_URL) {
          const request = ++pageRequests;
          events.push(`page-${request}-start`);
          if (request === 1) {
            firstPageStarted.resolve();
            await releaseFirstPage.promise;
          }
          events.push(`page-${request}-response`);
          return new Response(pageHtml, { headers: { "content-type": "text/html" } });
        }
        if (url === PDF_URL) {
          const request = ++pdfRequests;
          events.push(`pdf-${request}`);
          pdfHeaders.push(new Headers(init?.headers));
          return new Response(new Uint8Array(pdfBytes), {
            headers: { "content-type": "application/pdf", etag: '"queue-v1"' },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const ordinary = checkForUpdates();
    await firstPageStarted.promise;
    const forced = checkForUpdates({ force: true });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["page-1-start"]);

    releaseFirstPage.resolve();
    const ordinaryResult = await ordinary;
    const forcedResult = await forced;

    expect(events).toEqual([
      "page-1-start",
      "page-1-response",
      "pdf-1",
      "page-2-start",
      "page-2-response",
      "pdf-2",
    ]);
    expect(ordinaryResult.outcome).toBe("updated");
    // The second run sees the same hash but still reparses because its force flag survived queueing.
    expect(forcedResult.outcome).toBe("updated");
    expect(forcedResult.source_pdf_hash).toBe(sha256(pdfBytes));
    expect(pageRequests).toBe(2);
    expect(pdfRequests).toBe(2);
    expect(pdfHeaders[1]?.get("if-none-match")).toBeNull();
  });

  it("continues to coalesce overlapping ordinary automatic checks", async () => {
    const firstPageStarted = deferred();
    const releaseFirstPage = deferred();
    let pageRequests = 0;
    let pdfRequests = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === PAGE_URL) {
          pageRequests += 1;
          firstPageStarted.resolve();
          await releaseFirstPage.promise;
          return new Response(pageHtml, { headers: { "content-type": "text/html" } });
        }
        if (url === PDF_URL) {
          pdfRequests += 1;
          return new Response(new Uint8Array(pdfBytes), { headers: { "content-type": "application/pdf" } });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const first = checkForUpdates();
    await firstPageStarted.promise;
    const second = checkForUpdates();
    await Promise.resolve();
    expect(pageRequests).toBe(1);

    releaseFirstPage.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult.outcome).toBe("updated");
    expect(pageRequests).toBe(1);
    expect(pdfRequests).toBe(1);
  });
});

describe("test_remote_seed_bootstrap", () => {
  it("loads the repository mirror when the live sources and local seed are unavailable", async () => {
    await Promise.all([
      rm(path.join(tempDir, "current_schedule.json"), { force: true }),
      rm(path.join(tempDir, "metadata.json"), { force: true }),
    ]);
    resetStorageCache();

    const calls = stubFetch({
      [PAGE_URL]: { status: 403, body: "Just a moment...", headers: { "cf-mitigated": "challenge" } },
      [WORDPRESS_URL]: { status: 403, body: "Just a moment...", headers: { "cf-mitigated": "challenge" } },
      [SEED_MIRROR_URL]: { body: newSeedBytes, headers: { "content-type": "application/octet-stream" } },
    });

    const result = await checkForUpdates();
    expect(result.outcome).toBe("seeded");
    expect(calls.some((call) => call.url === SEED_MIRROR_URL)).toBe(true);
    const schedule = await getCurrentSchedule();
    expect(schedule?.metadata.source_kind).toBe("seed");
    expect(schedule?.metadata.source_pdf_hash).toBe(NEW_SEED_HASH);
    expect(schedule?.groups).toHaveLength(41);
    expect(schedule?.lessons).toHaveLength(449);
  });

  it("rejects changed mirror bytes without claiming the official seed provenance", async () => {
    expect(sha256(pdfBytes)).not.toBe(NEW_SEED_HASH);
    const calls = stubFetch({
      ...cloudflareDiscoveryRoutes(),
      [SEED_MIRROR_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf" } },
    });

    const result = await checkForUpdates();
    expect(result.outcome).toBe("error");
    expect(result.message).toMatch(/seed mirror SHA-256 mismatch/);
    expect(calls.some((call) => call.url === SEED_MIRROR_URL)).toBe(true);
    expect(await getCurrentSchedule()).toBeNull();

    const failedState = await getSourceState();
    expect(failedState).toMatchObject({
      current_pdf_url: null,
      current_pdf_hash: null,
      last_result: "error",
    });
    expect(failedState.last_error).toMatch(/Cloudflare challenge/);
    expect(failedState.last_error).toMatch(/seed mirror SHA-256 mismatch/);

    // A known-good schedule prevents cold-start fallback entirely and remains untouched.
    const previous = await persistOldSchedule("live");
    const cachedCalls = stubFetch({
      ...cloudflareDiscoveryRoutes(),
      [SEED_MIRROR_URL]: { body: pdfBytes, headers: { "content-type": "application/pdf" } },
    });
    expect((await checkForUpdates()).outcome).toBe("error");
    expect(cachedCalls.some((call) => call.url === SEED_MIRROR_URL)).toBe(false);
    expect((await getCurrentSchedule())?.metadata.source_pdf_hash).toBe(previous.metadata.source_pdf_hash);
  });
});

describe("authenticated explicit-PDF recovery", () => {
  it("requires the configured administrator token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("an unauthorized request must not reach the network");
      }),
    );
    const payload = await responseJson<{ error: string }>(await adminRefresh(adminRequest({}, "wrong-token")), 401);
    expect(payload.error).toBe("Unauthorized");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-FCIM, local, IP, HTTP and non-timetable URLs before fetching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("a rejected URL must not reach the network");
      }),
    );
    const invalidUrls = [
      "https://example.com/wp-content/uploads/sites/24/2026/09/x.pdf",
      "https://localhost/wp-content/uploads/sites/24/2026/09/x.pdf",
      "https://127.0.0.1/wp-content/uploads/sites/24/2026/09/x.pdf",
      "http://fcim.utm.md/wp-content/uploads/sites/24/2026/09/x.pdf",
      "https://fcim.utm.md/private/x.pdf",
    ];
    for (const pdfUrl of invalidUrls) {
      const payload = await responseJson<{ error: string }>(
        await adminRefresh(adminRequest({ pdf_url: pdfUrl, force: true })),
        400,
      );
      expect(payload.error).toMatch(/HTTPS fcim\.utm\.md timetable PDF/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a redirect off the strict source and challenge HTML without changing the schedule", async () => {
    const old = await persistOldSchedule("live");
    const redirectCalls = stubFetch({
      [NEW_SEED_URL]: {
        status: 302,
        headers: { location: "https://example.com/redirected.pdf" },
      },
    });
    const redirected = await refreshFromExplicitPdf({ pdfUrl: NEW_SEED_URL, force: true });
    expect(redirected.outcome).toBe("error");
    expect(redirected.message).toMatch(/allow-list|official FCIM timetable PDF path/);
    expect(redirectCalls.map((call) => call.url)).toEqual([NEW_SEED_URL]);
    expect((await getCurrentSchedule())?.metadata.source_pdf_hash).toBe(old.metadata.source_pdf_hash);

    stubFetch({
      [NEW_SEED_URL]: {
        body: "<html>Just a moment...</html>",
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      },
    });
    const challenged = await refreshFromExplicitPdf({ pdfUrl: NEW_SEED_URL, force: true });
    expect(challenged.outcome).toBe("error");
    expect(challenged.message).toMatch(/Cloudflare challenge/);
    expect((await getCurrentSchedule())?.metadata.source_pdf_hash).toBe(old.metadata.source_pdf_hash);

    stubFetch({
      [NEW_SEED_URL]: {
        body: "<html>not really a PDF</html>",
        headers: { "content-type": "application/pdf" },
      },
    });
    const masquerading = await refreshFromExplicitPdf({ pdfUrl: NEW_SEED_URL, force: true });
    expect(masquerading.outcome).toBe("error");
    expect(masquerading.message).toMatch(/not a PDF/);
    expect((await getCurrentSchedule())?.metadata.source_pdf_hash).toBe(old.metadata.source_pdf_hash);
  });

  it("keeps the previous schedule when the explicit PDF cannot be parsed", async () => {
    const old = await persistOldSchedule("live");
    stubFetch({
      [NEW_SEED_URL]: {
        body: new TextEncoder().encode("%PDF-1.7 invalid timetable"),
        headers: { "content-type": "application/pdf" },
      },
    });
    const result = await refreshFromExplicitPdf({ pdfUrl: NEW_SEED_URL, force: true });
    expect(result.outcome).toBe("rejected");
    expect(result.message).toMatch(/parser failed/);
    expect((await getCurrentSchedule())?.metadata.source_pdf_hash).toBe(old.metadata.source_pdf_hash);
  });

  it("keeps the previous schedule when real parsing succeeds but validation rejects the candidate", async () => {
    const old = await persistOldSchedule("live");
    const inflated = { ...old, lessons: [...old.lessons, ...old.lessons] };
    await replaceCurrentSchedule(inflated);
    stubFetch({
      [NEW_SEED_URL]: {
        body: newSeedBytes,
        headers: { "content-type": "application/pdf" },
      },
    });

    const result = await refreshFromExplicitPdf({ pdfUrl: NEW_SEED_URL, force: true });
    expect(result.outcome).toBe("rejected");
    expect(result.message).toMatch(/validation failed: lesson count dropped/);
    expect((await getCurrentSchedule())?.lessons).toHaveLength(inflated.lessons.length);
  });

  it("recovers through the real pipeline while preserving the discovery failure diagnostic", async () => {
    const old = await persistOldSchedule("seed");
    stubFetch(cloudflareDiscoveryRoutes());
    const automatic = await checkForUpdates();
    expect(automatic.outcome).toBe("error");
    expect((await getSourceState()).last_error).toMatch(/Cloudflare challenge/);

    stubFetch({
      [NEW_SEED_URL]: {
        body: newSeedBytes,
        headers: { "content-type": "application/pdf", etag: '"seed-9"' },
      },
    });
    const result = await responseJson<{
      outcome: string;
      pdf_url: string;
      source_pdf_hash: string;
      groups: number;
      lessons: number;
    }>(await adminRefresh(adminRequest({ pdf_url: NEW_SEED_URL, force: true })));
    expect(result).toMatchObject({
      outcome: "updated",
      pdf_url: NEW_SEED_URL,
      source_pdf_hash: NEW_SEED_HASH,
      groups: 41,
      lessons: 449,
    });

    const served = await getCurrentSchedule();
    expect(served?.metadata).toMatchObject({
      source_pdf_url: NEW_SEED_URL,
      source_pdf_hash: NEW_SEED_HASH,
      source_kind: "manual",
    });
    expect(served?.groups).toHaveLength(41);
    expect(served?.lessons).toHaveLength(449);
    expect(validateSchedule(served!, { previousLessonCount: old.lessons.length }).ok).toBe(true);

    const state = await getSourceState();
    expect(state).toMatchObject({
      current_pdf_url: NEW_SEED_URL,
      current_pdf_hash: NEW_SEED_HASH,
      last_result: "error",
    });
    expect(state.last_error).toMatch(/Cloudflare challenge/);

    const status = await buildStatus();
    expect(status.schedule).toMatchObject({
      source_pdf_url: NEW_SEED_URL,
      source_pdf_hash: NEW_SEED_HASH,
      source_kind: "manual",
      groups: 41,
      lessons: 449,
    });
    expect(status.source.last_result).toBe("error");
    expect(status.source.last_error).toMatch(/Cloudflare challenge/);
  });
});

describe("packaged seed promotion", () => {
  it("promotes persisted -5 seed to validated -9 seed even when discovery is challenged", async () => {
    await writeFile(packagedSeedPath, newSeedBytes);
    await persistOldSchedule("seed");
    stubFetch(cloudflareDiscoveryRoutes());

    const result = await checkForUpdates();
    expect(result.outcome).toBe("error");
    expect(result.message).toMatch(/Cloudflare challenge/);

    const served = await getCurrentSchedule();
    expect(served?.metadata).toMatchObject({
      source_pdf_url: NEW_SEED_URL,
      source_pdf_hash: NEW_SEED_HASH,
      source_kind: "seed",
    });
    expect(served?.groups).toHaveLength(41);
    expect(served?.lessons).toHaveLength(449);
    expect(served?.lessons.filter((lesson) => lesson.uncertain)).toHaveLength(0);

    const status = await buildStatus();
    expect(status.schedule).toMatchObject({
      source_pdf_url: NEW_SEED_URL,
      source_pdf_hash: NEW_SEED_HASH,
      groups: 41,
      lessons: 449,
    });
    expect(status.source).toMatchObject({
      current_pdf_url: NEW_SEED_URL,
      last_result: "error",
    });
    expect(status.source.last_error).toMatch(/Cloudflare challenge/);
  });

  it.each(["live", "manual"] as const)("never overwrites a valid %s schedule with the bundled seed", async (sourceKind) => {
    await writeFile(packagedSeedPath, newSeedBytes);
    const current = await persistOldSchedule(sourceKind);
    stubFetch(cloudflareDiscoveryRoutes());

    expect((await checkForUpdates()).outcome).toBe("error");
    const served = await getCurrentSchedule();
    expect(served?.metadata).toMatchObject({
      source_pdf_url: OLD_SEED_URL,
      source_pdf_hash: current.metadata.source_pdf_hash,
      source_kind: sourceKind,
    });
  });
});
