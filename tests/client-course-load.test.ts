/**
 * The browser must never paint a stale course payload.
 *
 * Comparing "is the response's course still the selected course?" is not enough, because
 * course numbers repeat: after 1 → 2 → 1 a response from the *first* visit to course 1
 * passes that check and can overwrite the newer one. Every load therefore carries a
 * generation, and only the newest may commit.
 *
 * These drive the real `loadCourse` used by the component, with fetches resolved by hand
 * so the interleavings are exact rather than timing-dependent.
 */
import { describe, expect, it } from "vitest";
import { loadCourse, LoadGenerations, payloadMismatch } from "@/lib/client/course-load";
import type { ScheduleResponse, StatusResponse } from "@/lib/client/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function scheduleFor(courseYear: number): ScheduleResponse {
  return {
    course_year: courseYear,
    metadata: { course_year: courseYear, semester: `S${courseYear}` } as ScheduleResponse["metadata"],
    groups: [`G-${courseYear}`],
    days: [],
    time_slots: [],
    lessons: [],
    count: 0,
    warnings: [],
  };
}

function statusFor(courseYear: number): StatusResponse {
  return { course_year: courseYear, course_label: `Anul ${courseYear}` } as StatusResponse;
}

/**
 * A fetcher whose responses are released by the test. Every request is kept, not just the
 * newest for a URL: two visits to the same course issue the same URL twice, and the whole
 * point of these tests is what happens when the *older* one answers last.
 */
function controlledFetch() {
  const pending = new Map<string, ReturnType<typeof deferred<unknown>>[]>();
  const fetchJson = <T,>(url: string): Promise<T> => {
    const gate = deferred<unknown>();
    pending.set(url, [...(pending.get(url) ?? []), gate]);
    return gate.promise as Promise<T>;
  };
  const drain = (url: string, settle: (gate: ReturnType<typeof deferred<unknown>>) => void) => {
    const gates = pending.get(url) ?? [];
    pending.set(url, []);
    for (const gate of gates) settle(gate);
  };
  const release = (courseYear: number) => {
    drain(`/api/schedule?course=${courseYear}`, (gate) => gate.resolve(scheduleFor(courseYear)));
    drain(`/api/status?course=${courseYear}`, (gate) => gate.resolve(statusFor(courseYear)));
  };
  const fail = (courseYear: number, message: string) => {
    drain(`/api/schedule?course=${courseYear}`, (gate) => gate.reject(new Error(message)));
    drain(`/api/status?course=${courseYear}`, (gate) => gate.reject(new Error(message)));
  };
  /** Resolve schedule but not status, to prove a half-arrived payload commits nothing. */
  const releaseScheduleOnly = (courseYear: number) =>
    drain(`/api/schedule?course=${courseYear}`, (gate) => gate.resolve(scheduleFor(courseYear)));
  return { fetchJson, release, fail, releaseScheduleOnly };
}

