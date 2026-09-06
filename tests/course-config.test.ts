/**
 * Deployment configuration must fail loudly rather than guess.
 *
 * A malformed SCHEDULE_COURSES that quietly normalises to "course 1" is worse than a
 * refused start: the deployment comes up looking healthy while serving a different set
 * of courses than the operator configured. Everything below asserts the refusal.
 *
 * `resolveCourseSelection` is pure, so the rules are exercised directly; the last block
 * re-evaluates the module itself to prove the process really does stop at import time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseConfigError, resolveCourseSelection } from "@/lib/courses";

const KNOWN = [1, 2];

function resolve(env: Record<string, string | undefined>) {
  return resolveCourseSelection(env as NodeJS.ProcessEnv, KNOWN);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SCHEDULE_COURSES", () => {
  it("defaults to every known course when unset", () => {
    expect(resolve({})).toEqual({ years: [1, 2], defaultYear: 1 });
  });

  it("accepts the documented shapes and keeps the configured order", () => {
    expect(resolve({ SCHEDULE_COURSES: "1" })).toEqual({ years: [1], defaultYear: 1 });
    expect(resolve({ SCHEDULE_COURSES: "2" })).toEqual({ years: [2], defaultYear: 2 });
    expect(resolve({ SCHEDULE_COURSES: "1,2" })).toEqual({ years: [1, 2], defaultYear: 1 });
    expect(resolve({ SCHEDULE_COURSES: "2,1" })).toEqual({ years: [2, 1], defaultYear: 2 });
    // Whitespace around a token is formatting, not a value.
    expect(resolve({ SCHEDULE_COURSES: " 1 , 2 " })).toEqual({ years: [1, 2], defaultYear: 1 });
  });

  it("refuses malformed values instead of normalising them to course 1", () => {
    const rejected: Record<string, RegExp> = {
      "": /set but empty/,
      "   ": /set but empty/,
      abc: /is not a course year/,
      "1x": /is not a course year/,
      "01": /is not a course year/,
      "1.0": /is not a course year/,
      "-1": /is not a course year/,
      "+1": /is not a course year/,
      "1,": /contains an empty entry/,
      ",2": /contains an empty entry/,
      "1,,2": /contains an empty entry/,
      "1,abc": /is not a course year/,
      "1,3": /does not implement/,
      "0": /is not a course year/,
      "1,1": /more than once/,
    };
    for (const [value, message] of Object.entries(rejected)) {
      expect(() => resolve({ SCHEDULE_COURSES: value }), value).toThrow(CourseConfigError);
      expect(() => resolve({ SCHEDULE_COURSES: value }), value).toThrow(message);
    }
  });
});

describe("SCHEDULE_DEFAULT_COURSE", () => {
  it("selects an enabled course", () => {
    expect(resolve({ SCHEDULE_COURSES: "1,2", SCHEDULE_DEFAULT_COURSE: "2" })).toEqual({
      years: [1, 2],
      defaultYear: 2,
    });
  });

  it("refuses a default that is not enabled, rather than serving another course", () => {
    expect(() => resolve({ SCHEDULE_COURSES: "1", SCHEDULE_DEFAULT_COURSE: "2" })).toThrow(
      /not among the enabled courses/,
    );
    expect(() => resolve({ SCHEDULE_DEFAULT_COURSE: "3" })).toThrow(/does not implement/);
  });

  it("refuses malformed or multi-valued defaults", () => {
    expect(() => resolve({ SCHEDULE_DEFAULT_COURSE: "" })).toThrow(/set but empty/);
    expect(() => resolve({ SCHEDULE_DEFAULT_COURSE: "01" })).toThrow(/is not a course year/);
    expect(() => resolve({ SCHEDULE_DEFAULT_COURSE: "abc" })).toThrow(/is not a course year/);
    expect(() => resolve({ SCHEDULE_DEFAULT_COURSE: "1,2" })).toThrow(/exactly one course year/);
  });
});

describe("SCHEDULE_COURSE_YEAR (removed)", () => {
  it("is never silently ignored", () => {
    expect(() => resolve({ SCHEDULE_COURSE_YEAR: "1" })).toThrow(CourseConfigError);
    expect(() => resolve({ SCHEDULE_COURSE_YEAR: "2" })).toThrow(/no longer supported/);
    // The message has to tell the operator what to write instead.
    expect(() => resolve({ SCHEDULE_COURSE_YEAR: "2" })).toThrow(/SCHEDULE_COURSES=2/);
    // Even alongside the new configuration: one of the two would be a lie.
    expect(() => resolve({ SCHEDULE_COURSE_YEAR: "1", SCHEDULE_COURSES: "1,2" })).toThrow(/no longer supported/);
  });

  it("ignores an empty legacy variable, which carries no instruction", () => {
    expect(resolve({ SCHEDULE_COURSE_YEAR: "", SCHEDULE_COURSES: "1,2" })).toEqual({
      years: [1, 2],
      defaultYear: 1,
    });
  });
});

describe("startup", () => {
  it("throws while the module is being imported, before anything is served", async () => {
    vi.resetModules();
    vi.stubEnv("SCHEDULE_COURSES", "1,3");
    await expect(import("@/lib/courses")).rejects.toThrow(/does not implement/);
  });

  it("refuses to start on a leftover SCHEDULE_COURSE_YEAR", async () => {
    vi.resetModules();
    vi.stubEnv("SCHEDULE_COURSE_YEAR", "1");
    await expect(import("@/lib/courses")).rejects.toThrow(/no longer supported/);
  });

  it("exposes exactly what the configuration resolved to", async () => {
    vi.resetModules();
    vi.stubEnv("SCHEDULE_COURSES", "2,1");
    vi.stubEnv("SCHEDULE_DEFAULT_COURSE", "2");
    const courses = await import("@/lib/courses");
    expect([...courses.SUPPORTED_COURSE_YEARS]).toEqual([2, 1]);
    expect(courses.DEFAULT_COURSE_YEAR).toBe(2);
    expect(courses.SUPPORTED_COURSES.map((course) => course.label)).toEqual(["Anul II", "Anul I"]);
  });
});
