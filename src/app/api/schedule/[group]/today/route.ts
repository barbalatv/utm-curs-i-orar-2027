import type { NextRequest } from "next/server";
import { apiError, json, resolveCourse, withErrorHandling } from "@/lib/api";
import { filterLessons, normalizeGroupParam, requireSchedule, sortLessons, todayInChisinau } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

/** GET /api/schedule/SI-261/today?course=1 – lessons for the current weekday in Europe/Chisinau. */
export const GET = withErrorHandling(async (request: NextRequest, context: { params: Promise<{ group: string }> }) => {
  const course = resolveCourse(request.nextUrl.searchParams);
  if (!course.ok) return course.response;

  const schedule = await requireSchedule(course.courseYear);
  if (!schedule) return apiError(503, "Schedule not available yet", { course_year: course.courseYear });
  const { group: rawGroup } = await context.params;
  const group = normalizeGroupParam(decodeURIComponent(rawGroup));
  if (!group || !schedule.groups.some((item) => item.name === group)) {
    return apiError(404, `Unknown group "${rawGroup}"`, { course_year: course.courseYear });
  }

  const day = todayInChisinau();
  const lessons = day ? sortLessons(filterLessons(schedule.lessons, { group, day })) : [];
  return json({ group, course_year: course.courseYear, day, is_weekend: day === null, lessons, count: lessons.length, updated_at: schedule.metadata.downloaded_at });
});
