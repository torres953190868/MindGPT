import path from "node:path";
import { pathToFileURL } from "node:url";
import { cleanPageText, removeRepeatedHeadersAndFooters } from "./cleaner";
import { PDF_PARSER_VERSION } from "./config";
import { RagError } from "./errors";
import { detectSectionsFromPages, normalizeSectionRanges } from "./headings";
import type {
  ParsedDocument,
  ParsedPage,
  ParsedSection,
  ParsedTextBlock,
} from "./types";

type PdfTextItem = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  fontName?: unknown;
};

type PdfTextContent = {
  items?: unknown[];
};

type PdfPageLike = {
  getTextContent: () => Promise<PdfTextContent>;
};

type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  getMetadata?: () => Promise<{ info?: unknown }>;
  getOutline?: () => Promise<unknown[] | null>;
  getDestination?: (destination: string) => Promise<unknown[] | null>;
  getPageIndex?: (ref: unknown) => Promise<number>;
  destroy?: () => Promise<void> | void;
};

type PdfModule = {
  getDocument: (options: {
    data: Uint8Array;
    cMapPacked?: boolean;
    cMapUrl?: string;
    standardFontDataUrl?: string;
  }) => { promise: Promise<PdfDocumentLike> };
};

type OutlineNode = {
  title?: unknown;
  dest?: unknown;
  items?: unknown;
};

type LineBucket = {
  y: number;
  items: Array<{ x: number; text: string; width: number }>;
};

export { PDF_PARSER_VERSION };

let pdfjsModulePromise: Promise<PdfModule> | null = null;

function pdfAssetUrl(...segments: string[]) {
  const resolvedPath = path.resolve(process.cwd(), "node_modules", "pdfjs-dist", ...segments);
  return pathToFileURL(`${resolvedPath}${path.sep}`).toString();
}

async function loadPdfJs() {
  pdfjsModulePromise ??= (async () => {
    const [pdfjs] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ]);
    return pdfjs as PdfModule;
  })();
  return pdfjsModulePromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function textItem(value: unknown): PdfTextItem | null {
  if (!isRecord(value) || typeof value.str !== "string") return null;
  return value as PdfTextItem;
}

function numberAt(values: unknown[], index: number, fallback = 0) {
  const value = values[index];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getTransform(item: PdfTextItem) {
  return Array.isArray(item.transform) ? item.transform : [];
}

function getFontSize(transform: unknown[]) {
  const a = numberAt(transform, 0, 0);
  const b = numberAt(transform, 1, 0);
  const size = Math.hypot(a, b);
  return size > 0 ? size : undefined;
}

function blockFromItem(item: PdfTextItem): ParsedTextBlock | null {
  if (typeof item.str !== "string" || !item.str.trim()) return null;
  const transform = getTransform(item);
  const x = numberAt(transform, 4, 0);
  const y = numberAt(transform, 5, 0);
  const width = typeof item.width === "number" ? item.width : 0;
  const height = typeof item.height === "number" ? item.height : 0;
  const fontName = typeof item.fontName === "string" ? item.fontName : undefined;

  return {
    text: item.str,
    bbox: [x, y, x + width, y + height],
    fontSize: getFontSize(transform),
    fontName,
    isBold: fontName ? /bold|black|heavy/i.test(fontName) : undefined,
  };
}

function addLineItem(lines: LineBucket[], item: PdfTextItem) {
  if (typeof item.str !== "string" || !item.str.trim()) return;

  const transform = getTransform(item);
  const x = numberAt(transform, 4, 0);
  const y = numberAt(transform, 5, 0);
  const width = typeof item.width === "number" ? item.width : 0;
  const line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);

  if (line) {
    line.items.push({ x, text: item.str, width });
    line.y = (line.y + y) / 2;
    return;
  }

  lines.push({ y, items: [{ x, text: item.str, width }] });
}

function lineText(line: LineBucket) {
  const items = [...line.items].sort((left, right) => left.x - right.x);
  const parts: string[] = [];
  let previousEnd: number | null = null;

  for (const item of items) {
    const needsSpace =
      previousEnd !== null &&
      item.x - previousEnd > 3 &&
      !/^\s/.test(item.text) &&
      !/\s$/.test(parts.at(-1) ?? "");
    if (needsSpace) parts.push(" ");
    parts.push(item.text);
    previousEnd = item.x + item.width;
  }

  return parts.join("").trim();
}

