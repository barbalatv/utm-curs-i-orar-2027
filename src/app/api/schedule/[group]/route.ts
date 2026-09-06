import type { NextRequest } from "next/server";
import { apiError, json, resolveCourse, withErrorHandling } from "@/lib/api";
import { filterLessons, normalizeDayParam, normalizeGroupParam, requireSchedule, sortLessons } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/schedule/SI-261?course=1&day=Luni – schedule projected onto one group, grouped by day.
 * The course comes from the query string: a group name is unique inside a course, not across the
 * whole faculty, so it is never used to guess which timetable was meant.
 */
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

  const rawDay = request.nextUrl.searchParams.get("day");
  if (rawDay && !normalizeDayParam(rawDay)) return apiError(400, `Unknown day "${rawDay}"`);

  const lessons = sortLessons(filterLessons(schedule.lessons, { group, day: rawDay }));
  const byDay = Object.fromEntries(schedule.days.map((day) => [day, lessons.filter((lesson) => lesson.day === day)]));
  return json({ group, course_year: course.courseYear, metadata: schedule.metadata, time_slots: schedule.time_slots, days: schedule.days, lessons, by_day: byDay, count: lessons.length });
});
