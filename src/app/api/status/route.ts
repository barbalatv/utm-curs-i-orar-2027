import { json, withErrorHandling } from "@/lib/api";
import { buildStatus } from "@/lib/services/schedule-service";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => json(await buildStatus()));
