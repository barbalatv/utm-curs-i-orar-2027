import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOfficialTimetablePdf, isOfficialTimetablePdfUrl } from "@/lib/source/downloader";

const PDF = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-18.pdf";

afterEach(() => vi.unstubAllGlobals());

describe("official timetable PDF query policy", () => {
  it.each([
    PDF,
    PDF.replace("2026/09", "2025/01"),
    PDF.replace(".pdf", ".PDF"),
    PDF.replace("anul_i", "anul%20i"),
  ])("keeps valid official URL %s", async (url) => {
    expect(isOfficialTimetablePdfUrl(url)).toBe(true);
    const fetch = vi.fn().mockResolvedValue(new Response("%PDF-1.4", {
      headers: { "content-type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchOfficialTimetablePdf(url)).finalUrl).toBe(url);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["?x=1", "#fragment"])("rejects initial URL suffix %s before fetching", async (suffix) => {
    const fetch = vi.fn().mockResolvedValue(new Response(new TextEncoder().encode("%PDF-1.4")));
    vi.stubGlobal("fetch", fetch);
    expect(isOfficialTimetablePdfUrl(PDF + suffix)).toBe(false);
    await expect(fetchOfficialTimetablePdf(PDF + suffix)).rejects.toMatchObject({ kind: "blocked" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["?x=1", `${PDF}?x=1`, "#fragment"])("rejects redirect target %s before the next request", async (location) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
      .mockResolvedValue(new Response(new TextEncoder().encode("%PDF-1.4")));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchOfficialTimetablePdf(PDF)).rejects.toMatchObject({ kind: "blocked" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  });

  it("still follows a canonical official PDF redirect", async () => {
    const target = PDF.replace("-18.pdf", "-19.pdf");
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode("%PDF-1.4")));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchOfficialTimetablePdf(PDF)).finalUrl).toBe(target);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
