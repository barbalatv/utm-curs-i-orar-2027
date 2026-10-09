import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const read = vi.hoisted(() => ({ requireSchedule: vi.fn(), buildStatus: vi.fn() }));
vi.mock("@/lib/services/schedule-service", async (original) => ({
  ...await original<typeof import("@/lib/services/schedule-service")>(), ...read,
}));
const schedule = await import("@/app/api/schedule/route");
const status = await import("@/app/api/status/route");
const admin = await import("@/app/api/admin/refresh/route");
const origin = "http://127.0.0.1:8765";
const get = (route: string, selector: string) => new NextRequest(`http://localhost/api/${route}${selector}`, { headers: { Origin: origin } });
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("SCHEDULE_MAP_ORIGINS", origin);
  read.requireSchedule.mockReset(); read.buildStatus.mockReset();
});
it.each([1, 2])("keeps course %s isolated and existing response schema intact", async (course) => {
  const metadata = { course_year: course, source_pdf_hash: `pdf-${course}`, parser_version: "1.4.0", parsed_at: "2026-10-09T00:00:00Z" };
  read.requireSchedule.mockResolvedValue({ metadata, groups: [{ name: `GROUP-${course}` }], lessons: [], days: [], time_slots: [], warnings: [] });
  read.buildStatus.mockResolvedValue({ course_year: course, schedule: metadata });
  const response = await schedule.GET(get("schedule", `?course=${course}`));
  expect(read.requireSchedule).toHaveBeenCalledExactlyOnceWith(course);
  expect(await response.json()).toEqual({ course_year: course, metadata, groups: [`GROUP-${course}`], lessons: [], days: [], time_slots: [], warnings: [], count: 0 });
  const state = await status.GET(get("status", `?course=${course}`));
  expect(read.buildStatus).toHaveBeenCalledExactlyOnceWith(course);
  expect((await state.json()).schedule).toEqual(metadata);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
});
it.each(["?course=3", "?course=01", "?course=", "?course=1&course=2"])("rejects invalid selector %s before reading any schedule", async (selector) => {
  for (const [name, route] of [["schedule", schedule], ["status", status]] as const) {
    const response = await route.GET(get(name, selector));
    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  }
  expect(read.requireSchedule).not.toHaveBeenCalled(); expect(read.buildStatus).not.toHaveBeenCalled();
});
it("does not add CORS to admin and serves missing-schedule errors with public CORS", async () => {
  read.requireSchedule.mockResolvedValue(null);
  expect((await schedule.GET(get("schedule", "?course=2"))).status).toBe(503);
  const response = await admin.POST(new NextRequest("http://localhost/api/admin/refresh", { method: "POST", headers: { Origin: origin } }));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(schedule.OPTIONS(get("schedule", "?course=1")).status).toBe(403);
});
