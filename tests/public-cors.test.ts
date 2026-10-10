import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allowedMapOrigins, publicOptions, withPublicCors } from "@/lib/public-cors";

afterEach(() => vi.unstubAllEnvs());
const origin = "http://127.0.0.1:8765";
const request = (headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/schedule?course=2", { headers });
const deniedOrigins: Record<string, string>[] = [{}, { Origin: "null" }, { Origin: "http://localhost:8765" }, { Origin: `${origin}.evil` }];
const deniedPreflights: Record<string, string>[] = [
  { Origin: origin, "Access-Control-Request-Method": "POST" },
  { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
  { Origin: "null", "Access-Control-Request-Method": "GET" }, {},
];
describe("bounded public CORS", () => {
  it("rejects wildcard, null, paths, credentials and malformed allowlist entries", () => {
    expect([...allowedMapOrigins(`*,null,https://a.example/,https://a.example/path,https://u:p@a.example,${origin}`)]).toEqual([origin]);
  });
  it.each([200, 400, 503, 500])("keeps JSON/status intact and grants an exact approved origin (%s)", async (status) => {
    vi.stubEnv("SCHEDULE_MAP_ORIGINS", origin);
    const response = await withPublicCors(async () => Response.json({ course_year: 2 }, { status }))(request({ Origin: origin }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ course_year: 2 });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });
  it.each(deniedOrigins)("denies unapproved origins without breaking existing GET clients: %j", async (headers) => {
    vi.stubEnv("SCHEDULE_MAP_ORIGINS", origin);
    const response = await withPublicCors(async () => Response.json({ ok: true }))(request(headers));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });
  it("preserves existing Vary and handles allowed GET preflight", async () => {
    vi.stubEnv("SCHEDULE_MAP_ORIGINS", origin);
    const response = await withPublicCors(async () => new Response(null, { headers: { Vary: "Accept-Encoding" } }))(request());
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Origin");
    const options = publicOptions(request({ Origin: origin, "Access-Control-Request-Method": "GET" }));
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Methods")).toBe("GET");
    expect(options.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
  it.each(deniedPreflights)("denies unsupported preflights: %j", (headers) => {
    vi.stubEnv("SCHEDULE_MAP_ORIGINS", origin);
    const response = publicOptions(request(headers));
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
