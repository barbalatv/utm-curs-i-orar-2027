import type { NextRequest } from "next/server";
import { apiError, json, resolveCourse, withErrorHandling } from "@/lib/api";
import { requireSchedule } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

/** GET /api/groups?course=2 – the group columns of one course, never a merged list. */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const course = resolveCourse(request.nextUrl.searchParams);
  if (!course.ok) return course.response;

  const schedule = await requireSchedule(course.courseYear);
  if (!schedule) return apiError(503, "Schedule not available yet", { course_year: course.courseYear });
  const groups = schedule.groups.map((group) => ({
    name: group.name,
    program: group.program,
    lessons: schedule.lessons.filter((lesson) => lesson.groups.includes(group.name)).length,
  }));
  return json({
    course_year: course.courseYear,
    groups,
    count: groups.length,
    updated_at: schedule.metadata.downloaded_at,
  });
});
