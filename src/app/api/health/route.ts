import { json } from "@/lib/api";
import { SUPPORTED_COURSE_YEARS } from "@/lib/courses";
import { getCurrentSchedule } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Liveness of the deployment, not of any single timetable.
 *
 *   ok            – the process is up and answering; it never turns false for a data problem,
 *                   so an orchestrator does not restart a container that is serving fine.
 *   has_schedule  – at least one supported course has a schedule, i.e. the service is useful.
 *   courses[]     – per-course availability, so a partial outage is visible here.
 *
 * A course's *diagnostics* (last error, last check, source PDF) live in /api/status?course=N;
 * this endpoint deliberately reports no error text from one course under a shared field.
 */
export async function GET() {
  const courses = await Promise.all(
    SUPPORTED_COURSE_YEARS.map(async (courseYear) => ({
      course_year: courseYear,
      has_schedule: (await getCurrentSchedule(courseYear).catch(() => null)) !== null,
    })),
  );
  return json({
    ok: true,
    status: "ok",
    has_schedule: courses.some((course) => course.has_schedule),
    courses,
    time: new Date().toISOString(),
  });
}
