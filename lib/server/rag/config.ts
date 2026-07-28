export const PDF_PARSER_VERSION = "pdf-text-v1";
export const DEFAULT_CHUNK_VERSION = "heading-recursive-v1";

export type ChunkConfig = {
  strategy: string;
  childChunkSizeTokens: number;
  childOverlapTokens: number;
  parentChunkSizeTokens: number;
  parentOverlapTokens: number;
  minChunkTokens: number;
  maxChunkTokens: number;
  retrievalTopK: number;
  finalContextChunks: number;
};

export const CHUNK_CONFIG: ChunkConfig = {
  strategy: DEFAULT_CHUNK_VERSION,
  childChunkSizeTokens: 512,
  childOverlapTokens: 64,
  parentChunkSizeTokens: 1500,
  parentOverlapTokens: 120,
  minChunkTokens: 80,
  maxChunkTokens: 800,
  retrievalTopK: 20,
  finalContextChunks: 6,
};

export const DEFAULT_EMBEDDING_PROVIDER = "dashscope";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-v4";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
export const MAX_DASHSCOPE_BATCH_SIZE = 10;
export const MAX_GEMINI_BATCH_SIZE = 10;

export function getMaxPdfSizeBytes() {
  const configured = Number(process.env.MAX_PDF_SIZE_MB ?? 50);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : 50;
  return Math.floor(megabytes * 1024 * 1024);
}
