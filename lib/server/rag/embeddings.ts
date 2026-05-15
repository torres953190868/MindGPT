import { createHash } from "node:crypto";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  MAX_DASHSCOPE_BATCH_SIZE,
  MAX_GEMINI_BATCH_SIZE,
} from "./config";
import { RagError } from "./errors";

export type EmbeddingProvider = {
  model: string;
  dimensions?: number;
  embedTexts: (texts: string[]) => Promise<number[][]>;
  embedQuery: (query: string) => Promise<number[]>;
};

type EmbeddingResponseItem = {
  embedding: number[];
  index: number;
};

function configuredProvider() {
  return (process.env.EMBEDDING_PROVIDER ?? DEFAULT_EMBEDDING_PROVIDER)
    .trim()
    .toLowerCase();
}

function configuredDimensions(providerSpecificValue?: string) {
  const value = Number(
    process.env.EMBEDDING_DIMENSIONS ?? providerSpecificValue,
  );
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_EMBEDDING_DIMENSIONS;
}

function getDashScopeUrl() {
  return (
    process.env.DASHSCOPE_EMBEDDING_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"
  ).trim();
}

function getGeminiModelId(model: string) {
  return model.trim().replace(/^models\//, "");
}

function getGeminiModelResource(model: string) {
  return `models/${getGeminiModelId(model)}`;
}

function getGeminiUrl(model: string) {
  const configuredUrl = process.env.GEMINI_EMBEDDING_URL?.trim();
  if (configuredUrl) return configuredUrl;
  return `https://generativelanguage.googleapis.com/v1beta/${getGeminiModelResource(
    model,
  )}:batchEmbedContents`;
}

function getConfiguredGeminiModel() {
  const model =
    process.env.GEMINI_EMBEDDING_MODEL?.trim() ||
    process.env.EMBEDDING_MODEL?.trim();
  if (model && model !== DEFAULT_EMBEDDING_MODEL) return model;
  return DEFAULT_GEMINI_EMBEDDING_MODEL;
}

function isMockMode() {
  const value =
    process.env.AI_MOCK_MODE ??
    process.env.RAG_MOCK_MODE ??
    process.env.EMBEDDING_MOCK_MODE;
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseEmbeddingResponse(data: unknown) {
  if (!data || typeof data !== "object" || !("data" in data)) {
    throw new RagError("Embedding provider returned invalid JSON.", {
      code: "EMBEDDING_INVALID_RESPONSE",
      status: 502,
    });
  }

  const items = (data as { data: unknown }).data;
  if (!Array.isArray(items)) {
    throw new RagError("Embedding provider returned invalid data.", {
      code: "EMBEDDING_INVALID_DATA",
      status: 502,
    });
  }

  return items.map((item): EmbeddingResponseItem => {
    if (!item || typeof item !== "object") {
      throw new RagError("Embedding item is invalid.", {
        code: "EMBEDDING_INVALID_ITEM",
        status: 502,
      });
    }
    const record = item as { embedding?: unknown; index?: unknown };
    if (
      !Array.isArray(record.embedding) ||
      !record.embedding.every((value) => typeof value === "number")
    ) {
      throw new RagError("Embedding vector is invalid.", {
        code: "EMBEDDING_INVALID_VECTOR",
        status: 502,
      });
    }

    return {
      embedding: record.embedding,
      index: typeof record.index === "number" ? record.index : 0,
    };
  });
}

function parseGeminiEmbeddingValues(embedding: unknown): number[] {
  if (!embedding || typeof embedding !== "object") {
    throw new RagError("Gemini embedding item is invalid.", {
      code: "GEMINI_EMBEDDING_INVALID_ITEM",
      status: 502,
    });
  }
  const values = (embedding as { values?: unknown }).values;
  if (!Array.isArray(values) || !values.every((value) => typeof value === "number")) {
    throw new RagError("Gemini embedding vector is invalid.", {
      code: "GEMINI_EMBEDDING_INVALID_VECTOR",
      status: 502,
    });
  }
  return values as number[];
}

function parseGeminiBatchResponse(data: unknown): number[][] {
  if (!data || typeof data !== "object" || !("embeddings" in data)) {
    throw new RagError("Gemini embedding provider returned invalid JSON.", {
      code: "GEMINI_EMBEDDING_INVALID_RESPONSE",
      status: 502,
    });
  }

  const embeddings = (data as { embeddings: unknown }).embeddings;
  if (!Array.isArray(embeddings)) {
    throw new RagError("Gemini embedding provider returned invalid data.", {
      code: "GEMINI_EMBEDDING_INVALID_DATA",
      status: 502,
    });
  }

  return embeddings.map(parseGeminiEmbeddingValues);
}

function extractProviderErrorMessage(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (data as { error: { message: string } }).error.message;
  }
  return fallback;
}

function assertDashScopeApiKey() {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) {
    throw new RagError("DASHSCOPE_API_KEY is not configured.", {
      code: "DASHSCOPE_API_KEY_MISSING",
      status: 500,
    });
  }
  return key;
}

function assertGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new RagError("GEMINI_API_KEY is not configured.", {
      code: "GEMINI_API_KEY_MISSING",
      status: 500,
    });
  }
  return key;
}

