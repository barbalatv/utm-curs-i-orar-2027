/** Shared helpers for JSON API responses – never leak stack traces to clients. */
import { NextResponse } from "next/server";
import { errorMessage, getLogger } from "@/lib/logger";

const log = getLogger("api");

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function apiError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, { status });
}

/** Wrap a route handler so unexpected failures become a clean 500 JSON payload. */
export function withErrorHandling<TArgs extends unknown[]>(handler: (...args: TArgs) => Promise<Response>) {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      log.error("unhandled API error", { error: errorMessage(error) });
      return apiError(500, "Internal server error");
    }
  };
}
