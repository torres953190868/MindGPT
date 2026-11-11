import type { RagSection } from "./types";

export const MAX_WORKSPACE_DOCUMENT_OUTLINE_CHARS = 2000;
export const MAX_WORKSPACE_DOCUMENT_OUTLINE_ITEMS = 80;

export type WorkspaceDocumentOutlineOptions = {
  maxChars?: number;
  maxItems?: number;
};

const TRUNCATION_SUFFIX = "\n...";
const STANDALONE_ELLIPSIS = "...";

export function buildWorkspaceDocumentOutline(
  sections: RagSection[],
  options?: WorkspaceDocumentOutlineOptions,
): string {
  const rawMaxChars = options?.maxChars ?? MAX_WORKSPACE_DOCUMENT_OUTLINE_CHARS;
  const rawMaxItems = options?.maxItems ?? MAX_WORKSPACE_DOCUMENT_OUTLINE_ITEMS;

  if (!sections || sections.length === 0 || !(rawMaxChars > 0) || !(rawMaxItems > 0)) {
    return "";
  }

  const maxChars = Number.isFinite(rawMaxChars) ? Math.floor(rawMaxChars) : rawMaxChars;
  const maxItems = Number.isFinite(rawMaxItems) ? Math.floor(rawMaxItems) : rawMaxItems;
  if (maxChars <= 0 || maxItems <= 0) {
    return "";
  }

  const sorted = [...sections].sort(
    (left, right) =>
      left.pageStart - right.pageStart ||
      left.level - right.level ||
      left.pageEnd - right.pageEnd ||
      left.title.localeCompare(right.title),
  );

  const validLines: string[] = [];
  for (const section of sorted) {
    const cleanTitle = section.title.replace(/\s+/g, " ").trim();
    if (!cleanTitle) continue;

    const depth = Math.max(0, section.level - 1);
    const indent = "  ".repeat(Math.min(depth, 5));
    const pageLabel =
      section.pageStart === section.pageEnd
        ? `p. ${section.pageStart}`
        : `pp. ${section.pageStart}-${section.pageEnd}`;
    validLines.push(`${indent}- ${cleanTitle} (${pageLabel})`);
  }

  if (validLines.length === 0) {
    return "";
  }

  const truncatedByItems = validLines.length > maxItems;
  const cappedLines = validLines.slice(0, maxItems);

  if (!truncatedByItems) {
    const full = cappedLines.join("\n");
    if (full.length <= maxChars) {
      return full;
    }
  }

  let outline = "";
  for (const line of cappedLines) {
    const candidate = outline ? `${outline}\n${line}` : line;
    if (candidate.length > maxChars - TRUNCATION_SUFFIX.length) {
      if (outline) {
        return `${outline}${TRUNCATION_SUFFIX}`;
      }
      return maxChars >= STANDALONE_ELLIPSIS.length ? STANDALONE_ELLIPSIS : "";
    }
    outline = candidate;
  }

  if (truncatedByItems && outline.length + TRUNCATION_SUFFIX.length <= maxChars) {
    return `${outline}${TRUNCATION_SUFFIX}`;
  }

  return outline;
}
