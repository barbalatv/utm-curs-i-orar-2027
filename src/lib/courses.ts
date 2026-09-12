/**
 * Supported course years. One deployment serves every course listed here, and each
 * course owns an independent schedule aggregate: its own PDF, storage files, source
 * state and version history. Nothing is ever merged across courses.
 *
 * Two rules run through this module:
 *
 *  - Configuration fails fast. A malformed SCHEDULE_COURSES / SCHEDULE_DEFAULT_COURSE
 *    stops the process at import time with a message naming the offending value; it is
 *    never normalised into "course 1 only", because a deployment that silently serves
 *    the wrong set of courses is worse than one that refuses to start.
 *  - Public input is parsed strictly. An omitted `?course=` means the default course
 *    (the pre-multi-course contract); everything else must be exactly "1" or "2".
 *
 * Adding another course later means adding one CATALOG entry (plus a seed, if a
 * verified bundled PDF exists for it) — no other module hard-codes a course year.
 */
import path from "node:path";

interface CourseSeedBase {
  /** The course whose schedule these bytes are allowed to install. */
  courseYear: number;
  /** Official URL this file was published at; the provenance a seed may claim. */
  originalUrl: string;
  /** Every local or remote byte source must match this value before parsing. */
  sha256: string;
}

/** The release-owned seed. All three locations describe the same BUNDLED_SEEDS document. */
export interface BundledCourseSeed extends CourseSeedBase {
  kind: "bundled";
  /** Packaged copy inside the data directory, which may be a mounted volume. */
  pdfPath: string;
  /** Container-safe copy kept outside SCHEDULE_DATA_DIR so a mounted cache cannot hide it. */
  imagePdfPath: string;
  /** Public copy for hosts that do not preserve image files at runtime. */
  mirrorUrl: string;
}

/** An operator-owned seed. It may only use byte sources explicitly supplied with its provenance. */
export interface CustomCourseSeed extends CourseSeedBase {
  kind: "custom";
  pdfPath: string | null;
  /** A custom descriptor must never fall back to the release-owned image bytes. */
  imagePdfPath: null;
  mirrorUrl: string | null;
}

/** A real FCIM PDF used for a cold start when the live source is unreachable. */
export type CourseSeed = BundledCourseSeed | CustomCourseSeed;

export interface CourseDefinition {
  year: number;
  /** Roman numeral as FCIM prints it: "Anul I", "Anul II". */
  roman: string;
  label: string;
  /** null = no verified bundled PDF; a cold start without network leaves the course unavailable. */
  seed: CourseSeed | null;
}

/** Startup configuration is wrong; the process must not continue with a guess. */
export class CourseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseConfigError";
  }
}

/** A course year reached a stateful boundary without passing validation first. */
export class UnsupportedCourseError extends Error {
  constructor(readonly courseYear: unknown) {
    super(
      `course year ${JSON.stringify(courseYear)} is not served by this deployment ` +
        `(supported: ${SUPPORTED_COURSE_YEARS.join(", ")})`,
    );
    this.name = "UnsupportedCourseError";
  }
}

/**
 * The verified bundled PDF of each course: a real, previously published FCIM timetable,
 * used only as a cold-start fallback when the live source cannot be reached. It is never
 * the live update source, and the course-year guard still checks every parsed candidate.
 *
 * Every course carries its own file, URL and hash. Nothing is shared or derived between
 * courses — an Anul II seed must never be describable by an Anul I setting.
 */
const BUNDLED_SEEDS: Record<number, { fileName: string; originalUrl: string; sha256: string }> = {
  1: {
    fileName: "anul_i_semestrul_i-18.pdf",
    originalUrl: "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-18.pdf",
    sha256: "a4c610d24dd53bbf87c5da312ffebf7aabc112c7f28338587e18e1eb0526b79a",
  },
  2: {
    fileName: "anul_ii_semestrul_iii-11.pdf",
    originalUrl: "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_ii_semestrul_iii-11.pdf",
    sha256: "3728f5ab165b6fe5095609d9aeff54da687c8312ed0ec1e89a9a951807a0a23b",
  },
};

/** This repository's own copy of a bundled seed, for hosts that drop image files at runtime. */
function repositoryMirrorUrl(fileName: string): string {
  return `https://raw.githubusercontent.com/barbalatv/utm-curs-i-orar-2027/main/data/seed/${fileName}`;
}

