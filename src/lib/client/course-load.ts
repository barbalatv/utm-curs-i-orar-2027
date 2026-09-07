/**
 * Loading one course's payload into the UI, without ever rendering another course's data.
 *
 * Comparing the response's course to the currently selected course is not enough. Course
 * numbers repeat, so an "is this still course 1?" check passes for a *stale* course 1
 * response that lands after a newer one:
 *
 *   load A (course 1) ─────────────────────────────────────▶ resolves last, still "course 1"
 *      switch to 2 ─▶ switch back to 1 ─▶ load B (course 1) ─▶ resolves first
 *
 * Every load therefore takes a generation from a monotonically increasing counter, and
 * only the newest generation may touch UI state — the classic ABA fix. Anything that
 * changes what should be on screen (a course switch) bumps the counter too, so an
 * in-flight load is invalidated the moment the reader moves on.
 *
 * The second rule is that schedule and status must agree with each other *and* with the
 * course that was asked for, so a half-updated screen (course 2 lessons under a course 1
 * footer) can never be rendered.
 */
import type { ScheduleResponse, StatusResponse } from "@/lib/client/types";

export interface CoursePayload {
  schedule: ScheduleResponse;
  status: StatusResponse;
}

export type LoadOutcome =
  | { kind: "applied"; payload: CoursePayload }
  | { kind: "failed"; message: string }
  /** A newer generation exists: this response is dropped without touching any state. */
  | { kind: "stale" };

/** Monotonic generation counter. One instance per mounted view. */
export class LoadGenerations {
  private counter = 0;

  /** Claim the newest generation; every older in-flight load becomes stale. */
  next(): number {
    this.counter += 1;
    return this.counter;
  }

  /** Invalidate everything in flight without starting a load (used when switching course). */
  invalidate(): void {
    this.counter += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.counter;
  }
}

/**
 * Both documents must describe the requested course. The server already scopes them, so
 * a mismatch means a proxy, a cache or a redirect answered with the wrong course — which
 * is exactly the situation that must not reach the screen.
 */
export function payloadMismatch(courseYear: number, payload: CoursePayload): string | null {
  const scheduleCourse = payload.schedule.metadata.course_year;
  if (payload.schedule.course_year !== courseYear || scheduleCourse !== courseYear) {
    return `schedule belongs to course ${payload.schedule.course_year} (document: ${scheduleCourse}), expected ${courseYear}`;
  }
  if (payload.status.course_year !== courseYear) {
    return `status belongs to course ${payload.status.course_year}, expected ${courseYear}`;
  }
  return null;
}

export interface LoadDeps {
  fetchJson: <T>(url: string) => Promise<T>;
  generations: LoadGenerations;
}

/**
 * Fetch one course and report what the caller may do with the result. The caller applies
 * state only for "applied"/"failed"; "stale" means a newer load has taken over and this
 * one must change nothing at all — not the schedule, not the status, not the error.
 */
export async function loadCourse(courseYear: number, deps: LoadDeps): Promise<LoadOutcome> {
  const generation = deps.generations.next();
  try {
    const [schedule, status] = await Promise.all([
      deps.fetchJson<ScheduleResponse>(`/api/schedule?course=${courseYear}`),
      deps.fetchJson<StatusResponse>(`/api/status?course=${courseYear}`),
    ]);
    if (!deps.generations.isCurrent(generation)) return { kind: "stale" };

    const payload = { schedule, status };
    const mismatch = payloadMismatch(courseYear, payload);
    if (mismatch) return { kind: "failed", message: mismatch };
    return { kind: "applied", payload };
  } catch (error) {
    if (!deps.generations.isCurrent(generation)) return { kind: "stale" };
    return { kind: "failed", message: (error as Error).message };
  }
}
