/**
 * A deployment is pinned to one course year (SCHEDULE_COURSE_YEAR). Whatever happens to
 * discovery, it must never install a schedule that belongs to a different one.
 *
 * Everything here runs as an Anul II deployment while the only real PDF available
 * anywhere — packaged seed, repository mirror, even the discovered document — is the
 * bundled Anul I timetable. Nothing may be served in that situation.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Type-only: erased at compile time, so it cannot import the app before the env below is set.
import type { NextRequest } from "next/server";

const SEED_HASH = "52e7f14be27a996e17d0614c1f9fe769d63bdf76876fce6d4fc60f026bf8c015";
const SEED_MIRROR_URL =
  "https://raw.githubusercontent.com/barbalatv/utm-curs-i-orar-2027/main/data/seed/anul_i_semestrul_i-9.pdf";
const tempDir = await mkdtemp(path.join(tmpdir(), "fcim-course2-"));
const packagedSeedPath = path.join(tempDir, "packaged-seed.pdf");

process.env.SCHEDULE_COURSE_YEAR = "2";
process.env.SCHEDULE_DATA_DIR = tempDir;
process.env.DATABASE_URL = "";
process.env.SCHEDULE_WAYBACK_FALLBACK = "0";
process.env.SCHEDULE_SEED_PDF = packagedSeedPath;
process.env.SCHEDULE_SEED_PDF_MIRROR_URL = SEED_MIRROR_URL;
process.env.SCHEDULE_SEED_PDF_SHA256 = SEED_HASH;

const { NextRequest: NextRequestCtor } = await import("next/server");
const { config } = await import("@/lib/config");
const { parsePdf, sha256 } = await import("@/lib/parser");
const { checkForUpdates } = await import("@/lib/services/updater");
const { buildStatus } = await import("@/lib/services/schedule-service");
const { getCurrentSchedule, getSourceState, replaceCurrentSchedule, resetStorageCache, saveSourceState } =
  await import("@/lib/storage");
const scheduleRoute = (await import("@/app/api/schedule/route")).GET;

/** The bundled Anul I PDF, i.e. the seed an Anul II deployment must refuse. */
const ANUL_I_SEED = path.join(__dirname, "..", "data", "seed", "anul_i_semestrul_i-9.pdf");
/** An older published Anul I timetable, used as pre-existing (wrong-course) cache content. */
const ANUL_I_OLD = path.join(__dirname, "fixtures", "anul_i_semestrul_i-5.pdf");
const PAGE_URL = "https://fcim.utm.md/procesul-de-studii/orar/";
const WORDPRESS_URL = "https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar&context=view";
const OLD_SEED_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-5.pdf";
const ANUL_II_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_ii_semestrul_iii-8.pdf";
const AUTUMN_2026 = new Date("2026-09-15T12:00:00.000Z");

let seedBytes: Uint8Array;
let oldBytes: Uint8Array;
let oldSchedule: Awaited<ReturnType<typeof parsePdf>>["schedule"];

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(AUTUMN_2026);
  const [seed, old] = await Promise.all([readFile(ANUL_I_SEED), readFile(ANUL_I_OLD)]);
  seedBytes = new Uint8Array(seed);
  oldBytes = new Uint8Array(old);
  ({ schedule: oldSchedule } = await parsePdf(oldBytes, {
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

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  vi.useRealTimers();
  await rm(tempDir, { recursive: true, force: true });
});

type Route = { status?: number; body?: Uint8Array | string; headers?: Record<string, string> };

function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      const route = routes[url];
      if (!route) return new Response("not found", { status: 404 });
      const body = route.body instanceof Uint8Array ? new Uint8Array(route.body) : route.body ?? "";
      return new Response(body, { status: route.status ?? 200, headers: route.headers ?? {} });
    }),
  );
  return calls;
}

/** Both official endpoints behind a Cloudflare challenge: automatic discovery is unavailable. */
function blockedDiscovery(): Record<string, Route> {
  const challenge: Route = {
    status: 403,
    body: "Just a moment...",
    headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
  };
  return { [PAGE_URL]: challenge, [WORDPRESS_URL]: challenge };
}

