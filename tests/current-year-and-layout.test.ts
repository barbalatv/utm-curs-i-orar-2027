import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grid } from "@/lib/parser/geometry";
import type { TextItem } from "@/lib/parser/pdf-extract";
import { detectGroups } from "@/lib/parser/table-detector";
import { discoverPdf } from "@/lib/source/discovery";
import { fetchWordPressSchedulePage } from "@/lib/source/downloader";

const CURRENT_PAGE = `
  <div>
    <h3 data-title="Ciclul I, Licență - învățământ cu frecvență">Licență</h3>
    <table>
      <tr><td>Orar Semestrul de PRIMĂVARĂ a.u.2025/2026</td><td><a href="/2026/03/old.pdf">Anul I</a></td></tr>
      <tr><td>Orar Semestrul de TOAMNĂ a.u.2026/2027</td><td><a href="/2026/09/current.pdf">Anul I</a></td></tr>
    </table>
  </div>`;

afterEach(() => vi.unstubAllGlobals());

describe("current academic year discovery", () => {
  it("selects the current academic year before choosing the semester", () => {
    const found = discoverPdf(CURRENT_PAGE, 1, new Date("2026-09-05T12:00:00.000Z"));
    expect(found.academic_year).toBe("2026/2027");
    expect(found.pdf_url).toBe("https://fcim.utm.md/2026/09/current.pdf");
  });

  it("rejects an archive page that only contains last year's schedule", () => {
    const stale = CURRENT_PAGE.replace(/<tr><td>Orar Semestrul de TOAMNĂ[\s\S]*?<\/tr>/, "");
    expect(() => discoverPdf(stale, 1, new Date("2026-09-05T12:00:00.000Z"))).toThrow(/current academic year 2026\/2027/);
  });
});

describe("official WordPress fallback", () => {
  it("extracts the rendered schedule page from the REST response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ content: { rendered: CURRENT_PAGE } }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    );
    const html = await fetchWordPressSchedulePage("https://fcim.utm.md/wp-json/wp/v2/pages?slug=orar&context=view");
    expect(discoverPdf(html, 1, new Date("2026-09-05T12:00:00.000Z")).academic_year).toBe("2026/2027");
  });
});

function text(textValue: string, x: number, y: number): TextItem {
  return { text: textValue, font: "test", page: 1, x0: x - 4, x1: x + 4, y0: y - 1, y1: y + 1 };
}

const grid: Grid = {
  vertical: [0, 20, 40, 60, 90].map((at) => ({ at, from: 0, to: 100 })),
  horizontal: [0, 10, 20, 100].map((at) => ({ at, from: 0, to: 90 })),
  backgrounds: [],
};

describe("group header detection", () => {
  it("uses the header row, keeps aliases, and ignores corner-cell artifacts", () => {
    const texts = [
      text("SI-261", 10, 5),
      text("SD-261", 30, 5),
      text("R-263", 50, 4),
      text("AI-264", 50, 7),
      text("SI-222", 75, 5),
      text("TI-002", 30, 15),
    ];
    expect(detectGroups(texts, grid).map((group) => group.name)).toEqual(["SI-261", "SD-261", "R-263", "AI-264"]);
  });
});