function textFromItems(items: PdfTextItem[]) {
  const lines: LineBucket[] = [];
  for (const item of items) addLineItem(lines, item);

  return lines
    .sort((left, right) => right.y - left.y)
    .map(lineText)
    .filter(Boolean)
    .join("\n");
}

async function extractPage(page: PdfPageLike, pageNumber: number): Promise<ParsedPage> {
  const content = await page.getTextContent();
  const items = (content.items ?? [])
    .map(textItem)
    .filter((item): item is PdfTextItem => Boolean(item));
  const blocks = items
    .map((item) => blockFromItem(item))
    .filter((block): block is ParsedTextBlock => Boolean(block));
  const rawText = textFromItems(items);

  return {
    pageNumber,
    rawText,
    cleanText: cleanPageText(rawText),
    blocks,
  };
}

function metadataTitle(info: unknown) {
  if (!isRecord(info) || typeof info.Title !== "string") return null;
  const title = info.Title.trim();
  return title ? title : null;
}

async function outlinePageNumber(pdf: PdfDocumentLike, dest: unknown) {
  if (!pdf.getPageIndex) return null;

  let explicitDest: unknown[] | null = Array.isArray(dest) ? dest : null;
  if (!explicitDest && typeof dest === "string" && pdf.getDestination) {
    explicitDest = await pdf.getDestination(dest);
  }

  if (!explicitDest?.length) return null;

  try {
    const pageIndex = await pdf.getPageIndex(explicitDest[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

async function flattenOutline(
  pdf: PdfDocumentLike,
  nodes: unknown[] | null | undefined,
  level = 1,
  path: string[] = [],
) {
  const sections: ParsedSection[] = [];
  if (!Array.isArray(nodes)) return sections;

  for (const rawNode of nodes) {
    if (!isRecord(rawNode)) continue;
    const node = rawNode as OutlineNode;
    const title = typeof node.title === "string" ? node.title.trim() : "";
    const pageNumber = await outlinePageNumber(pdf, node.dest);
    const headingPath = title ? [...path, title] : path;

    if (title && pageNumber) {
      sections.push({
        title,
        level,
        headingPath,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        source: "pdf_outline",
      });
    }

    sections.push(
      ...(await flattenOutline(
        pdf,
        Array.isArray(node.items) ? node.items : [],
        level + 1,
        headingPath,
      )),
    );
  }

  return sections;
}

function assertTextBasedPdf(pages: ParsedPage[]) {
  const totalChars = pages.reduce((sum, page) => sum + page.cleanText.length, 0);
  const averageChars = pages.length ? totalChars / pages.length : 0;
  const nonEmptyPages = pages.filter((page) => page.cleanText.length >= 20).length;

  if (totalChars < 80 || averageChars < 25 || nonEmptyPages === 0) {
    throw new RagError(
      "This MVP only supports text-based PDFs. OCR is not implemented yet.",
      { code: "PDF_TEXT_EMPTY", status: 422 },
    );
  }
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    cMapPacked: true,
    cMapUrl: pdfAssetUrl("cmaps"),
    standardFontDataUrl: pdfAssetUrl("standard_fonts"),
  });
  const pdf = await loadingTask.promise;

  try {
    const pages: ParsedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      pages.push(await extractPage(await pdf.getPage(pageNumber), pageNumber));
    }

    const cleanedPages = removeRepeatedHeadersAndFooters(pages);
    assertTextBasedPdf(cleanedPages);

    const metadata = pdf.getMetadata ? await pdf.getMetadata().catch(() => null) : null;
    const outline = pdf.getOutline ? await pdf.getOutline().catch(() => null) : null;
    const outlineSections = normalizeSectionRanges(
      await flattenOutline(pdf, outline),
      pdf.numPages,
    );
    const sections = outlineSections.length
      ? outlineSections
      : detectSectionsFromPages(cleanedPages, pdf.numPages);

    return {
      pageCount: pdf.numPages,
      title: metadataTitle(metadata?.info),
      pages: cleanedPages,
      sections,
    };
  } finally {
    await pdf.destroy?.();
  }
}
