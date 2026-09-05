import { json } from "@/lib/api";
import { getCurrentSchedule } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Liveness: the process is up. Schedule availability is reported but does not fail the check. */
export async function GET() {
  const schedule = await getCurrentSchedule().catch(() => null);
  return json({ ok: true, status: "ok", has_schedule: schedule !== null, time: new Date().toISOString() });
}
