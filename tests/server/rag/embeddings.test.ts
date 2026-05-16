import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeminiEmbeddingProvider,
  getEmbeddingProvider,
} from "@/lib/server/rag/embeddings";

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("GeminiEmbeddingProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("embeds document text with the Gemini batch endpoint", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiEmbeddingProvider("gemini-embedding-2", 2);
    await expect(provider.embedTexts(["alpha", "beta"])).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call?.[0];
    const init = call?.[1];
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
    );
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-gemini-key",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: [
        {
          model: "models/gemini-embedding-2",
          content: { parts: [{ text: "title: none | text: alpha" }] },
          outputDimensionality: 2,
        },
        {
          model: "models/gemini-embedding-2",
          content: { parts: [{ text: "title: none | text: beta" }] },
          outputDimensionality: 2,
        },
      ],
    });
  });

  it("embeds queries with the Gemini 2 retrieval prompt format", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ embeddings: [{ values: [0.5, 0.6] }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiEmbeddingProvider("models/gemini-embedding-2", 2);
    await expect(provider.embedQuery("what is memory?")).resolves.toEqual([0.5, 0.6]);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requests: [
        {
          content: {
            parts: [
              { text: "task: question answering | query: what is memory?" },
            ],
          },
        },
      ],
    });
  });

  it("keeps legacy Gemini retrieval task types and normalizes truncated vectors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ embeddings: [{ values: [3, 4] }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiEmbeddingProvider("gemini-embedding-001", 2);
    await expect(provider.embedTexts(["alpha"])).resolves.toEqual([[0.6, 0.8]]);

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: [
        {
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: "alpha" }] },
          outputDimensionality: 2,
          taskType: "RETRIEVAL_DOCUMENT",
          title: "none",
        },
      ],
    });
  });

  it("retries transient Gemini rate limits", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("EMBEDDING_RETRY_DELAY_MS", "0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "Resource exhausted. Please try again later." } },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ embeddings: [{ values: [0.7, 0.8] }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiEmbeddingProvider("gemini-embedding-2", 2);
    await expect(provider.embedTexts(["alpha"])).resolves.toEqual([[0.7, 0.8]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("selects Gemini when configured as the embedding provider", () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "gemini");
    vi.stubEnv("EMBEDDING_MODEL", "");

    const provider = getEmbeddingProvider();

    expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
    expect(provider.model).toBe("gemini-embedding-2");
  });
});