describe("stale course responses never win", () => {
  it("drops a slow course 1 response after a fast course 2 load", async () => {
    const generations = new LoadGenerations();
    const net = controlledFetch();

    const first = loadCourse(1, { fetchJson: net.fetchJson, generations });
    const second = loadCourse(2, { fetchJson: net.fetchJson, generations });

    net.release(2);
    expect(await second).toMatchObject({ kind: "applied" });
    net.release(1);
    // Course 1 started first but is no longer what the reader is looking at.
    expect(await first).toEqual({ kind: "stale" });
  });

  it("drops the older of two course 1 loads across an ABA switch", async () => {
    const generations = new LoadGenerations();
    const net = controlledFetch();

    // Visit A: course 1.
    const visitA = loadCourse(1, { fetchJson: net.fetchJson, generations });
    // Switch to 2, then back to 1 — the counter moves on both switches.
    generations.invalidate();
    const courseTwo = loadCourse(2, { fetchJson: net.fetchJson, generations });
    generations.invalidate();
    const visitB = loadCourse(1, { fetchJson: net.fetchJson, generations });

    // Visit B answers first, then the abandoned visit A finally arrives.
    net.release(1);
    const bResult = await visitB;
    expect(bResult).toMatchObject({ kind: "applied" });

    // Both course 1 loads share the same URL, so releasing once settled them both; the
    // older generation must still be reported as stale rather than re-applied.
    expect(await visitA).toEqual({ kind: "stale" });
    net.release(2);
    expect(await courseTwo).toEqual({ kind: "stale" });
  });

  it("keeps only the newest of a rapid 1 → 2 → 1 → 2 sequence", async () => {
    const generations = new LoadGenerations();
    const net = controlledFetch();

    const loads = [
      loadCourse(1, { fetchJson: net.fetchJson, generations }),
      loadCourse(2, { fetchJson: net.fetchJson, generations }),
      loadCourse(1, { fetchJson: net.fetchJson, generations }),
      loadCourse(2, { fetchJson: net.fetchJson, generations }),
    ];

    net.release(1);
    net.release(2);
    const outcomes = await Promise.all(loads);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["stale", "stale", "stale", "applied"]);
    const last = outcomes[3];
    expect(last.kind === "applied" && last.payload.schedule.course_year).toBe(2);
  });

  it("drops a late error instead of showing it over newer data", async () => {
    const generations = new LoadGenerations();
    const net = controlledFetch();

    const failing = loadCourse(1, { fetchJson: net.fetchJson, generations });
    const newer = loadCourse(2, { fetchJson: net.fetchJson, generations });

    net.release(2);
    expect(await newer).toMatchObject({ kind: "applied" });
    net.fail(1, "network down");
    // The reader is on course 2 and it loaded fine; a course 1 failure must not surface.
    expect(await failing).toEqual({ kind: "stale" });
  });

  it("drops a late status response that arrives after a newer load", async () => {
    const generations = new LoadGenerations();
    const net = controlledFetch();

    const first = loadCourse(1, { fetchJson: net.fetchJson, generations });
    // The schedule half of the first load is already back...
    net.releaseScheduleOnly(1);
    // ...and only then does the reader switch away and a newer load complete.
    const second = loadCourse(2, { fetchJson: net.fetchJson, generations });
    net.release(2);
    expect(await second).toMatchObject({ kind: "applied" });

    // The straggling status finally lands; the whole first load is discarded.
    net.release(1);
    expect(await first).toEqual({ kind: "stale" });
  });

  it("treats a course switch as invalidation even with no load in between", async () => {
    const generations = new LoadGenerations();
    const net = controlledFetch();

    const abandoned = loadCourse(1, { fetchJson: net.fetchJson, generations });
    generations.invalidate();

    net.release(1);
    expect(await abandoned).toEqual({ kind: "stale" });
  });
});

describe("mixed-course payloads are refused", () => {
  it("rejects a schedule and status that disagree", () => {
    expect(payloadMismatch(2, { schedule: scheduleFor(2), status: statusFor(2) })).toBeNull();
    expect(payloadMismatch(2, { schedule: scheduleFor(2), status: statusFor(1) })).toMatch(/status belongs to course 1/);
    expect(payloadMismatch(2, { schedule: scheduleFor(1), status: statusFor(2) })).toMatch(
      /schedule belongs to course 1/,
    );
  });

  it("rejects a schedule whose document disagrees with its envelope", () => {
    const schedule = scheduleFor(2);
    schedule.metadata = { ...schedule.metadata, course_year: 1 };
    expect(payloadMismatch(2, { schedule, status: statusFor(2) })).toMatch(/document: 1/);
  });

  it("reports a mismatch as a failure rather than painting it", async () => {
    const generations = new LoadGenerations();
    const fetchJson = async <T,>(url: string): Promise<T> =>
      (url.includes("/api/status") ? statusFor(1) : scheduleFor(2)) as T;

    const outcome = await loadCourse(2, { fetchJson, generations });
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(outcome.kind === "failed" && outcome.message).toMatch(/status belongs to course 1/);
  });
});
