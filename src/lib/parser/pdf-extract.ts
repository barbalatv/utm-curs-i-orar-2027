/**
 * Stage 1: raw extraction. Turns a PDF buffer into positioned text items and
 * filled rectangles (table grid lines + cell backgrounds). All coordinates are
 * converted to a top-left origin in PDF points so later stages can reason in
 * "screen" space.
 */
import type { Geometry } from "@/lib/models";

export interface TextItem extends Geometry {
  text: string;
  font: string;
}

export interface FillRect extends Geometry {
  color: string;
}

export interface PageExtraction {
  page: number;
  width: number;
  height: number;
  texts: TextItem[];
  rects: FillRect[];
}

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function extractPages(pdfBytes: Uint8Array): Promise<PageExtraction[]> {
  const pdfjs = await loadPdfJs();
  // pdf.js transfers (detaches) the buffer it receives – hand it a private copy
  // so callers can still hash or store the original bytes afterwards.
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  try {
    const pages: PageExtraction[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const height = viewport.height;

      const texts = await extractTexts(page, pageNumber, height);
      const rects = await extractFillRects(pdfjs, page, pageNumber, height);
      pages.push({ page: pageNumber, width: viewport.width, height, texts, rects });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJsModule["getDocument"]>["promise"]>["getPage"]>>;

async function extractTexts(page: PdfPage, pageNumber: number, pageHeight: number): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const texts: TextItem[] = [];
  for (const item of content.items) {
    if (!("str" in item) || item.str.trim() === "") continue;
    const [, , c, d, e, f] = item.transform;
    const height = item.height || Math.hypot(c, d);
    texts.push({
      page: pageNumber,
      text: item.str,
      font: item.fontName,
      x0: round(e),
      x1: round(e + item.width),
      y0: round(pageHeight - f - height),
      y1: round(pageHeight - f),
    });
  }
  return texts;
}

/**
 * Table borders in Excel-exported PDFs are drawn as thin filled rectangles, and
 * cell backgrounds as wider fills. pdf.js exposes each path with its bounding
 * box (minMax), which is all we need.
 */
async function extractFillRects(
  pdfjs: PdfJsModule,
  page: PdfPage,
  pageNumber: number,
  pageHeight: number,
): Promise<FillRect[]> {
  const opList = await page.getOperatorList();
  const fillOps = new Set<number>([pdfjs.OPS.fill, pdfjs.OPS.eoFill, pdfjs.OPS.fillStroke, pdfjs.OPS.eoFillStroke]);
  const rects: FillRect[] = [];
  let fillColor = "#000000";

  for (let index = 0; index < opList.fnArray.length; index += 1) {
    const fn = opList.fnArray[index];
    const args = opList.argsArray[index] as unknown[];
    if (fn === pdfjs.OPS.setFillRGBColor) {
      fillColor = String(args[0]);
      continue;
    }
    if (fn !== pdfjs.OPS.constructPath) continue;
    const [pathOp, , minMax] = args as [number, unknown, ArrayLike<number> | undefined];
    if (!fillOps.has(pathOp) || !minMax || minMax.length < 4) continue;
    const [minX, minY, maxX, maxY] = [minMax[0], minMax[1], minMax[2], minMax[3]];
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;
    rects.push({
      page: pageNumber,
      color: fillColor,
      x0: round(minX),
      x1: round(maxX),
      y0: round(pageHeight - maxY),
      y1: round(pageHeight - minY),
    });
  }
  return rects;
}
