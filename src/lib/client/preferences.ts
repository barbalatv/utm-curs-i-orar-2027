/**
 * What the browser remembers between visits: the selected course and one group
 * *per course*, so switching Anul I ↔ Anul II restores each side's own choice
 * instead of overwriting it.
 *
 * Kept free of `window` so the whole thing is testable with a plain object:
 * every function takes the storage it should work on, and a missing or broken
 * store simply yields the defaults rather than throwing (private windows,
 * disabled site data, a hand-edited value).
 */

export const COURSE_KEY = "fcim-schedule:course";
export const GROUPS_KEY = "fcim-schedule:groups";
/** Single-course era: a bare group name, which by definition belonged to Anul I. */
export const LEGACY_GROUP_KEY = "fcim-schedule:group";
const LEGACY_COURSE_YEAR = 1;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Canonical decimal course year — the client-side twin of the server's strict parser.
 * Deliberately duplicated rather than imported: `@/lib/courses` reads node:path and the
 * deployment configuration, none of which belongs in the browser bundle. Number.parseInt
 * is not usable here either; it would turn a persisted "01" or "1x" into course 1.
 */
const STRICT_COURSE_TOKEN = /^[1-9][0-9]*$/;

function strictCourse(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !STRICT_COURSE_TOKEN.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export interface Preferences {
  course: number;
  /** Course year → last group chosen there. Courses never share an entry. */
  groups: Record<number, string>;
}

function read(storage: StorageLike | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage is a convenience here; the app stays usable when it is unavailable.
  }
}

function parseGroups(raw: string | null): Record<number, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const groups: Record<number, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const course = strictCourse(key);
    if (course !== null && typeof value === "string" && value) groups[course] = value;
  }
  return groups;
}

/**
 * Restore the stored selection, narrowed to what this deployment serves.
 * A stored course that is no longer supported falls back to the default one; the
 * groups of other courses survive untouched, ready for the next switch back.
 */
export function readPreferences(
  storage: StorageLike | null | undefined,
  supportedCourses: readonly number[],
  defaultCourse: number,
): Preferences {
  const groups = parseGroups(read(storage, GROUPS_KEY));

  const legacyGroup = read(storage, LEGACY_GROUP_KEY);
  if (legacyGroup && groups[LEGACY_COURSE_YEAR] === undefined) groups[LEGACY_COURSE_YEAR] = legacyGroup;

  // A malformed or no-longer-served stored course falls back to the configured default,
  // never to whatever a lenient parse would have read out of it.
  const storedCourse = strictCourse(read(storage, COURSE_KEY));
  const course = storedCourse !== null && supportedCourses.includes(storedCourse) ? storedCourse : defaultCourse;
  return { course, groups };
}

export function groupFor(preferences: Preferences, course: number): string | null {
  return preferences.groups[course] ?? null;
}

export function rememberCourse(storage: StorageLike | null | undefined, course: number): void {
  write(storage, COURSE_KEY, String(course));
}

/**
 * Remember (or forget) the group of one course. Writing course 2 never disturbs the
 * course 1 entry, and the legacy key is retired once a course 1 group is written
 * through the new schema so the two cannot drift apart.
 */
export function rememberGroup(
  storage: StorageLike | null | undefined,
  preferences: Preferences,
  course: number,
  group: string | null,
): Preferences {
  const groups = { ...preferences.groups };
  if (group) groups[course] = group;
  else delete groups[course];

  write(storage, GROUPS_KEY, JSON.stringify(groups));
  if (course === LEGACY_COURSE_YEAR) write(storage, LEGACY_GROUP_KEY, null);
  return { ...preferences, groups };
}
