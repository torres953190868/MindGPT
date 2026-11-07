import {
  type DocumentDetails,
  type DocumentStatus,
  MAX_SCALE,
  MIN_SCALE,
  PDF_RESIZE_HANDLE_WIDTH,
  PDF_SIDEBAR_MIN_WIDTH,
  PDF_VIEWER_MIN_WIDTH,
  type PdfJsModule,
  type PdfSidebarResizeBoundsOptions,
  type RagSection,
  type TocNode,
} from "./types";

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

export function statusLabel(
  status: DocumentStatus,
  language: "zh" | "en",
): string {
  const labels: Record<"zh" | "en", Record<DocumentStatus, string>> = {
    zh: {
      queued: "等待处理",
      uploaded: "已上传",
      parsing: "解析中",
      parsed: "已解析",
      indexing: "索引中",
      indexed: "已完成",
      failed: "处理失败",
    },
    en: {
      queued: "Queued",
      uploaded: "Uploaded",
      parsing: "Parsing",
      parsed: "Parsed",
      indexing: "Indexing",
      indexed: "Ready",
      failed: "Failed",
    },
  };
  return labels[language][status];
}

export function documentStatusDotClass(status: DocumentStatus): string {
  if (status === "failed") return "bg-danger-500";
  if (status === "indexed") return "bg-success-500";
  return "bg-brand-400";
}

export function pagesLabel(start: number, end: number): string {
  return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
}

export function parsePageNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function clampPageNumber(pageNumber: number, pageCount: number): number {
  if (pageCount <= 0) return pageNumber;
  return Math.min(Math.max(pageNumber, 1), pageCount);
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getPdfSidebarResizeBounds({
  side,
  gridWidth,
  documentsSidebarWidth,
  toolsSidebarWidth,
}: PdfSidebarResizeBoundsOptions): { minWidth: number; maxWidth: number } {
  const otherSidebarWidth =
    side === "documents" ? toolsSidebarWidth : documentsSidebarWidth;
  const maxWidthForViewport =
    gridWidth -
    otherSidebarWidth -
    PDF_RESIZE_HANDLE_WIDTH * 2 -
    PDF_VIEWER_MIN_WIDTH;

  return {
    minWidth: PDF_SIDEBAR_MIN_WIDTH,
    maxWidth: Math.max(PDF_SIDEBAR_MIN_WIDTH, Math.floor(maxWidthForViewport)),
  };
}

export function isRenderCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      /cancelled|canceled/i.test(error.message))
  );
}

export function getPdfViewerContentWidth(viewer: HTMLElement): number {
  const style = window.getComputedStyle(viewer);
  const paddingX =
    Number.parseFloat(style.paddingLeft || "0") +
    Number.parseFloat(style.paddingRight || "0");
  return Math.max(0, Math.floor(viewer.clientWidth - paddingX));
}

export function getMobileFitWidthScale(
  pageWidth: number,
  viewerWidth: number,
): number | null {
  if (pageWidth <= 0 || viewerWidth <= 0) return null;
  const fitScale = Math.max(viewerWidth - 2, 0) / pageWidth;
  const autoFitMinScale = Math.min(MIN_SCALE, fitScale);
  const clampedScale = clampNumber(fitScale, autoFitMinScale, MAX_SCALE);
  return Math.floor(clampedScale * 100) / 100;
}

export function hasExtractedPages(details: DocumentDetails | null): boolean {
  return Boolean(
    details &&
      details.document.pageCount > 0 &&
      (details.document.status === "parsed" ||
        details.document.status === "indexing" ||
        details.document.status === "indexed"),
  );
}

export function isDocumentProcessing(
  status: DocumentStatus | undefined,
): boolean {
  return status === "queued" || status === "parsing" || status === "indexing";
}

export function sortSectionsForToc(sections: RagSection[]): RagSection[] {
  return sections
    .map((section, index) => ({ index, section }))
    .sort(
      (left, right) =>
        left.section.pageStart - right.section.pageStart ||
        left.section.level - right.section.level ||
        left.index - right.index,
    )
    .map(({ section }) => section);
}

export function buildTocTree(sections: RagSection[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const section of sections) {
    const node: TocNode = { section, children: [] };

    while (
      stack.length > 0 &&
      stack[stack.length - 1].section.level >= section.level
    ) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push(node);
  }

  return roots;
}

export function tocNodeContainsSection(
  node: TocNode,
  sectionId: string,
): boolean {
  return (
    node.section.id === sectionId ||
    node.children.some((child) => tocNodeContainsSection(child, sectionId))
  );
}

export function findTocRootId(
  tocTree: TocNode[],
  sectionId: string | null,
): string | null {
  if (!sectionId) return null;
  return (
    tocTree.find((node) => tocNodeContainsSection(node, sectionId))?.section
      .id ?? null
  );
}

export function findActiveSectionId(
  sortedSections: RagSection[],
  pageNumber: number | null,
): string | null {
  if (!pageNumber) return null;
  const activeSections = sortedSections.filter(
    (section) =>
      pageNumber >= section.pageStart && pageNumber <= section.pageEnd,
  );
  return (
    activeSections.sort((left, right) => right.level - left.level)[0]?.id ??
    null
  );
}

export async function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= (async () => {
    const pdfjs = (await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )) as unknown as PdfJsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  })();

  return pdfJsModulePromise;
}
