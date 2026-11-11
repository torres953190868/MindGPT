import { describe, expect, it } from "vitest";
import {
  buildWorkspaceDocumentOutline,
  MAX_WORKSPACE_DOCUMENT_OUTLINE_CHARS,
  MAX_WORKSPACE_DOCUMENT_OUTLINE_ITEMS,
} from "@/lib/server/rag/outline";
import type { RagSection } from "@/lib/server/rag/types";

function makeSection(
  overrides: Partial<RagSection> & Pick<RagSection, "title" | "pageStart" | "pageEnd">,
): RagSection {
  return {
    id: overrides.id ?? `sec_${Math.random().toString(36).slice(2, 8)}`,
    documentId: overrides.documentId ?? "doc_1",
    title: overrides.title,
    headingPath: overrides.headingPath ?? [overrides.title],
    level: overrides.level ?? 1,
    pageStart: overrides.pageStart,
    pageEnd: overrides.pageEnd,
    source: overrides.source ?? "pdf_outline",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("buildWorkspaceDocumentOutline", () => {
  it("exports expected default budget constants", () => {
    expect(MAX_WORKSPACE_DOCUMENT_OUTLINE_CHARS).toBe(2000);
    expect(MAX_WORKSPACE_DOCUMENT_OUTLINE_ITEMS).toBe(80);
  });

  it("returns empty string for empty sections, whitespace-only titles, or non-positive budgets", () => {
    const valid = [makeSection({ title: "Introduction", pageStart: 1, pageEnd: 2 })];

    expect(buildWorkspaceDocumentOutline([])).toBe("");
    expect(
      buildWorkspaceDocumentOutline([
        makeSection({ title: "   ", pageStart: 1, pageEnd: 1 }),
        makeSection({ title: "\n\t ", pageStart: 2, pageEnd: 2 }),
      ]),
    ).toBe("");
    expect(buildWorkspaceDocumentOutline(valid, { maxChars: 0 })).toBe("");
    expect(buildWorkspaceDocumentOutline(valid, { maxChars: -10 })).toBe("");
    expect(buildWorkspaceDocumentOutline(valid, { maxItems: 0 })).toBe("");
    expect(buildWorkspaceDocumentOutline(valid, { maxItems: -1 })).toBe("");
  });

  it("sorts deterministically, indents levels 1..6+ (capped at depth 5), formats page labels, and normalizes titles", () => {
    const sections: RagSection[] = [
      makeSection({ title: "Deep Level 8", level: 8, pageStart: 10, pageEnd: 12 }),
      makeSection({ title: "Deep Level 6", level: 6, pageStart: 8, pageEnd: 8 }),
      makeSection({ title: "   ", level: 1, pageStart: 1, pageEnd: 1 }),
      makeSection({ title: "Zeta", level: 2, pageStart: 3, pageEnd: 5 }),
      makeSection({ title: "Alpha", level: 2, pageStart: 3, pageEnd: 5 }),
      makeSection({ title: "Short Span", level: 2, pageStart: 3, pageEnd: 4 }),
      makeSection({
        title: "Chapter 1:\n  Foundations\t of   RAG",
        level: 1,
        pageStart: 3,
        pageEnd: 7,
      }),
      makeSection({ title: "Preface", level: 0, pageStart: 1, pageEnd: 1 }),
    ];
    const snapshot = sections.map((section) => section.title);

    const outline = buildWorkspaceDocumentOutline(sections);

    expect(sections.map((section) => section.title)).toEqual(snapshot);
    expect(outline).toBe(
      [
        "- Preface (p. 1)",
        "- Chapter 1: Foundations of RAG (pp. 3-7)",
        "  - Short Span (pp. 3-4)",
        "  - Alpha (pp. 3-5)",
        "  - Zeta (pp. 3-5)",
        "          - Deep Level 6 (p. 8)",
        "          - Deep Level 8 (pp. 10-12)",
      ].join("\n"),
    );
  });

  it("enforces maxChars line-by-line with trailing \\n... and never exceeds maxChars", () => {
    const sections = Array.from({ length: 12 }, (_, index) =>
      makeSection({
        title: `Section ${index + 1}: Architectural Overview`,
        level: (index % 3) + 1,
        pageStart: index * 3 + 1,
        pageEnd: index * 3 + 3,
      }),
    );

    for (const maxChars of [1, 2, 3, 4, 15, 45, 90, 140, 220]) {
      const outline = buildWorkspaceDocumentOutline(sections, { maxChars });
      expect(outline.length).toBeLessThanOrEqual(maxChars);
      if (maxChars >= 60) {
        expect(outline.endsWith("\n...")).toBe(true);
      }
    }

    const single = [makeSection({ title: "Intro", level: 1, pageStart: 1, pageEnd: 1 })];
    const exactLine = "- Intro (p. 1)";
    expect(
      buildWorkspaceDocumentOutline(single, { maxChars: exactLine.length }),
    ).toBe(exactLine);
  });

  it("caps output at maxItems and appends \\n... when sections exceed maxItems", () => {
    const sections = Array.from({ length: 5 }, (_, index) =>
      makeSection({
        title: `Chapter ${index + 1}`,
        level: 1,
        pageStart: index + 1,
        pageEnd: index + 1,
      }),
    );

    const outline = buildWorkspaceDocumentOutline(sections, { maxItems: 3 });

    expect(outline).toBe(
      [
        "- Chapter 1 (p. 1)",
        "- Chapter 2 (p. 2)",
        "- Chapter 3 (p. 3)",
        "...",
      ].join("\n"),
    );
  });
});
