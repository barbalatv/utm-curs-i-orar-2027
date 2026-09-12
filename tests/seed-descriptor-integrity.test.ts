/** Runtime guards tying every installed seed byte-for-byte to one descriptor's provenance. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const tempDir = await mkdtemp(path.join(tmpdir(), "fcim-seed-descriptor-"));
const CURRENT_SEED = path.join(__dirname, "..", "data", "seed", "anul_i_semestrul_i-18.pdf");
const PREVIOUS_SEED = path.join(__dirname, "fixtures", "anul_i_semestrul_i-16.pdf");
const PAGE_URL = "https://fcim.utm.md/procesul-de-studii/orar/";
const CURRENT_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-18.pdf";
const PREVIOUS_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-16.pdf";
const CURRENT_SHA = "a4c610d24dd53bbf87c5da312ffebf7aabc112c7f28338587e18e1eb0526b79a";
const CUSTOM_URL = "https://publisher.example/schedules/anul-i-custom.pdf";
const CUSTOM_MIRROR = "https://seed-cdn.example/anul-i-custom.pdf";

let currentBytes: Uint8Array;
let previousBytes: Uint8Array;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
  [currentBytes, previousBytes] = await Promise.all([
    readFile(CURRENT_SEED).then((bytes) => new Uint8Array(bytes)),
    readFile(PREVIOUS_SEED).then((bytes) => new Uint8Array(bytes)),
  ]);
  expect(hash(currentBytes)).toBe(CURRENT_SHA);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(path.join(tempDir, "data"), { recursive: true, force: true });
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function configureSeed(overrides: Record<string, string>, caseName: string) {
  const base: Record<string, string> = {
    SCHEDULE_COURSES: "1",
    SCHEDULE_DATA_DIR: path.join(tempDir, "data", caseName),
    DATABASE_URL: "",
    SCHEDULE_BROKER_URL: "",
    SCHEDULE_WORDPRESS_FALLBACK: "0",
    SCHEDULE_WAYBACK_FALLBACK: "0",
    // Explicit empties prove optional seed values normalize to unset and isolate cases.
    SCHEDULE_SEED_PDF: "",
    SCHEDULE_SEED_PDF_URL: "",
    SCHEDULE_SEED_PDF_MIRROR_URL: "",
    SCHEDULE_SEED_PDF_SHA256: "",
  };
  for (const [name, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(name, value);
  vi.resetModules();
}

function stubUnavailableSource(routes: Record<string, Uint8Array> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const bytes = routes[url];
      if (bytes) return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf" } });
      return new Response(url === PAGE_URL ? "source unavailable" : "not found", { status: url === PAGE_URL ? 503 : 404 });
    }),
  );
}

async function runtime() {
  const updater = await import("@/lib/services/updater");
  const storage = await import("@/lib/storage");
  const courses = await import("@/lib/courses");
  const parser = await import("@/lib/parser");
  storage.resetStorageCache();
  return { updater, storage, courses, parser };
}

describe("seed byte integrity", () => {
  it("accepts a relocated bundled local file and retains bundled provenance", async () => {
    const relocated = path.join(tempDir, "relocated-current.pdf");
    await writeFile(relocated, currentBytes);
    configureSeed({ SCHEDULE_SEED_PDF: relocated }, "relocated-valid");
    stubUnavailableSource();
    const { updater, storage } = await runtime();

    const result = await updater.checkForUpdates(1);

    expect(result).toMatchObject({ outcome: "seeded", pdf_url: CURRENT_URL, source_pdf_hash: CURRENT_SHA });
    expect((await storage.getCurrentSchedule(1))?.metadata).toMatchObject({
      source_pdf_url: CURRENT_URL,
      source_pdf_hash: hash(currentBytes),
      source_kind: "seed",
    });
  });

  it("rejects a tampered relocated bundled local file before installation", async () => {
    const relocated = path.join(tempDir, "relocated-tampered.pdf");
    const tampered = new Uint8Array(currentBytes);
    tampered[tampered.length - 1] ^= 0xff;
    await writeFile(relocated, tampered);
    configureSeed({ SCHEDULE_SEED_PDF: relocated }, "relocated-tampered");
    stubUnavailableSource();
    const { updater, storage } = await runtime();

    const result = await updater.checkForUpdates(1);

    expect(result.outcome).toBe("error");
    expect(result.message).toContain(`expected ${CURRENT_SHA}`);
    expect(result.message).toContain(`actual ${hash(tampered)}`);
    expect(result.message).toContain(`source local file ${relocated}`);
    expect(await storage.getCurrentSchedule(1)).toBeNull();
    expect((await storage.getSourceState(1)).current_pdf_url).toBeNull();
  });

  it("does not use release-managed bytes when a custom descriptor path is missing", async () => {
    const missing = path.join(tempDir, "missing-custom.pdf");
    configureSeed(
      {
        SCHEDULE_SEED_PDF: missing,
        SCHEDULE_SEED_PDF_URL: PREVIOUS_URL,
        SCHEDULE_SEED_PDF_SHA256: hash(previousBytes),
      },
      "custom-missing",
    );
    stubUnavailableSource();
    const { updater, storage, courses } = await runtime();

    // The current release PDF is present, but it belongs to a different descriptor.
    await expect(readFile(courses.bundledCourseSeed(1)!.pdfPath)).resolves.toBeTruthy();
    expect(courses.courseSeed(1)).toMatchObject({ kind: "custom", imagePdfPath: null, mirrorUrl: null });
    const result = await updater.checkForUpdates(1);

    expect(result.outcome).toBe("error");
    expect(result.message).toMatch(/no readable seed byte source/);
    expect(await storage.getCurrentSchedule(1)).toBeNull();
    expect((await storage.getSourceState(1)).current_pdf_url).toBeNull();
    // The forbidden former state was release-B bytes/hash stamped with release-A URL.
    expect((await storage.getSourceState(1))).not.toMatchObject({
      current_pdf_url: PREVIOUS_URL,
      current_pdf_hash: CURRENT_SHA,
    });
  });

  it("installs a verified custom mirror while retaining custom provenance", async () => {
    configureSeed(
      {
        SCHEDULE_SEED_PDF_URL: CUSTOM_URL,
        SCHEDULE_SEED_PDF_MIRROR_URL: CUSTOM_MIRROR,
        SCHEDULE_SEED_PDF_SHA256: CURRENT_SHA,
      },
      "custom-mirror-valid",
    );
    stubUnavailableSource({ [CUSTOM_MIRROR]: currentBytes });
    const { updater, storage } = await runtime();

    const result = await updater.checkForUpdates(1);

    expect(result).toMatchObject({ outcome: "seeded", pdf_url: CUSTOM_URL, source_pdf_hash: CURRENT_SHA });
    expect((await storage.getCurrentSchedule(1))?.metadata).toMatchObject({
      source_pdf_url: CUSTOM_URL,
      source_pdf_hash: hash(currentBytes),
      source_kind: "seed",
    });
  });

  it("rejects wrong custom mirror bytes and leaves storage untouched", async () => {
    const tampered = new Uint8Array(currentBytes);
    tampered[tampered.length - 1] ^= 0xff;
    configureSeed(
      {
        SCHEDULE_SEED_PDF_URL: CUSTOM_URL,
        SCHEDULE_SEED_PDF_MIRROR_URL: CUSTOM_MIRROR,
        SCHEDULE_SEED_PDF_SHA256: CURRENT_SHA,
      },
      "custom-mirror-tampered",
    );
    stubUnavailableSource({ [CUSTOM_MIRROR]: tampered });
    const { updater, storage } = await runtime();

    const result = await updater.checkForUpdates(1);

    expect(result.outcome).toBe("error");
    expect(result.message).toContain(`expected ${CURRENT_SHA}`);
    expect(result.message).toContain(`actual ${hash(tampered)}`);
    expect(result.message).toContain(`source mirror ${CUSTOM_MIRROR}`);
    expect(await storage.getCurrentSchedule(1)).toBeNull();
    expect((await storage.getSourceState(1)).current_pdf_url).toBeNull();
  });
});

describe("release promotion authority", () => {
  it("promotes revision 16 to release revision 18 despite stale release-A environment values", async () => {
    const previousSha = hash(previousBytes);
    configureSeed(
      {
        // This is the shape copied from the former .env.example by a long-lived deployment.
        SCHEDULE_SEED_PDF: PREVIOUS_SEED,
        SCHEDULE_SEED_PDF_URL: PREVIOUS_URL,
        SCHEDULE_SEED_PDF_MIRROR_URL:
          "https://raw.githubusercontent.com/barbalatv/utm-curs-i-orar-2027/main/tests/fixtures/anul_i_semestrul_i-16.pdf",
        SCHEDULE_SEED_PDF_SHA256: previousSha,
      },
      "stale-env-promotion",
    );
    stubUnavailableSource();
    const { updater, storage, courses, parser } = await runtime();
    const { schedule: previous } = await parser.parsePdf(previousBytes, {
      source_page_url: PAGE_URL,
      source_pdf_url: PREVIOUS_URL,
      source_kind: "seed",
      downloaded_at: "2026-09-01T00:00:00.000Z",
      course_year: 1,
    });
    expect(previous.lessons).toHaveLength(451);
    await storage.replaceCurrentSchedule(1, previous);
    await storage.saveSourceState(1, {
      current_pdf_url: PREVIOUS_URL,
      current_pdf_hash: previousSha,
      last_result: "seeded",
      academic_year: previous.metadata.academic_year,
      semester: previous.metadata.semester,
    });

    expect(courses.courseSeed(1)).toMatchObject({ kind: "custom", originalUrl: PREVIOUS_URL, sha256: previousSha });
    expect(courses.bundledCourseSeed(1)).toMatchObject({ kind: "bundled", originalUrl: CURRENT_URL, sha256: CURRENT_SHA });
    // Discovery still fails after the independent packaged-baseline promotion.
    expect((await updater.checkForUpdates(1)).outcome).toBe("error");

    const promoted = await storage.getCurrentSchedule(1);
    expect(promoted?.metadata).toMatchObject({
      source_pdf_url: CURRENT_URL,
      source_pdf_hash: CURRENT_SHA,
      source_kind: "seed",
      course_year: 1,
      academic_year: "2026/2027",
      semester: "Semestrul I",
    });
    expect(promoted?.groups).toHaveLength(41);
    expect(promoted?.lessons).toHaveLength(452);
    expect(await storage.getSourceState(1)).toMatchObject({
      current_pdf_url: CURRENT_URL,
      current_pdf_hash: CURRENT_SHA,
      last_result: "error",
    });
  });
});
