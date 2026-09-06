import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, withErrorHandling } from "@/lib/api";
import { config } from "@/lib/config";
import { resolveCourseParam, resolveCourseValue, SUPPORTED_COURSE_YEARS } from "@/lib/courses";
import { checkForUpdates, refreshFromExplicitPdf } from "@/lib/services/updater";
import { isOfficialTimetablePdfUrl } from "@/lib/source/downloader";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 8 * 1024;
const RefreshBodySchema = z
  .object({
    course: z.number().int().optional(),
    pdf_url: z.string().trim().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

/**
 * Internal maintenance hook: POST /api/admin/refresh with `Authorization: Bearer <SCHEDULE_ADMIN_TOKEN>`.
 *
 * `course` selects which course year is refreshed. It is mandatory whenever an explicit
 * `pdf_url` is supplied — the course a document belongs to is never guessed from its URL,
 * and the parsed-PDF course guard still has the last word, so pointing an Anul I PDF at
 * course 2 is rejected and leaves both courses untouched. Omitted on a plain discovery
 * refresh it means the default course, which keeps the pre-multi-course call working.
 *
 * With no body it performs normal discovery. An optional explicit URL is restricted
 * to FCIM's HTTPS WordPress timetable-PDF path and every redirect is revalidated.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!config.adminToken) return apiError(404, "Not found");
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${config.adminToken}`) return apiError(401, "Unauthorized");

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return apiError(413, "Request body too large");
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return apiError(413, "Request body too large");
  }

  let payload: unknown = {};
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiError(400, "Invalid JSON body");
    }
  }
  const parsed = RefreshBodySchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "Invalid refresh request");

  // `course` may arrive in the body or the query string. Both are parsed strictly, and a
  // present-but-invalid value is an error rather than a fallback; only a fully absent
  // parameter means "not supplied", which is acceptable for a plain discovery refresh.
  const selected =
    parsed.data.course !== undefined
      ? resolveCourseValue(String(parsed.data.course))
      : resolveCourseParam(request.nextUrl.searchParams);
  if (!selected.ok) {
    return apiError(400, `Invalid course selector: ${selected.reason}`, {
      supported_courses: [...SUPPORTED_COURSE_YEARS],
    });
  }
  const courseYear = selected.courseYear;

  const force = parsed.data.force ?? request.nextUrl.searchParams.get("force") === "1";
  if (parsed.data.pdf_url) {
    if (!selected.supplied) {
      return apiError(400, "course is required when refreshing from an explicit pdf_url", {
        supported_courses: [...SUPPORTED_COURSE_YEARS],
      });
    }
    if (!isOfficialTimetablePdfUrl(parsed.data.pdf_url)) {
      return apiError(
        400,
        "pdf_url must be an HTTPS fcim.utm.md timetable PDF under /wp-content/uploads/sites/24/YYYY/MM/",
      );
    }
    return json(await refreshFromExplicitPdf(courseYear, { pdfUrl: parsed.data.pdf_url, force }));
  }

  return json(await checkForUpdates(courseYear, { force }));
});
