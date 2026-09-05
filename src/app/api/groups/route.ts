import { apiError, json, withErrorHandling } from "@/lib/api";
import { requireSchedule } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const schedule = await requireSchedule();
  if (!schedule) return apiError(503, "Schedule not available yet");
  const groups = schedule.groups.map((group) => ({
    name: group.name,
    program: group.program,
    lessons: schedule.lessons.filter((lesson) => lesson.groups.includes(group.name)).length,
  }));
  return json({ groups, count: groups.length, updated_at: schedule.metadata.downloaded_at });
});