function normalizeVector(vector: number[]) {
  const norm = Math.hypot(...vector);
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

export class DashScopeEmbeddingProvider implements EmbeddingProvider {
  model: string;
  dimensions: number;

  constructor(
    model = process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    dimensions = configuredDimensions(process.env.DASHSCOPE_EMBEDDING_DIMENSIONS),
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedTexts(texts: string[]) {
    const batches: number[][] = [];
    for (let index = 0; index < texts.length; index += MAX_DASHSCOPE_BATCH_SIZE) {
      const batch = texts.slice(index, index + MAX_DASHSCOPE_BATCH_SIZE);
      batches.push(...(await this.embedBatch(batch)));
    }
    return batches;
  }

  async embedQuery(query: string) {
    const [embedding] = await this.embedTexts([query]);
    return embedding;
  }

  private async embedBatch(texts: string[]) {
    const apiKey = assertDashScopeApiKey();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(getDashScopeUrl(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
            dimensions: this.dimensions,
            encoding_format: "float",
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const message = extractProviderErrorMessage(
            data,
            "DashScope embedding request failed.",
          );
          throw new RagError(message, {
            code: "DASHSCOPE_EMBEDDING_FAILED",
            status: response.status >= 400 ? response.status : 502,
          });
        }

        return parseEmbeddingResponse(data)
          .sort((left, right) => left.index - right.index)
          .map((item) => item.embedding);
      } catch (error) {
        lastError = error;
        if (error instanceof RagError && error.status < 500) throw error;
        if (attempt < 3) await sleep(250 * 2 ** (attempt - 1));
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new RagError("DashScope embedding request failed.", {
      code: "DASHSCOPE_EMBEDDING_FAILED",
      status: 502,
    });
  }
}

type GeminiEmbeddingKind = "document" | "query";

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  model: string;
  dimensions: number;

  constructor(
    model = getConfiguredGeminiModel(),
    dimensions = configuredDimensions(process.env.GEMINI_EMBEDDING_DIMENSIONS),
  ) {
    this.model = getGeminiModelId(model);
    this.dimensions = dimensions;
  }

  async embedTexts(texts: string[]) {
    if (texts.length === 0) return [];

    const batches: number[][] = [];
    for (let index = 0; index < texts.length; index += MAX_GEMINI_BATCH_SIZE) {
      const batch = texts.slice(index, index + MAX_GEMINI_BATCH_SIZE);
      batches.push(...(await this.embedBatch(batch, "document")));
    }
    return batches;
  }

  async embedQuery(query: string) {
    const [embedding] = await this.embedBatch([query], "query");
    return embedding;
  }

  private get modelResource() {
    return getGeminiModelResource(this.model);
  }

  private usesEmbedding2() {
    return this.model === DEFAULT_GEMINI_EMBEDDING_MODEL;
  }

  private formatText(text: string, kind: GeminiEmbeddingKind) {
    if (!this.usesEmbedding2()) return text;
    return kind === "query"
      ? `task: question answering | query: ${text}`
      : `title: none | text: ${text}`;
  }

  private createRequest(text: string, kind: GeminiEmbeddingKind) {
    const request: Record<string, unknown> = {
      model: this.modelResource,
      content: {
        parts: [{ text: this.formatText(text, kind) }],
      },
      outputDimensionality: this.dimensions,
    };

    if (!this.usesEmbedding2()) {
      request.taskType =
        kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
      if (kind === "document") request.title = "none";
    }

    return request;
  }

  private shouldNormalizeVectors() {
    return this.model === "gemini-embedding-001" && this.dimensions !== 3072;
  }

  private async embedBatch(texts: string[], kind: GeminiEmbeddingKind) {
    const apiKey = assertGeminiApiKey();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(getGeminiUrl(this.model), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            requests: texts.map((text) => this.createRequest(text, kind)),
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const message = extractProviderErrorMessage(
            data,
            "Gemini embedding request failed.",
          );
          throw new RagError(message, {
            code: "GEMINI_EMBEDDING_FAILED",
            status: response.status >= 400 ? response.status : 502,
          });
        }

        const embeddings = parseGeminiBatchResponse(data);
        return this.shouldNormalizeVectors()
          ? embeddings.map(normalizeVector)
          : embeddings;
      } catch (error) {
        lastError = error;
        if (error instanceof RagError && error.status < 500) throw error;
        if (attempt < 3) await sleep(250 * 2 ** (attempt - 1));
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new RagError("Gemini embedding request failed.", {
      code: "GEMINI_EMBEDDING_FAILED",
      status: 502,
    });
  }
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  model = "mock-embedding-v1";
  dimensions: number;

  constructor(dimensions = 64) {
    this.dimensions = dimensions;
  }

  async embedTexts(texts: string[]) {
    return texts.map((text) => this.embedDeterministic(text));
  }

  async embedQuery(query: string) {
    return this.embedDeterministic(query);
  }

  private embedDeterministic(text: string) {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [];

    for (const token of tokens) {
      const hash = createHash("sha256").update(token).digest();
      const index = hash[0] % this.dimensions;
      const sign = hash[1] % 2 === 0 ? 1 : -1;
      vector[index] += sign * (1 + Math.min(token.length, 8) / 8);
    }

    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = configuredProvider();
  if (provider === "mock" || isMockMode()) return new MockEmbeddingProvider();
  if (provider === "dashscope" || provider === "alibaba") {
    return new DashScopeEmbeddingProvider();
  }
  if (provider === "gemini" || provider === "google") {
    return new GeminiEmbeddingProvider();
  }

  throw new RagError(`Unsupported embedding provider: ${provider}.`, {
    code: "EMBEDDING_PROVIDER_UNSUPPORTED",
    status: 500,
  });
}
