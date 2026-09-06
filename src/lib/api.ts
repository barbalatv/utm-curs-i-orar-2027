/** Shared helpers for JSON API responses – never leak stack traces to clients. */
import { NextResponse } from "next/server";
import { resolveCourseParam, SUPPORTED_COURSE_YEARS } from "@/lib/courses";
import { errorMessage, getLogger } from "@/lib/logger";

const log = getLogger("api");

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function apiError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, { status });
}

/** Wrap a route handler so unexpected failures become a clean 500 JSON payload. */
export function withErrorHandling<TArgs extends unknown[]>(handler: (...args: TArgs) => Promise<Response>) {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      log.error("unhandled API error", { error: errorMessage(error) });
      return apiError(500, "Internal server error");
    }
  };
}

export type CourseResolution = { ok: true; courseYear: number } | { ok: false; response: Response };

/**
 * Resolve the `?course=` parameter of a public route. An omitted parameter means the
 * default course, so pre-multi-course clients keep working; every other shape — empty,
 * padded, zero-prefixed, non-numeric, unsupported, or repeated — is a 400. A request
 * that names a course this deployment cannot serve never receives another course's data.
 */
export function resolveCourse(params: URLSearchParams): CourseResolution {
  const resolved = resolveCourseParam(params);
  if (resolved.ok) return { ok: true, courseYear: resolved.courseYear };
  return {
    ok: false,
    response: apiError(400, `Invalid course selector: ${resolved.reason}`, {
      supported_courses: [...SUPPORTED_COURSE_YEARS],
    }),
  };
}
