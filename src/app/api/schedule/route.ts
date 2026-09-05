import type { NextRequest } from "next/server";
import { apiError, json, withErrorHandling } from "@/lib/api";
import { filterLessons, normalizeDayParam, requireSchedule, sortLessons } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

/** GET /api/schedule?group=SI-261&day=Luni&teacher=&subject=&room=&q= */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const schedule = await requireSchedule();
  if (!schedule) return apiError(503, "Schedule not available yet");
  const params = request.nextUrl.searchParams;
  const rawDay = params.get("day");
  if (rawDay && !normalizeDayParam(rawDay)) return apiError(400, `Unknown day "${rawDay}"`);

  const lessons = sortLessons(
    filterLessons(schedule.lessons, {
      group: params.get("group"),
      day: rawDay,
      teacher: params.get("teacher"),
      subject: params.get("subject"),
      room: params.get("room"),
      q: params.get("q"),
    }),
  );
  return json({
    metadata: schedule.metadata,
    groups: schedule.groups.map((group) => group.name),
    days: schedule.days,
    time_slots: schedule.time_slots,
    lessons,
    count: lessons.length,
    warnings: schedule.warnings,
  });
});
