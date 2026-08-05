// SourceContentService tests (spec §9.8). Runs against the real file-backed
// curriculum repository in an isolated temp data directory; the project RAG
// service is replaced with a vi.mock — no network, no Supabase.

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCurriculumForOwner,
  createDraftVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import {
  saveSourceChunks,
  searchCourseSources,
  searchEnrolledCourseSources,
  searchSourceChunks,
  SourceContentError,
  splitSourceExcerpts,
} from "@/lib/research/source-chunk-service";
import { createValidCurriculumDraft } from "../../curriculum/fixtures";

const ragServiceMocks = vi.hoisted(() => ({
  listDocumentsForOwner: vi.fn(),
  getWorkspaceDocumentContextsForOwner: vi.fn(),
}));

vi.mock("@/lib/server/rag/service", () => ragServiceMocks);

const OWNER = "user_source_chunks";
const OTHER_OWNER = "user_source_chunks_other";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-source-chunks-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  ragServiceMocks.listDocumentsForOwner.mockReset();
  ragServiceMocks.getWorkspaceDocumentContextsForOwner.mockReset();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

// Creates a curriculum with one draft version and returns its first source id.
async function createSourceContext() {
  const curriculum = await createCurriculumForOwner(OWNER, {
    title: "Deep Learning Foundations",
    subject: "Deep Learning",
    learningGoal: "Understand the core building blocks of deep learning.",
  });
  const content = await createDraftVersionForOwner(
    OWNER,
    curriculum.id,
    createValidCurriculumDraft(),
  );
  return {
    curriculumId: curriculum.id,
    versionId: content.version.id,
    sourceIds: content.draft.sources.map((source) => source.id),
  };
}

function sha256Hex(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

describe("splitSourceExcerpts", () => {
  it("merges paragraphs up to the cap and never exceeds it", () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, index) => `Paragraph ${index}. ${"text ".repeat(100)}`,
    ).join("\n\n");

    const excerpts = splitSourceExcerpts(paragraphs, 1800);

    expect(excerpts.length).toBeGreaterThan(1);
    for (const excerpt of excerpts) {
      expect(excerpt.length).toBeLessThanOrEqual(1800);
    }
    // Paragraph boundaries are preferred: no excerpt starts mid-paragraph.
    for (const excerpt of excerpts.slice(1)) {
      expect(excerpt.startsWith("Paragraph")).toBe(true);
    }
  });

  it("hard-slices a single oversized paragraph", () => {
    const excerpts = splitSourceExcerpts("x".repeat(4000), 1800);

    expect(excerpts).toHaveLength(3); // 1800 + 1800 + 400
    expect(excerpts.every((excerpt) => excerpt.length <= 1800)).toBe(true);
  });

  it("returns no excerpts for empty content", () => {
    expect(splitSourceExcerpts(" \n\n ", 1800)).toEqual([]);
  });
});

describe("saveSourceChunks", () => {
  it("persists excerpts with sha256 hashes, token counts and indexes", async () => {
    const { sourceIds } = await createSourceContext();
    const content = [
      "Neural networks are composed of layers.",
      "Each layer applies a linear map followed by a nonlinearity.",
    ].join("\n\n");

    const saved = await saveSourceChunks(
      { sourceId: sourceIds[0], content, fetchedAt: "2026-08-01T00:00:00.000Z" },
    );

    expect(saved).toHaveLength(1); // both paragraphs fit into one excerpt
    expect(saved[0]?.excerpt).toBe(content);
    expect(saved[0]?.contentHash).toBe(sha256Hex(content));
    expect(saved[0]?.tokenCount).toBeGreaterThan(0);
    expect(saved[0]?.chunkIndex).toBe(0);
    expect(saved[0]?.sourceId).toBe(sourceIds[0]);
    // fetchedAt pins the row timestamps for deterministic generation runs.
    expect(saved[0]?.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("is idempotent: re-saving identical content returns the untouched rows", async () => {
    const { sourceIds } = await createSourceContext();
    const content = `First paragraph about gradient descent.\n\n${"Second. ".repeat(300)}`;

    const first = await saveSourceChunks({ sourceId: sourceIds[0], content });
    const second = await saveSourceChunks({ sourceId: sourceIds[0], content });

    expect(second).toEqual(first);
    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
  });

  it("replaces stale chunks when the content changes", async () => {
    const { sourceIds } = await createSourceContext();
    const long = `Intro.\n\n${"Body text. ".repeat(400)}`;

    const initial = await saveSourceChunks({ sourceId: sourceIds[0], content: long });
    expect(initial.length).toBeGreaterThan(1);

    const replaced = await saveSourceChunks({
      sourceId: sourceIds[0],
      content: "A short replacement.",
    });

    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.excerpt).toBe("A short replacement.");
    expect(replaced[0]?.id).not.toBe(initial[0]?.id);
    // No stale higher-index chunks survive the replacement.
    const leftovers = await searchSourceChunks({
      sourceIds: [sourceIds[0]],
      query: "Body text",
      topK: 10,
    });
    expect(leftovers).toEqual([]);
  });

  it("fails clearly for an unknown source id", async () => {
    await createSourceContext();

    await expect(
      saveSourceChunks({ sourceId: "csrc_missing", content: "anything" }),
    ).rejects.toMatchObject({
      name: "SourceContentError",
      code: "SOURCE_NOT_FOUND",
    } satisfies Partial<SourceContentError>);
  });
});

describe("searchSourceChunks", () => {
  it("ranks by keyword coverage with a frequency tiebreak (CJK included)", async () => {
    const { sourceIds } = await createSourceContext();
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content: [
        "深度学习是机器学习的一个分支。",
        "卷积神经网络常用于视觉任务。",
        "神经网络由层组成，神经网络可以拟合任意函数。",
      ].join("\n\n"),
    });

    const matches = await searchSourceChunks({
      sourceIds,
      query: "神经网络",
      topK: 10,
    });

    // The three short paragraphs merge into one excerpt; every Han character
    // of the query is covered, so the single chunk scores > 0.
    expect(matches).toHaveLength(1);
    expect(matches[0]?.excerpt).toContain("神经网络");
    expect(matches[0]?.score).toBeGreaterThan(0);
  });

  it("orders English matches by coverage then frequency and respects topK", async () => {
    const { sourceIds } = await createSourceContext();
    const pad = "Filler sentence without the terms. ".repeat(120);
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content: [
        `Gradient descent updates every parameter. ${pad}`,
        `Backprop applies gradient descent twice: gradient descent is central. ${pad}`,
        "Unrelated paragraph about data cleaning and spreadsheets.",
      ].join("\n\n"),
    });

    const matches = await searchSourceChunks({
      sourceIds,
      query: "gradient descent",
      topK: 1,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.excerpt).toContain("Backprop");

    const all = await searchSourceChunks({ sourceIds, query: "gradient descent", topK: 10 });
    expect(all).toHaveLength(2);
    expect(all[0]?.score ?? 0).toBeGreaterThan(all[1]?.score ?? 0);
  });

  it("returns nothing when no term matches", async () => {
    const { sourceIds } = await createSourceContext();
    await saveSourceChunks({ sourceId: sourceIds[0], content: "About cooking rice." });

    await expect(
      searchSourceChunks({ sourceIds, query: "quantum entanglement", topK: 5 }),
    ).resolves.toEqual([]);
  });
});

