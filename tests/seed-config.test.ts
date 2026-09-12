/** Seed overrides resolve into one internally consistent descriptor or fail at startup. */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseConfigError, resolveCourseSeed } from "@/lib/courses";

const BUNDLED_FILE = "anul_i_semestrul_i-18.pdf";
const BUNDLED_URL = `https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/${BUNDLED_FILE}`;
const BUNDLED_MIRROR =
  `https://raw.githubusercontent.com/barbalatv/utm-curs-i-orar-2027/main/data/seed/${BUNDLED_FILE}`;
const BUNDLED_SHA = "a4c610d24dd53bbf87c5da312ffebf7aabc112c7f28338587e18e1eb0526b79a";
const CUSTOM_URL = "https://publisher.example/schedules/anul-i.pdf";
const CUSTOM_MIRROR = "https://cdn.example/schedules/anul-i.pdf";
const CUSTOM_SHA = "1".repeat(64);

function resolve(env: Record<string, string | undefined>, courseYear = 1) {
  return resolveCourseSeed(env as NodeJS.ProcessEnv, courseYear);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("seed descriptor configuration", () => {
  it("A: uses the current release-managed descriptor with no overrides", () => {
    expect(resolve({})).toEqual({
      kind: "bundled",
      courseYear: 1,
      pdfPath: path.resolve(`data/seed/${BUNDLED_FILE}`),
      imagePdfPath: path.resolve(`seed/${BUNDLED_FILE}`),
      originalUrl: BUNDLED_URL,
      mirrorUrl: BUNDLED_MIRROR,
      sha256: BUNDLED_SHA,
    });
  });

  it("B: treats a PDF-only override as a relocated copy of the bundled document", () => {
    const seed = resolve({ SCHEDULE_SEED_PDF: "alternate/current.pdf" });
    expect(seed).toMatchObject({
      kind: "bundled",
      pdfPath: path.resolve("alternate/current.pdf"),
      originalUrl: BUNDLED_URL,
      mirrorUrl: BUNDLED_MIRROR,
      sha256: BUNDLED_SHA,
    });
  });

  it("C: treats a mirror-only override as a relocated copy of the bundled document", () => {
    const seed = resolve({ SCHEDULE_SEED_PDF_MIRROR_URL: CUSTOM_MIRROR });
    expect(seed).toMatchObject({
      kind: "bundled",
      originalUrl: BUNDLED_URL,
      mirrorUrl: CUSTOM_MIRROR,
      sha256: BUNDLED_SHA,
    });
  });

  it("D: rejects a custom provenance URL without its SHA and byte source", () => {
    expect(() => resolve({ SCHEDULE_SEED_PDF_URL: CUSTOM_URL })).toThrow(CourseConfigError);
    expect(() => resolve({ SCHEDULE_SEED_PDF_URL: CUSTOM_URL })).toThrow(
      /course year 1.*requires SCHEDULE_SEED_PDF_SHA256.*SCHEDULE_SEED_PDF.*SCHEDULE_SEED_PDF_MIRROR_URL/i,
    );
  });

  it("E: rejects a SHA that differs from bundled provenance when no custom URL is set", () => {
    expect(() => resolve({ SCHEDULE_SEED_PDF_SHA256: "0".repeat(64) })).toThrow(CourseConfigError);
    expect(() => resolve({ SCHEDULE_SEED_PDF_SHA256: "0".repeat(64) })).toThrow(
      /SCHEDULE_SEED_PDF_SHA256.*course year 1.*must equal.*bundled/i,
    );
  });

  it("F: rejects custom URL plus PDF without an explicit SHA", () => {
    expect(() => resolve({ SCHEDULE_SEED_PDF_URL: CUSTOM_URL, SCHEDULE_SEED_PDF: "custom.pdf" })).toThrow(
      /SCHEDULE_SEED_PDF_SHA256/,
    );
  });

  it("G: rejects custom URL plus mirror without an explicit SHA", () => {
    expect(() =>
      resolve({ SCHEDULE_SEED_PDF_URL: CUSTOM_URL, SCHEDULE_SEED_PDF_MIRROR_URL: CUSTOM_MIRROR }),
    ).toThrow(/SCHEDULE_SEED_PDF_SHA256/);
  });

  it("H: builds a custom URL + SHA + PDF descriptor with no bundled image fallback", () => {
    expect(
      resolve({ SCHEDULE_SEED_PDF_URL: CUSTOM_URL, SCHEDULE_SEED_PDF_SHA256: CUSTOM_SHA, SCHEDULE_SEED_PDF: "custom.pdf" }),
    ).toEqual({
      kind: "custom",
      courseYear: 1,
      pdfPath: path.resolve("custom.pdf"),
      imagePdfPath: null,
      originalUrl: CUSTOM_URL,
      mirrorUrl: null,
      sha256: CUSTOM_SHA,
    });
  });

  it("I: keeps all custom fields together as one atomic descriptor", () => {
    expect(
      resolve({
        SCHEDULE_SEED_PDF: "custom.pdf",
        SCHEDULE_SEED_PDF_URL: CUSTOM_URL,
        SCHEDULE_SEED_PDF_MIRROR_URL: CUSTOM_MIRROR,
        SCHEDULE_SEED_PDF_SHA256: CUSTOM_SHA,
      }),
    ).toEqual({
      kind: "custom",
      courseYear: 1,
      pdfPath: path.resolve("custom.pdf"),
      imagePdfPath: null,
      originalUrl: CUSTOM_URL,
      mirrorUrl: CUSTOM_MIRROR,
      sha256: CUSTOM_SHA,
    });
  });

  it("normalizes empty and whitespace-only optional overrides as unset", () => {
    const seed = resolve({
      SCHEDULE_SEED_PDF: " ",
      SCHEDULE_SEED_PDF_URL: "",
      SCHEDULE_SEED_PDF_MIRROR_URL: "\t",
      SCHEDULE_SEED_PDF_SHA256: "  ",
    });
    expect(seed).toMatchObject({ kind: "bundled", originalUrl: BUNDLED_URL, mirrorUrl: BUNDLED_MIRROR, sha256: BUNDLED_SHA });
    expect(seed?.pdfPath).toBe(path.resolve(`data/seed/${BUNDLED_FILE}`));
  });

  it("keeps course 2 suffixes isolated and validates their custom combination", () => {
    const seed = resolve(
      {
        SCHEDULE_SEED_PDF_URL: "https://ignored.example/course-one.pdf",
        SCHEDULE_SEED_PDF_URL_2: "https://publisher.example/course-two.pdf",
        SCHEDULE_SEED_PDF_MIRROR_URL_2: "https://cdn.example/course-two.pdf",
        SCHEDULE_SEED_PDF_SHA256_2: CUSTOM_SHA,
      },
      2,
    );
    expect(seed).toMatchObject({
      kind: "custom",
      courseYear: 2,
      pdfPath: null,
      imagePdfPath: null,
      originalUrl: "https://publisher.example/course-two.pdf",
      mirrorUrl: "https://cdn.example/course-two.pdf",
      sha256: CUSTOM_SHA,
    });
    expect(() => resolve({ SCHEDULE_SEED_PDF_URL_2: "https://publisher.example/course-two.pdf" }, 2)).toThrow(
      /course year 2.*SCHEDULE_SEED_PDF_SHA256_2.*SCHEDULE_SEED_PDF_2.*SCHEDULE_SEED_PDF_MIRROR_URL_2/i,
    );
  });

  it("fails during module startup for a partial custom descriptor", async () => {
    vi.resetModules();
    vi.stubEnv("SCHEDULE_SEED_PDF_URL", CUSTOM_URL);
    await expect(import("@/lib/courses")).rejects.toThrow(/Course year 1|course year 1/);
  });
});
