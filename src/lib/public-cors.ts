/** CORS is opt-in on public read routes only. Admin handlers never use this wrapper. */
import type { NextRequest } from "next/server";

export function allowedMapOrigins(raw = process.env.SCHEDULE_MAP_ORIGINS ?? ""): Set<string> {
  return new Set(raw.split(",").map((value) => value.trim()).filter((value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && url.origin === value && !url.username && !url.password;
    } catch { return false; }
  }));
}

function corsHeaders(request: NextRequest, response: Response): Response {
  const vary = response.headers.get("Vary");
  if (!vary?.split(",").some((part) => part.trim().toLowerCase() === "origin")) {
    response.headers.set("Vary", [vary, "Origin"].filter(Boolean).join(", "));
  }
  const origin = request.headers.get("Origin");
  if (origin && allowedMapOrigins().has(origin)) response.headers.set("Access-Control-Allow-Origin", origin);
  return response;
}

export function withPublicCors(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => corsHeaders(request, await handler(request));
}

export function publicOptions(request: NextRequest): Response {
  const origin = request.headers.get("Origin");
  const method = request.headers.get("Access-Control-Request-Method");
  // The map uses simple GET requests, with no credentials or custom headers.
  const headers = request.headers.get("Access-Control-Request-Headers");
  if (!origin || !allowedMapOrigins().has(origin) || method !== "GET" || headers?.trim()) {
    return new Response(null, { status: 403, headers: { Vary: "Origin", "Cache-Control": "no-store" } });
  }
  return corsHeaders(request, new Response(null, {
    status: 204, headers: { "Access-Control-Allow-Methods": "GET", "Cache-Control": "no-store" },
  }));
}