/**
 * Canonical decimal course year: no sign, no leading zero, no fraction, no padding,
 * no surrounding whitespace. Deliberately not Number.parseInt, which happily reads
 * "1x" as 1 and "01" as 1 — exactly the silent resolution this must prevent.
 */
const STRICT_COURSE_TOKEN = /^[1-9][0-9]*$/;

function resolveFromCwd(relative: string): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), relative);
}

/**
 * Seed overrides are per course and never shared. Course 1 keeps the historical
 * unsuffixed variable names; every other course uses the same names with `_<year>`
 * appended, so `SCHEDULE_SEED_PDF_2` can only ever describe Anul II. Setting a course 1
 * variable must not silently change what Anul II installs, and vice versa.
 */
function seedEnvName(courseYear: number, name: string): string {
  return courseYear === 1 ? name : `${name}_${courseYear}`;
}

function seedEnv(env: NodeJS.ProcessEnv, courseYear: number, name: string): string | undefined {
  const raw = env[seedEnvName(courseYear, name)];
  const normalized = raw?.trim();
  return normalized ? normalized : undefined;
}

function validateSeedSha256(value: string, variable: string, courseYear: number): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new CourseConfigError(
      `${variable} for course year ${courseYear} must contain a 64-character hexadecimal SHA-256.`,
    );
  }
  return normalized;
}

