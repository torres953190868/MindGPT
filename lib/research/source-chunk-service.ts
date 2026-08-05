// SourceContentService (spec §9.8): persists cleaned source excerpts into
// curriculum_source_chunks (§7.15) and gives the tutor's searchCourseSources
// one entry point over those chunks plus the project PDF RAG.
//
// Excerpt policy (§7.15): only short cleaned excerpts are stored (<= 1800
// chars here; the DB check allows 2000), never full page bodies. Each excerpt
// carries a sha256 content_hash and an approximate token_count estimated with
// the same tokenizer as the RAG chunker (lib/server/rag/text.ts).
//
// Retrieval MVP: in-process keyword scoring only (term coverage + a small
// frequency tiebreak), using the RAG retriever's keyword utilities — CJK text
// is tokenized per Han character, exactly like the project RAG. The embedding
// column stays null.
// TODO(phase 6): add vector recall through the embedding provider and merge
// it with the keyword score like lib/server/rag/retriever.ts does.

import { createHash } from "node:crypto";
import {
  getCurriculumRepository,
  type CurriculumRepository,
  type CurriculumSourceChunkDto,
} from "@/lib/curriculum/curriculum-repository";
import {
  getWorkspaceDocumentContextsForOwner,
  listDocumentsForOwner,
} from "@/lib/server/rag/service";
import { estimateTokenCount, getKeywordTerms } from "@/lib/server/rag/text";
import type { ChatAttachment } from "@/lib/types";

export const SOURCE_CHUNK_LIMITS = {
  // Hard per-excerpt cap; keeps a safety margin under the 2000-char DB check.
  maxExcerptChars: 1800,
  defaultTopK: 8,
  maxTopK: 20,
  maxProjectDocuments: 3,
} as const;

export class SourceContentError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SourceContentError";
    this.code = code;
  }
}

export type SourceChunkMatch = {
  chunkId: string;
  sourceId: string;
  excerpt: string;
  score: number;
};

export type CourseSourceMatch =
  | (SourceChunkMatch & { kind: "curriculum_source" })
  | {
      kind: "project_document";
      chunkId: string;
      documentId: string;
      fileName: string;
      pageStart: number;
      pageEnd: number;
      excerpt: string;
      score: number;
    };

// Splits cleaned page text into excerpts of at most maxChars, preferring
// paragraph (blank-line) boundaries; an oversized single paragraph is
// hard-sliced at maxChars. Empty input yields no excerpts.
export function splitSourceExcerpts(content: string, maxChars: number): string[] {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (!normalized || maxChars < 1) return [];

  const excerpts: string[] = [];
  let current = "";

  for (const paragraph of normalized.split(/\n{2,}/)) {
    const piece = paragraph.trim();
    if (!piece) continue;

    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      excerpts.push(current);
      current = "";
    }
    if (piece.length <= maxChars) {
      current = piece;
      continue;
    }
    for (let start = 0; start < piece.length; start += maxChars) {
      excerpts.push(piece.slice(start, start + maxChars));
    }
  }

  if (current) excerpts.push(current);
  return excerpts;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function clampTopK(topK: number | undefined): number {
  const value = topK ?? SOURCE_CHUNK_LIMITS.defaultTopK;
  if (!Number.isFinite(value)) return SOURCE_CHUNK_LIMITS.defaultTopK;
  return Math.min(SOURCE_CHUNK_LIMITS.maxTopK, Math.max(1, Math.floor(value)));
}

// Keyword score mirroring the RAG retriever's keyword path: query-term
// coverage is primary (getKeywordTerms lowercases and treats each Han
// character as a term), with a small per-term frequency tiebreak.
function scoreExcerpt(query: string, excerpt: string): number {
  const queryTerms = getKeywordTerms(query);
  if (queryTerms.length === 0) return 0;

  const haystack = excerpt.toLowerCase();
  let covered = 0;
  let frequencyScore = 0;
  for (const term of queryTerms) {
    const occurrences = haystack.split(term).length - 1;
    if (occurrences > 0) {
      covered += 1;
      frequencyScore += Math.min(occurrences, 3) / 3;
    }
  }

  const coverage = covered / queryTerms.length;
  const frequency = frequencyScore / queryTerms.length;
  return coverage + frequency * 0.15;
}

function toMatch(chunk: CurriculumSourceChunkDto, query: string): SourceChunkMatch {
  return {
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    excerpt: chunk.excerpt,
    score: scoreExcerpt(query, chunk.excerpt),
  };
}

function compareMatches(
  left: { score: number; chunkId: string },
  right: { score: number; chunkId: string },
): number {
  return right.score - left.score || left.chunkId.localeCompare(right.chunkId);
}