describe("searchCourseSources", () => {
  it("merges curriculum chunks with project RAG snippets, sorted by score", async () => {
    const { versionId, sourceIds } = await createSourceContext();
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content: "Gradient descent minimizes the loss function iteratively.",
    });

    ragServiceMocks.listDocumentsForOwner.mockResolvedValue([
      {
        id: "doc_indexed",
        fileName: "ml.pdf",
        status: "indexed",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "doc_parsing",
        fileName: "pending.pdf",
        status: "parsing",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    ragServiceMocks.getWorkspaceDocumentContextsForOwner.mockResolvedValue([
      {
        documentId: "doc_indexed",
        fileName: "ml.pdf",
        title: "ML textbook",
        snippets: [
          {
            chunkId: "chunk_pdf_1",
            pageStart: 3,
            pageEnd: 3,
            headingPath: ["Optimization"],
            content: "Gradient descent variants include SGD and Adam.",
            score: 2.5,
          },
        ],
      },
    ]);

    const matches = await searchCourseSources({
      ownerId: OWNER,
      curriculumVersionId: versionId,
      projectId: "project_1",
      query: "gradient descent",
      topK: 10,
    });

    expect(matches.map((match) => match.kind)).toEqual([
      "project_document", // score 2.5 outranks the curriculum chunk
      "curriculum_source",
    ]);
    const pdfMatch = matches[0];
    expect(pdfMatch).toMatchObject({
      documentId: "doc_indexed",
      fileName: "ml.pdf",
      pageStart: 3,
      excerpt: "Gradient descent variants include SGD and Adam.",
    });

    // Only the indexed document was attached to the RAG query.
    const [, attachments, query] =
      ragServiceMocks.getWorkspaceDocumentContextsForOwner.mock.calls[0] as [
        string,
        Array<{ documentId?: string }>,
        string,
      ];
    expect(attachments.map((attachment) => attachment.documentId)).toEqual(["doc_indexed"]);
    expect(query).toBe("gradient descent");
  });

  it("scopes curriculum chunks to the owner and skips the RAG call without projectId", async () => {
    const { versionId, sourceIds } = await createSourceContext();
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content: "Gradient descent minimizes the loss function.",
    });

    const ownMatches = await searchCourseSources({
      ownerId: OWNER,
      curriculumVersionId: versionId,
      query: "gradient descent",
      topK: 10,
    });
    expect(ownMatches).toHaveLength(1);
    expect(ownMatches[0]?.kind).toBe("curriculum_source");
    expect(ragServiceMocks.listDocumentsForOwner).not.toHaveBeenCalled();

    // Another owner cannot see the version's chunks.
    const foreignMatches = await searchCourseSources({
      ownerId: OTHER_OWNER,
      curriculumVersionId: versionId,
      query: "gradient descent",
      topK: 10,
    });
    expect(foreignMatches).toEqual([]);
  });

  it("truncates the merged result at topK", async () => {
    const { versionId, sourceIds } = await createSourceContext();
    const pad = "Padding sentence. ".repeat(120);
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content: [
        `Gradient descent first mention. ${pad}`,
        `Gradient descent second mention. ${pad}`,
        `Gradient descent third mention. ${pad}`,
      ].join("\n\n"),
    });

    const matches = await searchCourseSources({
      ownerId: OWNER,
      curriculumVersionId: versionId,
      query: "gradient descent",
      topK: 2,
    });

    expect(matches).toHaveLength(2);
  });

  it("retrieves an enrolled version without applying author ownership or project fallback", async () => {
    const { versionId, sourceIds } = await createSourceContext();
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content: "A unit test isolates one behavior and checks its expected result.",
    });

    const matches = await searchEnrolledCourseSources({
      curriculumVersionId: versionId,
      query: "unit test behavior",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourceId).toBe(sourceIds[0]);
    expect(ragServiceMocks.listDocumentsForOwner).not.toHaveBeenCalled();
  });
});
