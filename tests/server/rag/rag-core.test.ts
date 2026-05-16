import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPageText } from "@/lib/server/rag/cleaner";
import { chunkDocument } from "@/lib/server/rag/chunker";
import { CHUNK_CONFIG } from "@/lib/server/rag/config";
import { MockEmbeddingProvider } from "@/lib/server/rag/embeddings";
import { detectHeadingLine } from "@/lib/server/rag/headings";
import { parsePdf } from "@/lib/server/rag/parser";
import { generateGroundedAnswer } from "@/lib/server/rag/answer";
import { retrieveRelevantChunks } from "@/lib/server/rag/retriever";
import type { RagChunk, RagDocument, RagPage, RagSection } from "@/lib/server/rag/types";
import { createSyntheticPdf } from "./pdf-fixtures";

const document: RagDocument = {
  id: "doc_test",
  userId: "user_test",
  fileName: "memory.pdf",
  fileUrl: null,
  storagePath: null,
  mimeType: "application/pdf",
  pageCount: 3,
  title: "Memory",
  status: "parsed",
  parserVersion: "pdf-text-v1",
  chunkVersion: "heading-recursive-v1",
  errorMessage: null,
  errorCode: null,
  errorStage: null,
  errorRequestId: null,
  errorDetails: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const section: RagSection = {
  id: "section_test",
  documentId: document.id,
  title: "Chapter 1 Memory",
  headingPath: ["Chapter 1 Memory"],
  level: 1,
  pageStart: 1,
  pageEnd: 3,
  source: "regex",
  createdAt: document.createdAt,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function makePage(pageNumber: number, cleanText: string): RagPage {
  return {
    id: `page_${pageNumber}`,
    documentId: document.id,
    pageNumber,
    rawText: cleanText,
    cleanText,
    charCount: cleanText.length,
    tokenCount: cleanText.split(/\s+/).length,
    createdAt: document.createdAt,
  };
}

describe("PDF parser", () => {
  it("returns page-level text with page numbers", async () => {
    const parsed = await parsePdf(
      createSyntheticPdf([
        [
          "Chapter 1",
          "Selectable text appears on page one with enough content for parsing.",
          "This paragraph discusses memory, context, retrieval, and durable notes.",
        ],
        [
          "1.1 Background",
          "Page two continues with selectable text about long term memory systems.",
          "The reader should preserve the page number for future citations.",
        ],
      ]),
    );

    expect(parsed.pageCount).toBe(2);
    expect(parsed.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(parsed.pages[0].cleanText).toContain("Chapter 1");
    expect(parsed.sections.length).toBeGreaterThan(0);
  });

  it("fails empty PDFs with the OCR limitation message", async () => {
    await expect(parsePdf(createSyntheticPdf([[]]))).rejects.toThrow(
      "This MVP only supports text-based PDFs. OCR is not implemented yet.",
    );
  });
});

describe("text cleaning and heading detection", () => {
  it("preserves paragraph structure while normalizing whitespace", () => {
    expect(cleanPageText(" First   line \n\n\n Second\t paragraph ")).toBe(
      "First line\n\nSecond paragraph",
    );
  });

  it.each(["Chapter 1", "1.1 Background", "第1章 绪论", "一、研究背景"])(
    "detects %s as a heading",
    (line) => {
      expect(detectHeadingLine(line)).not.toBeNull();
    },
  );
});

describe("chunking", () => {
  it("keeps chunks under max size and preserves page metadata", () => {
    const pages = [
      makePage(1, `Chapter 1\n${"memory retrieval context ".repeat(70)}`),
      makePage(2, "long term memory durable notes ".repeat(80)),
      makePage(3, "summary ".repeat(12)),
    ];
    const chunks = chunkDocument(document, pages, [section], {
      ...CHUNK_CONFIG,
      childChunkSizeTokens: 90,
      childOverlapTokens: 12,
      minChunkTokens: 15,
      maxChunkTokens: 120,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 120)).toBe(true);
    expect(chunks.every((chunk) => chunk.headingPath[0] === "Chapter 1 Memory")).toBe(true);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks.at(-1)?.pageEnd).toBe(3);
    expect(chunks[1].content).toContain("memory");
  });

  it("merges tiny trailing chunks when the merged chunk fits", () => {
    const pages = [
      makePage(1, "alpha beta gamma delta ".repeat(12)),
      makePage(2, "tiny tail"),
    ];
    const chunks = chunkDocument(document, pages, [section], {
      ...CHUNK_CONFIG,
      childChunkSizeTokens: 100,
      childOverlapTokens: 5,
      minChunkTokens: 20,
      maxChunkTokens: 120,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageEnd).toBe(2);
  });
});

describe("embedding, retrieval, and answer shaping", () => {
  it("mock embeddings are deterministic", async () => {
    const provider = new MockEmbeddingProvider(16);
    await expect(provider.embedQuery("memory")).resolves.toEqual(
      await provider.embedQuery("memory"),
    );
  });

  it("retrieves chunks with citation-ready metadata", async () => {
    const provider = new MockEmbeddingProvider(32);
    const chunks: RagChunk[] = [
      {
        ...chunkDocument(document, [makePage(1, "memory retrieval recall")], [section])[0],
        id: "chunk_memory",
        embedding: (await provider.embedQuery("memory retrieval recall")),
      },
      {
        ...chunkDocument(document, [makePage(2, "unrelated cooking recipe")], [section])[0],
        id: "chunk_recipe",
        pageStart: 2,
        pageEnd: 2,
        embedding: (await provider.embedQuery("unrelated cooking recipe")),
      },
    ];

    const retrieved = await retrieveRelevantChunks("memory retrieval", chunks, {
      embeddingProvider: provider,
      finalContextChunks: 1,
    });

    expect(retrieved[0].chunk.id).toBe("chunk_memory");
    expect(retrieved[0].chunk.pageStart).toBe(1);
  });

  it("returns answer citations and retrieved chunk previews", async () => {
    vi.stubEnv("AI_MOCK_MODE", "true");
    const provider = new MockEmbeddingProvider(16);
    const [chunk] = chunkDocument(
      { ...document, status: "indexed" },
      [makePage(12, "Chapter 2\nLong term memory depends on retrieval cues.")],
      [{ ...section, pageStart: 12, pageEnd: 12 }],
    );
    const retrieved = [
      {
        chunk: {
          ...chunk,
          id: "chunk_answer",
          pageStart: 12,
          pageEnd: 12,
          embedding: await provider.embedQuery(chunk.content),
        },
        score: 0.9,
        vectorScore: 0.9,
        keywordScore: 0.3,
      },
    ];

    const answer = await generateGroundedAnswer("长期记忆是什么？", retrieved);

    expect(answer.answer).toContain("来源");
    expect(answer.citations[0]).toMatchObject({
      pageStart: 12,
      pageEnd: 12,
      chunkId: "chunk_answer",
    });
    expect(answer.retrievedChunks[0].preview).toContain("Long term memory");
  });

  it("returns the clear no-evidence answer when no chunks are retrieved", async () => {
    const answer = await generateGroundedAnswer("这个问题有依据吗？", [], [section]);

    expect(answer).toEqual({
      answer: "文档中没有找到明确依据。",
      citations: [],
      retrievedChunks: [],
    });
  });

  it("sends compressed outline metadata and retrieved chunks in the LLM prompt", async () => {
    vi.stubEnv("AI_MOCK_MODE", "false");
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-flash");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "deepseek-v4-flash");

    let prompt = "";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      prompt = body.messages.at(-1).content;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "数据方法来自检索片段。（第 7 页）\n\n来源\n- 第 7 页: Chapter 2 Method > 2.1 Data",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const methodSection: RagSection = {
      ...section,
      id: "section_method",
      title: "Chapter 2 Method",
      headingPath: ["Chapter 2 Method"],
      level: 1,
      pageStart: 6,
      pageEnd: 18,
    };
    const dataSection: RagSection = {
      ...section,
      id: "section_data",
      title: "2.1 Data",
      headingPath: ["Chapter 2 Method", "2.1 Data"],
      level: 2,
      pageStart: 7,
      pageEnd: 10,
    };
    const [chunk] = chunkDocument(
      { ...document, status: "indexed" },
      [makePage(7, "2.1 Data\nThe dataset includes retrieval logs.")],
      [dataSection],
    );
    const retrieved = [
      {
        chunk: {
          ...chunk,
          id: "chunk_prompt",
          pageStart: 7,
          pageEnd: 7,
        },
        score: 0.9,
        vectorScore: 0.8,
        keywordScore: 0.4,
      },
    ];

    const answer = await generateGroundedAnswer("数据方法是什么？", retrieved, [
      dataSection,
      methodSection,
    ]);

    expect(answer.answer).toContain("来源");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prompt).toContain("Document outline:");
    expect(prompt).toContain("- Chapter 2 Method, pp. 6-18");
    expect(prompt).toContain("  - 2.1 Data, pp. 7-10");
    expect(prompt).toContain("Retrieved context chunks:");
    expect(prompt).toContain(
      "[Chunk id: chunk_prompt | Pages 7 | Section: Chapter 2 Method > 2.1 Data]",
    );
    expect(prompt).toContain("数据方法是什么？");
    expect(prompt).toContain("The outline is metadata, not primary evidence.");
    expect(prompt).toContain("Do not invent facts from the outline.");
  });
});