// Saves the cleaned content of one source as excerpt chunks. Idempotent:
// when the stored chunk sequence already matches the desired content hashes,
// the existing rows are returned untouched (same ids, same createdAt).
// fetchedAt pins the rows' created_at (defaults to now) so generation runs
// can record the actual retrieval time.
export async function saveSourceChunks(
  input: { sourceId: string; content: string; fetchedAt?: string },
  options: { repository?: CurriculumRepository } = {},
): Promise<CurriculumSourceChunkDto[]> {
  const repository = options.repository ?? getCurriculumRepository();
  const excerpts = splitSourceExcerpts(input.content, SOURCE_CHUNK_LIMITS.maxExcerptChars);
  const desired = excerpts.map((excerpt, chunkIndex) => ({
    chunkIndex,
    excerpt,
    tokenCount: estimateTokenCount(excerpt),
    contentHash: sha256Hex(excerpt),
  }));

  const existing = await repository.listSourceChunks([input.sourceId]);
  const unchanged =
    existing.length === desired.length &&
    desired.every(
      (chunk, index) =>
        existing[index]?.chunkIndex === chunk.chunkIndex &&
        existing[index]?.contentHash === chunk.contentHash,
    );
  if (unchanged) return existing;

  const saved = await repository.saveSourceChunks(input.sourceId, desired, {
    createdAt: input.fetchedAt,
  });
  if (!saved) {
    throw new SourceContentError(
      `Curriculum source "${input.sourceId}" does not exist.`,
      "SOURCE_NOT_FOUND",
    );
  }
  return saved;
}

// Keyword search over the chunks of the given sources. The caller is
// responsible for resolving which sourceIds are in scope (see
// searchCourseSources for the owner-checked path).
export async function searchSourceChunks(
  input: { sourceIds: string[]; query: string; topK?: number },
  options: { repository?: CurriculumRepository } = {},
): Promise<SourceChunkMatch[]> {
  const repository = options.repository ?? getCurriculumRepository();
  if (input.sourceIds.length === 0) return [];

  const chunks = await repository.listSourceChunks(input.sourceIds);
  return chunks
    .map((chunk) => toMatch(chunk, input.query))
    .filter((match) => match.score > 0)
    .sort(compareMatches)
    .slice(0, clampTopK(input.topK));
}

// Unified tutor retrieval entry (spec §9.8): keyword search over the
// curriculum version's source chunks, merged with snippets from the owner's
// indexed project PDFs via the existing owner-scoped RAG workspace query.
//
// Note: RAG documents are owner-scoped (the store has no project linkage
// yet), so when projectId is present the owner's indexed PDFs stand in for
// the project's documents; owner scoping is the permission boundary either
// way. TODO(phase 6): filter to project-linked documents once the store
// records that relation.
export async function searchCourseSources(
  input: {
    ownerId: string;
    curriculumVersionId?: string;
    projectId?: string;
    query: string;
    topK?: number;
  },
  options: { repository?: CurriculumRepository } = {},
): Promise<CourseSourceMatch[]> {
  const matches: CourseSourceMatch[] = [];

  if (input.curriculumVersionId) {
    const repository = options.repository ?? getCurriculumRepository();
    const chunks = await repository.listChunksForVersion(
      input.ownerId,
      input.curriculumVersionId,
    );
    for (const chunk of chunks ?? []) {
      const match = toMatch(chunk, input.query);
      if (match.score > 0) matches.push({ kind: "curriculum_source", ...match });
    }
  }

  if (input.projectId) {
    const documents = (await listDocumentsForOwner(input.ownerId))
      .filter((document) => document.status === "indexed")
      .slice(0, SOURCE_CHUNK_LIMITS.maxProjectDocuments);

    if (documents.length > 0) {
      const attachments: ChatAttachment[] = documents.map((document) => ({
        id: `course-source-${document.id}`,
        name: document.fileName,
        mimeType: "application/pdf",
        size: 0,
        createdAt: document.createdAt,
        documentId: document.id,
      }));
      const contexts = await getWorkspaceDocumentContextsForOwner(
        input.ownerId,
        attachments,
        input.query,
      );
      for (const context of contexts) {
        for (const snippet of context.snippets) {
          matches.push({
            kind: "project_document",
            chunkId: snippet.chunkId,
            documentId: context.documentId,
            fileName: context.fileName,
            pageStart: snippet.pageStart,
            pageEnd: snippet.pageEnd,
            excerpt: snippet.content,
            score: snippet.score ?? 0,
          });
        }
      }
    }
  }

  return matches.sort(compareMatches).slice(0, clampTopK(input.topK));
}

// Learning retrieval boundary: the caller must have an enrollment for this
// exact version before invoking this function. It intentionally has no
// project/document fallback and never performs web search; all returned
// chunks belong to the enrolled curriculum version.
export async function searchEnrolledCourseSources(
  input: { curriculumVersionId: string; query: string; topK?: number },
  options: { repository?: CurriculumRepository } = {},
): Promise<SourceChunkMatch[]> {
  const repository = options.repository ?? getCurriculumRepository();
  const chunks = await repository.listChunksForVersionById(input.curriculumVersionId);
  if (!chunks) return [];
  return chunks
    .map((chunk) => toMatch(chunk, input.query))
    .filter((match) => match.score > 0)
    .sort(compareMatches)
    .slice(0, clampTopK(input.topK));
}
