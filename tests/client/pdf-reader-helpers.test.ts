import { describe, expect, it } from "vitest";
import {
  buildTocTree,
  clampNumber,
  clampPageNumber,
  documentStatusDotClass,
  findActiveSectionId,
  findTocRootId,
  getMobileFitWidthScale,
  getPdfSidebarResizeBounds,
  hasExtractedPages,
  isDocumentProcessing,
  isRenderCancellation,
  pagesLabel,
  parsePageNumber,
  sortSectionsForToc,
  statusLabel,
  tocNodeContainsSection,
} from "@/components/rag/pdf-reader/helpers";
import type { DocumentDetails, RagSection } from "@/components/rag/pdf-reader/types";

describe("pdf-reader helpers", () => {
  it("formats status labels and dot classes across languages and states", () => {
    expect(statusLabel("indexed", "en")).toBe("Ready");
    expect(statusLabel("indexed", "zh")).toBe("已完成");
    expect(statusLabel("failed", "en")).toBe("Failed");
    expect(statusLabel("parsing", "zh")).toBe("解析中");

    expect(documentStatusDotClass("failed")).toBe("bg-danger-500");
    expect(documentStatusDotClass("indexed")).toBe("bg-success-500");
    expect(documentStatusDotClass("parsing")).toBe("bg-brand-400");
  });

  it("formats page labels and parses/clamps page numbers", () => {
    expect(pagesLabel(3, 3)).toBe("p. 3");
    expect(pagesLabel(3, 7)).toBe("pp. 3-7");

    expect(parsePageNumber("5")).toBe(5);
    expect(parsePageNumber("0")).toBeNull();
    expect(parsePageNumber("-2")).toBeNull();
    expect(parsePageNumber("2.5")).toBeNull();
    expect(parsePageNumber(null)).toBeNull();

    expect(clampPageNumber(0, 10)).toBe(1);
    expect(clampPageNumber(15, 10)).toBe(10);
    expect(clampPageNumber(4, 10)).toBe(4);
    expect(clampPageNumber(4, 0)).toBe(4);

    expect(clampNumber(5, 1, 10)).toBe(5);
    expect(clampNumber(-1, 1, 10)).toBe(1);
    expect(clampNumber(12, 1, 10)).toBe(10);
  });

  it("computes sidebar resize bounds and mobile fit-width scale", () => {
    const bounds = getPdfSidebarResizeBounds({
      side: "documents",
      gridWidth: 1200,
      documentsSidebarWidth: 280,
      toolsSidebarWidth: 260,
    });
    expect(bounds.minWidth).toBe(210);
    expect(bounds.maxWidth).toBe(1200 - 260 - 16 - 360);

    expect(getMobileFitWidthScale(0, 400)).toBeNull();
    expect(getMobileFitWidthScale(600, 0)).toBeNull();
    expect(getMobileFitWidthScale(600, 362)).toBe(0.6);
  });

  it("detects render cancellation, processing states, and extracted pages", () => {
    const cancelledByName = new Error("Stopped");
    cancelledByName.name = "RenderingCancelledException";
    expect(isRenderCancellation(cancelledByName)).toBe(true);
    expect(isRenderCancellation(new Error("Render canceled by user"))).toBe(true);
    expect(isRenderCancellation(new Error("Corrupt stream"))).toBe(false);

    expect(isDocumentProcessing("queued")).toBe(true);
    expect(isDocumentProcessing("parsing")).toBe(true);
    expect(isDocumentProcessing("indexing")).toBe(true);
    expect(isDocumentProcessing("indexed")).toBe(false);
    expect(isDocumentProcessing(undefined)).toBe(false);

    const baseDetails: DocumentDetails = {
      document: {
        id: "doc-1",
        fileName: "sample.pdf",
        pageCount: 5,
        title: "Sample",
        status: "indexed",
        errorMessage: null,
        errorCode: null,
        errorStage: null,
        errorRequestId: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      sections: [],
      chunkCount: 10,
    };
    expect(hasExtractedPages(baseDetails)).toBe(true);
    expect(
      hasExtractedPages({
        ...baseDetails,
        document: { ...baseDetails.document, status: "uploaded" },
      }),
    ).toBe(false);
    expect(hasExtractedPages(null)).toBe(false);
  });

  it("sorts sections, builds TOC hierarchy, and resolves active section and chapter", () => {
    const sections: RagSection[] = [
      {
        id: "sec-1-1",
        title: "1.1 Overview",
        headingPath: ["1 Intro", "1.1 Overview"],
        level: 2,
        pageStart: 1,
        pageEnd: 2,
        source: "outline",
      },
      {
        id: "sec-1",
        title: "1 Intro",
        headingPath: ["1 Intro"],
        level: 1,
        pageStart: 1,
        pageEnd: 4,
        source: "outline",
      },
      {
        id: "sec-2",
        title: "2 Methods",
        headingPath: ["2 Methods"],
        level: 1,
        pageStart: 5,
        pageEnd: 8,
        source: "outline",
      },
    ];

    const sorted = sortSectionsForToc(sections);
    expect(sorted.map((s) => s.id)).toEqual(["sec-1", "sec-1-1", "sec-2"]);

    const tree = buildTocTree(sorted);
    expect(tree).toHaveLength(2);
    expect(tree[0].section.id).toBe("sec-1");
    expect(tree[0].children.map((c) => c.section.id)).toEqual(["sec-1-1"]);
    expect(tocNodeContainsSection(tree[0], "sec-1-1")).toBe(true);
    expect(tocNodeContainsSection(tree[1], "sec-1-1")).toBe(false);

    const activeOnPage2 = findActiveSectionId(sorted, 2);
    expect(activeOnPage2).toBe("sec-1-1");
    expect(findTocRootId(tree, activeOnPage2)).toBe("sec-1");

    const activeOnPage6 = findActiveSectionId(sorted, 6);
    expect(activeOnPage6).toBe("sec-2");
    expect(findTocRootId(tree, activeOnPage6)).toBe("sec-2");
  });
});
