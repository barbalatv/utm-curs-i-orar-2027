import type { NextRequest } from "next/server";
import { json, resolveCourse, withErrorHandling } from "@/lib/api";
import { config } from "@/lib/config";
import { getCurrentSchedule, getSourceState } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Provenance of the data currently served for one course: which PDF, discovered where, when. */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const course = resolveCourse(request.nextUrl.searchParams);
  if (!course.ok) return course.response;

  const [schedule, state] = await Promise.all([
    getCurrentSchedule(course.courseYear),
    getSourceState(course.courseYear),
  ]);
  return json({
    course_year: course.courseYear,
    official_page_url: config.schedulePageUrl,
    pdf_url: schedule?.metadata.source_pdf_url ?? state.current_pdf_url,
    pdf_hash: schedule?.metadata.source_pdf_hash ?? state.current_pdf_hash,
    source_kind: schedule?.metadata.source_kind ?? null,
    pdf_title: schedule?.metadata.pdf_title ?? null,
    academic_year: schedule?.metadata.academic_year ?? state.academic_year,
    semester: schedule?.metadata.semester ?? state.semester,
    downloaded_at: schedule?.metadata.downloaded_at ?? null,
    parsed_at: schedule?.metadata.parsed_at ?? null,
    etag: state.etag,
    last_modified: state.last_modified,
    last_check_at: state.last_check_at,
    last_success_at: state.last_success_at,
    last_result: state.last_result,
    last_error: state.last_error,
    parity_note: state.parity_note,
  });
});
