import { CHUNK_CONFIG } from "./config";
import { getEmbeddingProvider, type EmbeddingProvider } from "./embeddings";
import { RagError } from "./errors";
import { getKeywordTerms } from "./text";
import type { RagChunk, RetrievedChunk } from "./types";

function cosineSimilarity(left: number[] | null, right: number[]) {
  if (!left || left.length === 0 || right.length === 0) return 0;
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator ? dot / denominator : 0;
}

function keywordScore(question: string, content: string) {
  const queryTerms = getKeywordTerms(question);
  if (queryTerms.length === 0) return 0;

  const contentTerms = new Set(getKeywordTerms(content));
  const hits = queryTerms.filter((term) => contentTerms.has(term)).length;
  return hits / queryTerms.length;
}

function diverseTopChunks(chunks: RetrievedChunk[], count: number) {
  const selected: RetrievedChunk[] = [];
  const sectionCounts = new Map<string, number>();

  for (const item of chunks) {
    const sectionKey = item.chunk.headingPath.join(" > ") || "document";
    const sectionCount = sectionCounts.get(sectionKey) ?? 0;
    if (sectionCount >= 3 && selected.length < count - 1) continue;

    selected.push(item);
    sectionCounts.set(sectionKey, sectionCount + 1);
    if (selected.length >= count) break;
  }

  return selected;
}

export async function retrieveRelevantChunks(
  question: string,
  chunks: RagChunk[],
  options: {
    topK?: number;
    finalContextChunks?: number;
    embeddingProvider?: EmbeddingProvider;
  } = {},
) {
  if (chunks.length === 0) {
    throw new RagError("This document has no indexed chunks.", {
      code: "DOCUMENT_HAS_NO_CHUNKS",
      status: 409,
    });
  }

  const provider = options.embeddingProvider ?? getEmbeddingProvider();
  const queryEmbedding = await provider.embedQuery(question);
  const topK = options.topK ?? CHUNK_CONFIG.retrievalTopK;
  const finalContextChunks =
    options.finalContextChunks ?? CHUNK_CONFIG.finalContextChunks;

  const ranked = chunks
    .map((chunk): RetrievedChunk => {
      const vectorScore = cosineSimilarity(chunk.embedding, queryEmbedding);
      const termScore = keywordScore(question, chunk.content);
      return {
        chunk,
        vectorScore,
        keywordScore: termScore,
        score: vectorScore + termScore * 0.15,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(topK, finalContextChunks));

  return diverseTopChunks(ranked, finalContextChunks);
}