/** Nothing may reach a reader while the deployment has no schedule of its own course year. */
async function expectNothingServed() {
  expect(await getCurrentSchedule()).toBeNull();
  const status = await buildStatus();
  expect(status.has_schedule).toBe(false);
  expect(status.schedule).toBeNull();

  const request = new NextRequestCtor(new URL("/api/schedule", "http://localhost:8000")) as NextRequest;
  const response = await scheduleRoute(request);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/SI-261/);
}

describe("wrong-course seed fallback", () => {
  it("is configured as an Anul II deployment", () => {
    expect(config.courseYear).toBe(2);
  });

  it("refuses the packaged Anul I seed on a cold start and installs nothing", async () => {
    await writeFile(packagedSeedPath, seedBytes);
    const calls = stubFetch(blockedDiscovery());

    const result = await checkForUpdates();

    expect(result.outcome).toBe("error");
    expect(result.message).toMatch(/Cloudflare challenge/);
    expect(result.message).toMatch(/course year mismatch/);
    // The seed was read from disk, so the mirror was never needed.
    expect(calls).not.toContain(SEED_MIRROR_URL);
    await expectNothingServed();

    const state = await getSourceState();
    expect(state).toMatchObject({ last_result: "error", current_pdf_url: null, current_pdf_hash: null });
    expect(state.last_error).toMatch(/Cloudflare challenge/);
    expect(state.last_error).toMatch(/course year mismatch/);
    expect(state.last_error_at).not.toBeNull();
  });

  it("refuses the repository mirror seed even though its SHA-256 matches", async () => {
    // No packaged and no image seed on disk: readBundledSeed falls through to the mirror.
    const calls = stubFetch({ ...blockedDiscovery(), [SEED_MIRROR_URL]: { body: seedBytes } });

    const result = await checkForUpdates();

    expect(sha256(seedBytes)).toBe(SEED_HASH);
    expect(calls).toContain(SEED_MIRROR_URL);
    expect(result.outcome).toBe("error");
    expect(result.message).toMatch(/course year mismatch/);
    expect(result.message).not.toMatch(/SHA-256 mismatch/);
    await expectNothingServed();
    expect((await getSourceState()).last_error).toMatch(/course year mismatch/);
  });

  it("refuses a discovered PDF whose contents belong to another course year", async () => {
    // The page advertises an Anul II document; the bytes behind it are the Anul I timetable.
    const title = "Ciclul I, Licență - învățământ cu frecvență";
    const page =
      `<html><body><div class="togglecontainer"><p data-title="${title}">${title}</p><table><tbody>` +
      `<tr><td>Orar Semestrul de TOAMNĂ a.u.2026/2027</td>` +
      `<td><a href="${ANUL_II_URL}">Anul II</a></td></tr></tbody></table></div></body></html>`;
    stubFetch({
      [PAGE_URL]: { body: page, headers: { "content-type": "text/html" } },
      [ANUL_II_URL]: { body: seedBytes, headers: { "content-type": "application/pdf" } },
    });

    const result = await checkForUpdates();

    expect(result.outcome).toBe("rejected");
    expect(result.message).toMatch(/course year mismatch/);
    await expectNothingServed();
    const state = await getSourceState();
    expect(state.last_result).toBe("rejected");
    expect(state.last_error).toMatch(/course year mismatch/);
  });

  it("never promotes a newer Anul I seed over data already on disk", async () => {
    await writeFile(packagedSeedPath, seedBytes);
    await replaceCurrentSchedule(oldSchedule);
    await saveSourceState({
      current_pdf_url: OLD_SEED_URL,
      current_pdf_hash: oldSchedule.metadata.source_pdf_hash,
      last_result: "seeded",
    });
    stubFetch(blockedDiscovery());

    expect((await checkForUpdates()).outcome).toBe("error");

    // Promotion is the one seed path that runs with a schedule already present; the newer
    // packaged Anul I seed must not replace what is on disk.
    const served = await getCurrentSchedule();
    expect(served?.metadata.source_pdf_hash).toBe(oldSchedule.metadata.source_pdf_hash);
    expect(served?.metadata.source_pdf_url).toBe(OLD_SEED_URL);
    expect(sha256(seedBytes)).not.toBe(served?.metadata.source_pdf_hash);
    expect(oldBytes.byteLength).toBeGreaterThan(0);
    expect((await getSourceState()).current_pdf_url).toBe(OLD_SEED_URL);
  });
});
