/**
 * What the browser remembers across visits. The rule this suite protects: a reader's
 * Anul I choice and Anul II choice never overwrite each other, so switching back and
 * forth restores each side's own group.
 *
 * The module takes its storage as an argument, so this is exercised against a plain
 * in-memory Map rather than a headless browser.
 */
import { describe, expect, it } from "vitest";
import {
  COURSE_KEY,
  GROUPS_KEY,
  LEGACY_GROUP_KEY,
  groupFor,
  readPreferences,
  rememberCourse,
  rememberGroup,
  type StorageLike,
} from "@/lib/client/preferences";

const COURSES = [1, 2];

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

/** A storage that throws on every access, as a browser with site data disabled does. */
const hostileStorage: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("course and group persistence", () => {
  it("starts a fresh reader on the default course with no group", () => {
    const preferences = readPreferences(fakeStorage(), COURSES, 1);
    expect(preferences.course).toBe(1);
    expect(groupFor(preferences, 1)).toBeNull();
    expect(groupFor(preferences, 2)).toBeNull();
  });

  it("remembers one group per course and restores each on switching", () => {
    const storage = fakeStorage();
    let preferences = readPreferences(storage, COURSES, 1);

    preferences = rememberGroup(storage, preferences, 1, "SI-261");
    rememberCourse(storage, 2);
    preferences = rememberGroup(storage, preferences, 2, "TI-251");

    // Course 1's choice survived writing course 2's.
    expect(groupFor(preferences, 1)).toBe("SI-261");
    expect(groupFor(preferences, 2)).toBe("TI-251");

    // A later visit reads back both, and reopens on the course last used.
    const reloaded = readPreferences(storage, COURSES, 1);
    expect(reloaded.course).toBe(2);
    expect(groupFor(reloaded, 2)).toBe("TI-251");
    expect(groupFor(reloaded, 1)).toBe("SI-261");

    rememberCourse(storage, 1);
    const backToAnulI = readPreferences(storage, COURSES, 1);
    expect(backToAnulI.course).toBe(1);
    expect(groupFor(backToAnulI, 1)).toBe("SI-261");
    expect(groupFor(backToAnulI, 2)).toBe("TI-251");
  });

  it("clears one course's group without touching the other", () => {
    const storage = fakeStorage();
    let preferences = readPreferences(storage, COURSES, 1);
    preferences = rememberGroup(storage, preferences, 1, "SI-261");
    preferences = rememberGroup(storage, preferences, 2, "TI-251");

    preferences = rememberGroup(storage, preferences, 2, null);

    expect(groupFor(preferences, 2)).toBeNull();
    expect(groupFor(preferences, 1)).toBe("SI-261");
    expect(groupFor(readPreferences(storage, COURSES, 1), 1)).toBe("SI-261");
  });

  it("adopts a group stored before multi-course support as an Anul I group", () => {
    const storage = fakeStorage({ [LEGACY_GROUP_KEY]: "SI-261" });

    const preferences = readPreferences(storage, COURSES, 1);

    expect(preferences.course).toBe(1);
    expect(groupFor(preferences, 1)).toBe("SI-261");
    // It must never become the Anul II selection: that group does not exist there.
    expect(groupFor(preferences, 2)).toBeNull();
  });

  it("retires the legacy key once the reader picks an Anul I group again", () => {
    const storage = fakeStorage({ [LEGACY_GROUP_KEY]: "SI-261" });
    const preferences = readPreferences(storage, COURSES, 1);

    rememberGroup(storage, preferences, 1, "SI-262");

    expect(storage.dump()[LEGACY_GROUP_KEY]).toBeUndefined();
    expect(groupFor(readPreferences(storage, COURSES, 1), 1)).toBe("SI-262");
  });

  it("prefers the new schema when both keys are present", () => {
    const storage = fakeStorage({
      [LEGACY_GROUP_KEY]: "SI-261",
      [GROUPS_KEY]: JSON.stringify({ 1: "SI-263", 2: "TI-251" }),
    });

    const preferences = readPreferences(storage, COURSES, 1);
    expect(groupFor(preferences, 1)).toBe("SI-263");
    expect(groupFor(preferences, 2)).toBe("TI-251");
  });

  it("falls back to the default course when the stored one is no longer served", () => {
    const storage = fakeStorage({ [COURSE_KEY]: "7", [GROUPS_KEY]: JSON.stringify({ 1: "SI-261", 7: "XX-701" }) });

    const preferences = readPreferences(storage, COURSES, 1);

    expect(preferences.course).toBe(1);
    expect(groupFor(preferences, 1)).toBe("SI-261");
    // A course this deployment does not serve keeps its entry but is never selected.
    expect(groupFor(preferences, 7)).toBe("XX-701");
  });

  it("refuses a malformed persisted course instead of parsing it loosely", () => {
    // Number.parseInt would read "01" and "1x" as course 1 and " 2 " as course 2; a value
    // that is not exactly "1" or "2" must fall back to the configured default instead.
    for (const stored of ["01", "1x", "", " ", "  2", "2 ", "1.0", "+1", "-1", "0", "abc", "3"]) {
      const preferences = readPreferences(fakeStorage({ [COURSE_KEY]: stored }), COURSES, 2);
      expect(preferences.course, stored).toBe(2);
    }
    expect(readPreferences(fakeStorage({ [COURSE_KEY]: "1" }), COURSES, 2).course).toBe(1);
    expect(readPreferences(fakeStorage({ [COURSE_KEY]: "2" }), COURSES, 1).course).toBe(2);
  });

  it("ignores group entries filed under a malformed course key", () => {
    const storage = fakeStorage({
      [GROUPS_KEY]: JSON.stringify({ "01": "SI-999", "1": "SI-261", " 2": "TI-999", "2": "TI-251" }),
    });

    const preferences = readPreferences(storage, COURSES, 1);
    expect(groupFor(preferences, 1)).toBe("SI-261");
    expect(groupFor(preferences, 2)).toBe("TI-251");
    expect(Object.keys(preferences.groups).sort()).toEqual(["1", "2"]);
  });

  it("survives corrupt or hostile storage", () => {
    const corrupt = readPreferences(fakeStorage({ [GROUPS_KEY]: "{not json", [COURSE_KEY]: "abc" }), COURSES, 2);
    expect(corrupt).toEqual({ course: 2, groups: {} });

    const arrayValue = readPreferences(fakeStorage({ [GROUPS_KEY]: "[1,2]" }), COURSES, 1);
    expect(arrayValue.groups).toEqual({});

    const blocked = readPreferences(hostileStorage, COURSES, 1);
    expect(blocked).toEqual({ course: 1, groups: {} });
    expect(() => rememberCourse(hostileStorage, 2)).not.toThrow();
    expect(() => rememberGroup(hostileStorage, blocked, 2, "TI-251")).not.toThrow();

    const missing = readPreferences(null, COURSES, 1);
    expect(missing).toEqual({ course: 1, groups: {} });
  });
});
