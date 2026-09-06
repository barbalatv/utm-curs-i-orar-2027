import type { NextRequest } from "next/server";
import { json, resolveCourse, withErrorHandling } from "@/lib/api";
import { buildStatus } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

/** GET /api/status?course=2 – schedule, source state and diagnostics of that course alone. */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const course = resolveCourse(request.nextUrl.searchParams);
  if (!course.ok) return course.response;
  return json(await buildStatus(course.courseYear));
});
