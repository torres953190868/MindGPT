import { createHash } from "node:crypto";
import { createId } from "@/lib/ids";
import { CHUNK_CONFIG, type ChunkConfig } from "./config";
import { estimateTokenCount } from "./text";
import type { RagChunk, RagDocument, RagPage, RagSection } from "./types";

type TextUnit = {
  text: string;
  pageNumber: number;
  tokenCount: number;
};

const SPLIT_SEPARATORS = [
  "\n\n",
  "\n",
  "。",
  "！",
  "？",
  "；",
  ".",
  "!",
  "?",
  ";",
  "，",
  ",",
  " ",
];

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function splitWithSeparator(text: string, separator: string) {
  if (!text.includes(separator)) return [text];
  const pieces = text.split(separator);
  return pieces
    .map((piece, index) =>
      index < pieces.length - 1 && separator.trim() ? `${piece}${separator}` : piece,
    )
    .map((piece) => piece.trim())
    .filter(Boolean);
}

function hardSplit(text: string, maxTokens: number) {
  const parts = text.match(/\S+\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    if (current && estimateTokenCount(current + part) > maxTokens) {
      chunks.push(current.trim());
      current = "";
    }

    if (estimateTokenCount(part) > maxTokens) {
      for (let index = 0; index < part.length; index += Math.max(80, maxTokens * 2)) {
        chunks.push(part.slice(index, index + Math.max(80, maxTokens * 2)).trim());
      }
    } else {
      current += part;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function mergePieces(pieces: string[], maxTokens: number) {
  const merged: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const next = current ? `${current}\n${piece}` : piece;
    if (current && estimateTokenCount(next) > maxTokens) {
      merged.push(current.trim());
      current = piece;
    } else {
      current = next;
    }
  }

  if (current.trim()) merged.push(current.trim());
  return merged;
}

export function splitTextRecursive(
  text: string,
  maxTokens = CHUNK_CONFIG.maxChunkTokens,
  separators = SPLIT_SEPARATORS,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (estimateTokenCount(clean) <= maxTokens) return [clean];

  const [separator, ...rest] = separators;
  if (!separator) return hardSplit(clean, maxTokens);

  const pieces = splitWithSeparator(clean, separator);
  if (pieces.length === 1) return splitTextRecursive(clean, maxTokens, rest);

  return mergePieces(pieces, maxTokens).flatMap((piece) =>
    estimateTokenCount(piece) > maxTokens
      ? splitTextRecursive(piece, maxTokens, rest)
      : [piece],
  );
}

function unitsForPages(pages: RagPage[], maxTokens: number): TextUnit[] {
  return pages.flatMap((page) =>
    splitTextRecursive(page.cleanText, maxTokens).map((text) => ({
      text,
      pageNumber: page.pageNumber,
      tokenCount: estimateTokenCount(text),
    })),
  );
}

function sectionPages(pages: RagPage[], section: RagSection) {
  return pages.filter(
    (page) =>
      page.pageNumber >= section.pageStart && page.pageNumber <= section.pageEnd,
  );
}

function tailOverlap(units: TextUnit[], overlapTokens: number) {
  const tail: TextUnit[] = [];
  let tokens = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (tail.length > 0 && tokens + unit.tokenCount > overlapTokens) break;
    tail.unshift(unit);
    tokens += unit.tokenCount;
  }

  return tail;
}

function buildUnitChunks(units: TextUnit[], config: ChunkConfig) {
  const chunks: TextUnit[][] = [];
  let current: TextUnit[] = [];
  let tokens = 0;

  for (const unit of units) {
    const wouldOverflow =
      current.length > 0 &&
      tokens + unit.tokenCount > config.childChunkSizeTokens &&
      tokens >= config.minChunkTokens;

    if (wouldOverflow) {
      chunks.push(current);
      current = tailOverlap(current, config.childOverlapTokens);
      tokens = current.reduce((sum, item) => sum + item.tokenCount, 0);
    }

    if (current.length > 0 && tokens + unit.tokenCount > config.maxChunkTokens) {
      current = [];
      tokens = 0;
    }

    current.push(unit);
    tokens += unit.tokenCount;
  }

  if (current.length > 0) chunks.push(current);
  return mergeTinyChunks(chunks, config);
}

function mergeTinyChunks(chunks: TextUnit[][], config: ChunkConfig) {
  const merged: TextUnit[][] = [];

  for (const chunk of chunks) {
    const tokenCount = chunk.reduce((sum, unit) => sum + unit.tokenCount, 0);
    const previous = merged.at(-1);
    const previousTokens =
      previous?.reduce((sum, unit) => sum + unit.tokenCount, 0) ?? 0;

    if (
      previous &&
      tokenCount < config.minChunkTokens &&
      previousTokens + tokenCount <= config.maxChunkTokens
    ) {
      previous.push(...chunk);
    } else {
      merged.push([...chunk]);
    }
  }

  if (merged.length > 1) {
    const last = merged.at(-1);
    const beforeLast = merged.at(-2);
    const lastTokens = last?.reduce((sum, unit) => sum + unit.tokenCount, 0) ?? 0;
    const beforeLastTokens =
      beforeLast?.reduce((sum, unit) => sum + unit.tokenCount, 0) ?? 0;

    if (
      last &&
      beforeLast &&
      lastTokens < config.minChunkTokens &&
      beforeLastTokens + lastTokens <= config.maxChunkTokens
    ) {
      beforeLast.push(...last);
      merged.pop();
    }
  }

  return merged;
}

function chunkContent(units: TextUnit[]) {
  return units
    .map((unit) => unit.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function pageStart(units: TextUnit[]) {
  return Math.min(...units.map((unit) => unit.pageNumber));
}

function pageEnd(units: TextUnit[]) {
  return Math.max(...units.map((unit) => unit.pageNumber));
}

function createChunk(
  document: RagDocument,
  section: RagSection,
  units: TextUnit[],
  chunkIndex: number,
  config: ChunkConfig,
): RagChunk {
  const content = chunkContent(units);
  const start = pageStart(units);
  const end = pageEnd(units);

  return {
    id: createId("chunk"),
    documentId: document.id,
    sectionId: section.id,
    parentChunkId: null,
    chunkIndex,
    content,
    contentHash: sha256(content),
    pageStart: start,
    pageEnd: end,
    headingPath: section.headingPath,
    tokenCount: estimateTokenCount(content),
    charStart: null,
    charEnd: null,
    embedding: null,
    embeddingModel: null,
    chunkVersion: config.strategy,
    metadata: {
      file_name: document.fileName,
      page_start: start,
      page_end: end,
      heading_path: section.headingPath,
      chunk_type: "child",
      parser_version: document.parserVersion,
      chunk_version: config.strategy,
    },
    createdAt: new Date().toISOString(),
  };
}

export function chunkDocument(
  document: RagDocument,
  pages: RagPage[],
  sections: RagSection[],
  config = CHUNK_CONFIG,
) {
  const chunks: RagChunk[] = [];
  const seenHashes = new Set<string>();

  for (const section of sections) {
    const pagesInSection = sectionPages(pages, section);
    const units = unitsForPages(pagesInSection, config.maxChunkTokens);
    if (units.length === 0) continue;

    const sectionTokenCount = units.reduce((sum, unit) => sum + unit.tokenCount, 0);
    const unitGroups =
      sectionTokenCount <= config.maxChunkTokens
        ? [units]
        : buildUnitChunks(units, config);

    for (const unitGroup of unitGroups) {
      const chunk = createChunk(document, section, unitGroup, chunks.length, config);
      if (!chunk.content || seenHashes.has(chunk.contentHash)) continue;
      seenHashes.add(chunk.contentHash);
      chunks.push(chunk);
    }
  }

  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}