function validateSeedUrl(value: string, variable: string, courseYear: number): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CourseConfigError(`${variable} for course year ${courseYear} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new CourseConfigError(`${variable} for course year ${courseYear} must be an absolute HTTPS URL.`);
  }
  return value;
}

/**
 * The immutable release descriptor. Promotion always uses this value, never an
 * environment representation that may have survived from a previous release.
 */
export function bundledCourseSeed(courseYear: number): BundledCourseSeed | null {
  const bundled = BUNDLED_SEEDS[courseYear];
  if (!bundled) return null;

  return {
    kind: "bundled",
    courseYear,
    pdfPath: resolveFromCwd(`data/seed/${bundled.fileName}`),
    // The Dockerfile copies data/seed to /app/seed so this survives an empty /app/data mount.
    imagePdfPath: resolveFromCwd(`seed/${bundled.fileName}`),
    originalUrl: bundled.originalUrl,
    mirrorUrl: repositoryMirrorUrl(bundled.fileName),
    sha256: bundled.sha256,
  };
}

/**
 * Resolve the effective cold-start descriptor for one course.
 *
 * Without a changed provenance URL, path and mirror overrides are relocations of the
 * current bundled document and retain its URL and SHA. Changing the provenance URL
 * creates an atomic custom descriptor: it must bring a SHA and at least one byte source,
 * and it can never inherit the release image path or repository mirror.
 */
export function resolveCourseSeed(env: NodeJS.ProcessEnv, courseYear: number): CourseSeed | null {
  const release = bundledCourseSeed(courseYear);
  if (!release) return null;

  const pdfName = seedEnvName(courseYear, "SCHEDULE_SEED_PDF");
  const urlName = seedEnvName(courseYear, "SCHEDULE_SEED_PDF_URL");
  const mirrorName = seedEnvName(courseYear, "SCHEDULE_SEED_PDF_MIRROR_URL");
  const shaName = seedEnvName(courseYear, "SCHEDULE_SEED_PDF_SHA256");
  const pdfOverride = seedEnv(env, courseYear, "SCHEDULE_SEED_PDF");
  const urlOverride = seedEnv(env, courseYear, "SCHEDULE_SEED_PDF_URL");
  const mirrorOverride = seedEnv(env, courseYear, "SCHEDULE_SEED_PDF_MIRROR_URL");
  const shaOverride = seedEnv(env, courseYear, "SCHEDULE_SEED_PDF_SHA256");

  // Repeating the current official URL does not change descriptor ownership. This keeps
  // a current release's old four-variable configuration compatible while ensuring it
  // becomes a custom descriptor (or fails atomically) once BUNDLED_SEEDS moves forward.
  if (!urlOverride || urlOverride === release.originalUrl) {
    if (shaOverride) {
      const configured = validateSeedSha256(shaOverride, shaName, courseYear);
      if (configured !== release.sha256) {
        throw new CourseConfigError(
          `${shaName} for course year ${courseYear} must equal the release-managed bundled SHA-256 ` +
            `${release.sha256} while ${urlName} is unset or names the bundled official URL.`,
        );
      }
    }
    return {
      ...release,
      pdfPath: pdfOverride ? resolveFromCwd(pdfOverride) : release.pdfPath,
      mirrorUrl: mirrorOverride ? validateSeedUrl(mirrorOverride, mirrorName, courseYear) : release.mirrorUrl,
    };
  }

  const missing = [!shaOverride ? shaName : null, !pdfOverride && !mirrorOverride ? `${pdfName} or ${mirrorName}` : null]
    .filter((item): item is string => item !== null)
    .join(", ");
  if (missing) {
    throw new CourseConfigError(
      `${urlName} for course year ${courseYear} selects a custom seed descriptor and requires ${shaName} ` +
        `and at least one custom byte source (${pdfName} and/or ${mirrorName}). Missing: ${missing}.`,
    );
  }

  return {
    kind: "custom",
    courseYear,
    pdfPath: pdfOverride ? resolveFromCwd(pdfOverride) : null,
    imagePdfPath: null,
    originalUrl: validateSeedUrl(urlOverride, urlName, courseYear),
    mirrorUrl: mirrorOverride ? validateSeedUrl(mirrorOverride, mirrorName, courseYear) : null,
    sha256: validateSeedSha256(shaOverride!, shaName, courseYear),
  };
}

/** A course with no BUNDLED_SEEDS entry has no cold-start fallback. */
function seedFor(env: NodeJS.ProcessEnv, courseYear: number): CourseSeed | null {
  return resolveCourseSeed(env, courseYear);
}

/** Every course this application knows how to serve. */
function catalog(env: NodeJS.ProcessEnv): readonly CourseDefinition[] {
  return [
    { year: 1, roman: "I", label: "Anul I", seed: seedFor(env, 1) },
    { year: 2, roman: "II", label: "Anul II", seed: seedFor(env, 2) },
  ];
}

const KNOWN_COURSE_YEARS = [1, 2];

/**
 * Parse one strictly formatted course year, or return null. Used for public input and
 * for configuration alike so both reject the same shapes.
 */
export function parseStrictCourse(raw: string): number | null {
  if (!STRICT_COURSE_TOKEN.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function parseConfiguredList(raw: string, variable: string, known: readonly number[]): number[] {
  if (raw.trim() === "") {
    throw new CourseConfigError(`${variable} is set but empty. Remove it, or list course years, e.g. "1,2".`);
  }
  const years = raw.split(",").map((entry) => {
    // Padding around a comma is formatting in a .env file, so it is trimmed once here.
    // Everything the token still contains after that must be the number itself — unlike
    // the public query parameter, where whitespace is part of the value and is rejected.
    const token = entry.trim();
    if (token === "") {
      throw new CourseConfigError(`${variable}="${raw}" contains an empty entry. Expected a list like "1,2".`);
    }
    const year = parseStrictCourse(token);
    if (year === null) {
      throw new CourseConfigError(
        `${variable}="${raw}" contains "${token}", which is not a course year. ` +
          `Expected plain decimal numbers, e.g. "1,2".`,
      );
    }
    if (!known.includes(year)) {
      throw new CourseConfigError(
        `${variable}="${raw}" names course year ${year}, which this application does not implement ` +
          `(known: ${known.join(", ")}).`,
      );
    }
    return year;
  });

  const duplicate = years.find((year, index) => years.indexOf(year) !== index);
  if (duplicate !== undefined) {
    throw new CourseConfigError(`${variable}="${raw}" lists course year ${duplicate} more than once.`);
  }
  return years;
}

export interface CourseSelection {
  /** Enabled course years, in the order the operator configured them. */
  years: number[];
  /** The course an omitted `?course=` resolves to. */
  defaultYear: number;
}

/**
 * Resolve the deployment's course configuration, or throw CourseConfigError.
 * Pure: it reads nothing but the env object handed to it, so the rules are testable
 * without restarting a process.
 */
export function resolveCourseSelection(
  env: NodeJS.ProcessEnv,
  known: readonly number[] = KNOWN_COURSE_YEARS,
): CourseSelection {
  // SCHEDULE_COURSE_YEAR pinned a single-course deployment before multi-course support.
  // Honouring it would serve one course while the rest of the configuration says two, and
  // ignoring it would silently change what a deployment serves — so it is a hard stop.
  const legacy = env.SCHEDULE_COURSE_YEAR;
  if (legacy !== undefined && legacy.trim() !== "") {
    throw new CourseConfigError(
      `SCHEDULE_COURSE_YEAR="${legacy}" is no longer supported: one deployment now serves several ` +
        `course years. Replace it with SCHEDULE_COURSES (e.g. SCHEDULE_COURSES=${legacy.trim()} to keep ` +
        `serving only that course, or SCHEDULE_COURSES=1,2 for both) and, if needed, ` +
        `SCHEDULE_DEFAULT_COURSE. See .env.example.`,
    );
  }

  const years =
    env.SCHEDULE_COURSES === undefined
      ? [...known]
      : parseConfiguredList(env.SCHEDULE_COURSES, "SCHEDULE_COURSES", known);

  if (env.SCHEDULE_DEFAULT_COURSE === undefined) return { years, defaultYear: years[0] };

  const requested = parseConfiguredList(env.SCHEDULE_DEFAULT_COURSE, "SCHEDULE_DEFAULT_COURSE", known);
  if (requested.length !== 1) {
    throw new CourseConfigError(
      `SCHEDULE_DEFAULT_COURSE="${env.SCHEDULE_DEFAULT_COURSE}" must name exactly one course year.`,
    );
  }
  if (!years.includes(requested[0])) {
    throw new CourseConfigError(
      `SCHEDULE_DEFAULT_COURSE=${requested[0]} is not among the enabled courses (${years.join(", ")}). ` +
        `Add it to SCHEDULE_COURSES or pick an enabled course year.`,
    );
  }
  return { years, defaultYear: requested[0] };
}

const selection = resolveCourseSelection(process.env);
const CATALOG = catalog(process.env);

/** Courses this deployment serves, in configured order. */
export const SUPPORTED_COURSES: readonly CourseDefinition[] = selection.years.map(
  (year) => CATALOG.find((course) => course.year === year) as CourseDefinition,
);

export const SUPPORTED_COURSE_YEARS: readonly number[] = SUPPORTED_COURSES.map((course) => course.year);

/** The course an omitted `?course=` parameter resolves to; Anul I keeps the historical default. */
export const DEFAULT_COURSE_YEAR: number = selection.defaultYear;

export function isSupportedCourse(courseYear: unknown): courseYear is number {
  return typeof courseYear === "number" && SUPPORTED_COURSE_YEARS.includes(courseYear);
}

/**
 * Gate for every exported stateful boundary (storage, updater, read services). An
 * unsupported year throws instead of being normalised, so no code path can create or
 * read a namespace like `data/courses/3`.
 */
export function assertSupportedCourse(courseYear: unknown): number {
  if (!isSupportedCourse(courseYear)) throw new UnsupportedCourseError(courseYear);
  return courseYear;
}

/** Throws for an unsupported year: callers reaching this point have already validated input. */
export function courseDefinition(courseYear: number): CourseDefinition {
  assertSupportedCourse(courseYear);
  return SUPPORTED_COURSES.find((item) => item.year === courseYear) as CourseDefinition;
}

export function courseSeed(courseYear: number): CourseSeed | null {
  return courseDefinition(courseYear).seed;
}

export function courseLabel(courseYear: number): string {
  return courseDefinition(courseYear).label;
}

export type CourseParamResult =
  | { ok: true; courseYear: number; supplied: boolean }
  | { ok: false; reason: string };

/**
 * Resolve the public `course` selector of a request.
 *
 *   absent            → the default course (pre-multi-course clients keep working)
 *   "1" / "2"         → that course
 *   anything else     → rejected, including an empty value, whitespace, "01", "1.0",
 *                       "0", "-1", "3" and a repeated parameter
 *
 * A present-but-unusable value is never treated as absent: `?course=` asks a question
 * this deployment cannot answer, and answering it with course 1 is the silent
 * resolution this whole module exists to prevent.
 */
export function resolveCourseParam(params: URLSearchParams): CourseParamResult {
  const values = params.getAll("course");
  if (values.length === 0) return { ok: true, courseYear: DEFAULT_COURSE_YEAR, supplied: false };
  if (values.length > 1) {
    return { ok: false, reason: `course was given ${values.length} times; supply it at most once` };
  }
  return resolveCourseValue(values[0]);
}

/** The single-value half of `resolveCourseParam`, for callers holding a raw value (e.g. a JSON body). */
export function resolveCourseValue(raw: string): CourseParamResult {
  const courseYear = parseStrictCourse(raw);
  if (courseYear === null || !isSupportedCourse(courseYear)) {
    return { ok: false, reason: `unknown course ${JSON.stringify(raw)}` };
  }
  return { ok: true, courseYear, supplied: true };
}
