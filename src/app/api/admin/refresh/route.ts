import type { NextRequest } from "next/server";
import { apiError, json, withErrorHandling } from "@/lib/api";
import { config } from "@/lib/config";
import { checkForUpdates } from "@/lib/services/updater";

export const dynamic = "force-dynamic";

/**
 * Internal maintenance hook: POST /api/admin/refresh with `Authorization: Bearer <SCHEDULE_ADMIN_TOKEN>`.
 * Never accepts a URL – the PDF is always re-discovered from the official page (no SSRF surface).
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!config.adminToken) return apiError(404, "Not found");
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${config.adminToken}`) return apiError(401, "Unauthorized");
  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await checkForUpdates({ force });
  return json(result);
});
