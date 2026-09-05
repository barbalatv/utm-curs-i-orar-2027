import { apiError, json, withErrorHandling } from "@/lib/api";
import { filterLessons, normalizeGroupParam, requireSchedule, sortLessons, todayInChisinau } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

/** GET /api/schedule/SI-261/today – lessons for the current weekday in Europe/Chisinau. */
export const GET = withErrorHandling(async (_request: Request, context: { params: Promise<{ group: string }> }) => {
  const schedule = await requireSchedule();
  if (!schedule) return apiError(503, "Schedule not available yet");
  const { group: rawGroup } = await context.params;
  const group = normalizeGroupParam(decodeURIComponent(rawGroup));
  if (!group || !schedule.groups.some((item) => item.name === group)) return apiError(404, `Unknown group "${rawGroup}"`);

  const day = todayInChisinau();
  const lessons = day ? sortLessons(filterLessons(schedule.lessons, { group, day })) : [];
  return json({ group, day, is_weekend: day === null, lessons, count: lessons.length, updated_at: schedule.metadata.downloaded_at });
});
