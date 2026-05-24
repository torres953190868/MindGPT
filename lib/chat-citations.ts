import type { ChatCitation } from "@/lib/types";

export const MAX_CHAT_CITATIONS = 30;

const CHAT_CITATION_MARKER_PATTERN =
  /\[\[\s*cite\s*:\s*(\d+)\s*\]\]|\[\s*cite\s*:\s*(\d+)\s*\]/gi;
const MAX_CITATION_ID_LENGTH = 160;
const MAX_CITATION_NAME_LENGTH = 260;
const MAX_CITATION_QUOTE_LENGTH = 700;
const MAX_HEADING_SEGMENTS = 8;
const MAX_HEADING_SEGMENT_LENGTH = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cleanRequiredString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanPositiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function cleanHeadingPath(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item) => {
      const segment = cleanRequiredString(item, MAX_HEADING_SEGMENT_LENGTH);
      return segment ? [segment] : [];
    })
    .slice(0, MAX_HEADING_SEGMENTS);
}

export function normalizeChatCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_CHAT_CITATIONS).flatMap((citation) => {
    if (!isRecord(citation)) return [];

    const index = cleanPositiveInteger(citation.index);
    const documentId = cleanRequiredString(
      citation.documentId,
      MAX_CITATION_ID_LENGTH,
    );
    const documentName = cleanRequiredString(
      citation.documentName,
      MAX_CITATION_NAME_LENGTH,
    );
    const chunkId = cleanRequiredString(citation.chunkId, MAX_CITATION_ID_LENGTH);
    const pageStart = cleanPositiveInteger(citation.pageStart);
    const pageEnd = cleanPositiveInteger(citation.pageEnd);
    const quote = cleanRequiredString(citation.quote, MAX_CITATION_QUOTE_LENGTH);

    if (
      !index ||
      !documentId ||
      !documentName ||
      !chunkId ||
      !pageStart ||
      !pageEnd ||
      !quote
    ) {
      return [];
    }

    return {
      index,
      documentId,
      documentName,
      chunkId,
      pageStart: Math.min(pageStart, pageEnd),
      pageEnd: Math.max(pageStart, pageEnd),
      headingPath: cleanHeadingPath(citation.headingPath),
      quote,
    };
  });
}

export function replaceChatCitationMarkers(
  content: string,
  replace: (index: number, marker: string) => string,
) {
  return content.replace(
    CHAT_CITATION_MARKER_PATTERN,
    (
      marker,
      doubleBracketIndex: string | undefined,
      singleBracketIndex: string | undefined,
    ) => {
      const index = Number(doubleBracketIndex ?? singleBracketIndex);
      return Number.isInteger(index) ? replace(index, marker) : marker;
    },
  );
}

export function getChatCitationMarkerIndexes(content: string) {
  const indexes = new Set<number>();

  replaceChatCitationMarkers(content, (index, marker) => {
    indexes.add(index);
    return marker;
  });

  return indexes;
}
