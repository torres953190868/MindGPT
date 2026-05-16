import type { Json } from "@/lib/supabase/database.types";

export type DocumentStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "indexing"
  | "indexed"
  | "failed";

export type RagErrorStage = "parsing" | "chunking" | "embedding" | "persisting";

export type SectionSource =
  | "pdf_outline"
  | "font_heuristic"
  | "regex"
  | "fallback";

export type ParsedTextBlock = {
  text: string;
  bbox?: [number, number, number, number];
  fontSize?: number;
  fontName?: string;
  isBold?: boolean;
};

export type ParsedPage = {
  pageNumber: number;
  rawText: string;
  cleanText: string;
  blocks?: ParsedTextBlock[];
};

export type ParsedSection = {
  title: string;
  level: number;
  headingPath: string[];
  pageStart: number;
  pageEnd: number;
  source: SectionSource;
};

export type ParsedDocument = {
  pageCount: number;
  title: string | null;
  pages: ParsedPage[];
  sections: ParsedSection[];
};

export type RagDocument = {
  id: string;
  userId: string | null;
  fileName: string;
  fileUrl: string | null;
  storagePath: string | null;
  mimeType: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  parserVersion: string;
  chunkVersion: string;
  errorMessage: string | null;
  errorCode: string | null;
  errorStage: RagErrorStage | null;
  errorRequestId: string | null;
  errorDetails: Json | null;
  createdAt: string;
  updatedAt: string;
};

export type RagPage = {
  id: string;
  documentId: string;
  pageNumber: number;
  rawText: string;
  cleanText: string;
  charCount: number;
  tokenCount: number;
  createdAt: string;
};

export type RagSection = {
  id: string;
  documentId: string;
  title: string;
  headingPath: string[];
  level: number;
  pageStart: number;
  pageEnd: number;
  source: SectionSource;
  createdAt: string;
};

export type RagChunk = {
  id: string;
  documentId: string;
  sectionId: string | null;
  parentChunkId: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  pageStart: number;
  pageEnd: number;
  headingPath: string[];
  tokenCount: number;
  charStart: number | null;
  charEnd: number | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  chunkVersion: string;
  metadata: Json;
  createdAt: string;
};

export type RagUpload = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  userId: string | null;
};

export type RetrievedChunk = {
  chunk: RagChunk;
  score: number;
  vectorScore: number;
  keywordScore: number;
};

export type RagCitation = {
  pageStart: number;
  pageEnd: number;
  chunkId: string;
  headingPath: string[];
  quote: string;
};

export type RagQueryResponse = {
  answer: string;
  citations: RagCitation[];
  retrievedChunks: Array<{
    chunkId: string;
    score: number;
    pageStart: number;
    pageEnd: number;
    headingPath: string[];
    preview: string;
  }>;
};
