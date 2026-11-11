import { createHash } from "node:crypto";
import type { ChatAttachment, ChatDocumentContext } from "@/lib/types";
import { generateGroundedAnswer } from "./answer";
import { getMaxPdfSizeBytes } from "./config";
import { getEmbeddingProvider } from "./embeddings";
import { RagError } from "./errors";
import { buildWorkspaceDocumentOutline } from "./outline";
import {
  computeRetrievalCandidateCount,
  rankMatchedChunks,
  retrieveRelevantChunks,
} from "./retriever";
import { getRagRepository, requireOwnedDocument, type RagRepository } from "./store";
import { compactText } from "./text";
import type {
  RagChunk,
  RagChunkMatch,
  RagDocument,
  RagSection,
  RetrievedChunk,
} from "./types";

const MAX_WORKSPACE_CONTEXT_DOCUMENTS = 3;
const MAX_WORKSPACE_CONTEXT_SNIPPETS = 6;
const MAX_WORKSPACE_SNIPPET_LENGTH = 1400;
const PDF_EXTENSION_PATTERN = /\.pdf$/i;

function normalizePdfName(name: string) {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = cleaned.replace(PDF_EXTENSION_PATTERN, "").trim();

  if (!title) {
    throw new RagError("PDF name is required.", {
      code: "DOCUMENT_NAME_REQUIRED",
      status: 400,
    });
  }

  return {
    title,
    fileName: `${title}.pdf`,
  };
}

function isPdf(fileName: string, mimeType: string) {
  return (
    mimeType.toLowerCase() === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf")
  );
}

function throwPdfFileNotFound(): never {
  throw new RagError("PDF file was not found.", {
    code: "PDF_FILE_NOT_FOUND",
    status: 404,
  });
}

export async function uploadPdfForOwner(
  userId: string,
  file: {
    name: string;
    type: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  },
) {
  if (!isPdf(file.name, file.type)) {
    throw new RagError("Only PDF uploads are supported.", {
      code: "PDF_REQUIRED",
      status: 415,
    });
  }

  const maxBytes = getMaxPdfSizeBytes();
  if (file.size > maxBytes) {
    throw new RagError("PDF upload is too large.", {
      code: "PDF_TOO_LARGE",
      status: 413,
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new RagError("PDF upload is too large.", {
      code: "PDF_TOO_LARGE",
      status: 413,
    });
  }

  return getRagRepository().createUploadedDocument({
    userId,
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  });
}

export async function listDocumentsForOwner(userId: string) {
  return getRagRepository().listDocuments(userId);
}

export async function getDocumentDetailsForOwner(userId: string, documentId: string) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);
  const [sections, chunkCount] = await Promise.all([
    repository.getSections(documentId),
    repository.countChunks(documentId),
  ]);

  return {
    document,
    sections,
    chunkCount,
  };
}

export async function renameDocumentForOwner(
  userId: string,
  documentId: string,
  name: string,
) {
  const repository = getRagRepository();
  await requireOwnedDocument(userId, documentId);
  return repository.renameDocument(documentId, normalizePdfName(name));
}

export async function deleteDocumentForOwner(userId: string, documentId: string) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);
  await repository.deleteDocument(document);
  return repository.listDocuments(userId);
}

export async function getDocumentPageForOwner(
  userId: string,
  documentId: string,
  pageNumber: number,
) {
  const repository = getRagRepository();
  await requireOwnedDocument(userId, documentId);
  const page = await repository.getPage(documentId, pageNumber);
  if (!page) {
    throw new RagError("Page was not found.", {
      code: "PAGE_NOT_FOUND",
      status: 404,
    });
  }
  return page;
}

export async function getDocumentFileForOwner(userId: string, documentId: string) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);
  const bytes = await repository.readDocumentFile(document);

  if (!bytes) {
    throwPdfFileNotFound();
  }

  return { document, bytes };
}

export async function getDocumentFileSourceForOwner(
  userId: string,
  documentId: string,
) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);
  const source = await repository.getDocumentFileSource(document);

  if (!source) {
    throwPdfFileNotFound();
  }

  return { document, source };
}

export async function getDocumentChunksForOwner(userId: string, documentId: string) {
  const repository = getRagRepository();
  await requireOwnedDocument(userId, documentId);
  return repository.getChunks(documentId);
}

function getRepositoryMatchChunks(repository: RagRepository) {
  return (repository as Partial<Pick<RagRepository, "matchChunks">>).matchChunks;
}

async function loadRepositorySections(
  repository: RagRepository,
  documentId: string,
): Promise<RagSection[]> {
  const getSections = (repository as Partial<Pick<RagRepository, "getSections">>)
    .getSections;
  if (typeof getSections !== "function") {
    return [];
  }
  return (await getSections.call(repository, documentId)) ?? [];
}

export async function queryDocumentForOwner(
  userId: string,
  documentId: string,
  question: string,
  topK?: number,
  options: { userPlan?: string | null } = {},
) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);

  if (document.status !== "indexed") {
    throw new RagError("Document is not indexed yet.", {
      code: "DOCUMENT_NOT_INDEXED",
      status: 409,
    });
  }

  const matchChunks = getRepositoryMatchChunks(repository);
  if (typeof matchChunks === "function") {
    const queryEmbedding = await getEmbeddingProvider().embedQuery(question);
    const candidateCount = computeRetrievalCandidateCount({ topK });
    const [sections, matches] = await Promise.all([
      loadRepositorySections(repository, documentId),
      matchChunks.call(repository, documentId, queryEmbedding, candidateCount),
    ]);
    const retrieved = rankMatchedChunks(question, matches, { topK });
    return generateGroundedAnswer(question, retrieved, sections, options);
  }

  const [sections, chunks] = await Promise.all([
    loadRepositorySections(repository, documentId),
    repository.getChunks(documentId),
  ]);
  const retrieved = await retrieveRelevantChunks(question, chunks, { topK });
  return generateGroundedAnswer(question, retrieved, sections, options);
}

function collectAttachmentDocumentIds(attachments: ChatAttachment[]): string[] {
  return Array.from(
    new Set(
      attachments
        .map((attachment) => attachment.documentId?.trim())
        .filter((documentId): documentId is string => Boolean(documentId)),
    ),
  );
}

type ResolvedWorkspaceDocument = {
  documentId: string;
  document: RagDocument;
  sections: RagSection[];
  chunks: RagChunk[];
};

type ResolvedMatchedWorkspaceDocument = {
  documentId: string;
  document: RagDocument;
  sections: RagSection[];
  matches: RagChunkMatch[];
};

function formatWorkspaceDocumentContext(
  documentId: string,
  document: RagDocument,
  sections: RagSection[],
  retrieved: RetrievedChunk[],
): ChatDocumentContext {
  const outline = buildWorkspaceDocumentOutline(sections);

  return {
    documentId,
    fileName: document.fileName,
    title: document.title,
    ...(outline ? { outline } : {}),
    snippets: retrieved.map((item) => ({
      chunkId: item.chunk.id,
      pageStart: item.chunk.pageStart,
      pageEnd: item.chunk.pageEnd,
      headingPath: item.chunk.headingPath,
      content: compactText(item.chunk.content, MAX_WORKSPACE_SNIPPET_LENGTH),
      score: item.score,
    })),
  };
}

export type WorkspaceDocumentContextOptions = {
  inheritedAttachments?: ChatAttachment[];
};

export async function getWorkspaceDocumentContextsForOwner(
  userId: string,
  attachments: ChatAttachment[],
  question: string,
  options?: WorkspaceDocumentContextOptions,
): Promise<ChatDocumentContext[]> {
  const allExplicitIds = collectAttachmentDocumentIds(attachments);
  const explicitIds = allExplicitIds.slice(0, MAX_WORKSPACE_CONTEXT_DOCUMENTS);
  const explicitIdSet = new Set(allExplicitIds);
  const inheritedIds = collectAttachmentDocumentIds(
    options?.inheritedAttachments ?? [],
  ).filter((documentId) => !explicitIdSet.has(documentId));

  if (explicitIds.length === 0 && inheritedIds.length === 0) {
    return [];
  }

  const repository = getRagRepository();
  const matchChunks = getRepositoryMatchChunks(repository);

  if (typeof matchChunks === "function") {
    const explicitDocs = await Promise.all(
      explicitIds.map(async (documentId) => {
        const document = await requireOwnedDocument(userId, documentId);
        if (document.status !== "indexed") {
          throw new RagError(`Attached PDF "${document.fileName}" is not indexed yet.`, {
            code: "ATTACHED_DOCUMENT_NOT_INDEXED",
            status: 409,
          });
        }
        return { documentId, document };
      }),
    );

    let queryEmbeddingPromise: Promise<number[]> | null = null;
    const getQueryEmbedding = () => {
      queryEmbeddingPromise ??= getEmbeddingProvider().embedQuery(question);
      return queryEmbeddingPromise;
    };
    const candidateCount = computeRetrievalCandidateCount({
      topK: Math.max(12, MAX_WORKSPACE_CONTEXT_SNIPPETS * 3),
      finalContextChunks: MAX_WORKSPACE_CONTEXT_SNIPPETS,
    });
    const loadSectionsAndMatches = async (
      documentId: string,
      queryEmbedding: number[],
    ) => {
      const [sections, matches] = await Promise.all([
        loadRepositorySections(repository, documentId),
        matchChunks.call(repository, documentId, queryEmbedding, candidateCount),
      ]);
      return {
        sections,
        matches,
      };
    };

    const resolvedMatchedDocs: ResolvedMatchedWorkspaceDocument[] =
      explicitDocs.length > 0
        ? await (async () => {
            const queryEmbedding = await getQueryEmbedding();
            return Promise.all(
              explicitDocs.map(async ({ documentId, document }) => {
                const { sections, matches } = await loadSectionsAndMatches(
                  documentId,
                  queryEmbedding,
                );
                if (matches.length === 0) {
                  throw new RagError("This document has no indexed chunks.", {
                    code: "DOCUMENT_HAS_NO_CHUNKS",
                    status: 409,
                  });
                }

                return {
                  documentId,
                  document,
                  sections,
                  matches,
                };
              }),
            );
          })()
        : [];

    for (const documentId of inheritedIds) {
      if (resolvedMatchedDocs.length >= MAX_WORKSPACE_CONTEXT_DOCUMENTS) {
        break;
      }

      const document = await repository.getDocument(userId, documentId);
      if (!document || document.status !== "indexed") {
        continue;
      }

      const queryEmbedding = await getQueryEmbedding();
      const { sections, matches } = await loadSectionsAndMatches(
        documentId,
        queryEmbedding,
      );
      if (matches.length === 0) {
        continue;
      }

      resolvedMatchedDocs.push({
        documentId,
        document,
        sections,
        matches,
      });
    }

    if (resolvedMatchedDocs.length === 0) {
      return [];
    }

    const snippetsPerDocument = Math.max(
      2,
      Math.ceil(MAX_WORKSPACE_CONTEXT_SNIPPETS / resolvedMatchedDocs.length),
    );

    return resolvedMatchedDocs.map(
      ({ documentId, document, sections, matches }) => {
        const retrieved = rankMatchedChunks(question, matches, {
          topK: Math.max(12, snippetsPerDocument * 3),
          finalContextChunks: snippetsPerDocument,
        });
        return formatWorkspaceDocumentContext(
          documentId,
          document,
          sections,
          retrieved,
        );
      },
    );
  }

  const loadSectionsAndChunks = async (documentId: string) => {
    const [sections, chunks] = await Promise.all([
      loadRepositorySections(repository, documentId),
      repository.getChunks(documentId),
    ]);
    return {
      sections,
      chunks,
    };
  };

  const resolvedDocs: ResolvedWorkspaceDocument[] = await Promise.all(
    explicitIds.map(async (documentId) => {
      const document = await requireOwnedDocument(userId, documentId);
      if (document.status !== "indexed") {
        throw new RagError(`Attached PDF "${document.fileName}" is not indexed yet.`, {
          code: "ATTACHED_DOCUMENT_NOT_INDEXED",
          status: 409,
        });
      }

      const { sections, chunks } = await loadSectionsAndChunks(documentId);
      if (chunks.length === 0) {
        throw new RagError("This document has no indexed chunks.", {
          code: "DOCUMENT_HAS_NO_CHUNKS",
          status: 409,
        });
      }

      return {
        documentId,
        document,
        sections,
        chunks,
      };
    }),
  );

  for (const documentId of inheritedIds) {
    if (resolvedDocs.length >= MAX_WORKSPACE_CONTEXT_DOCUMENTS) {
      break;
    }

    const document = await repository.getDocument(userId, documentId);
    if (!document || document.status !== "indexed") {
      continue;
    }

    const { sections, chunks } = await loadSectionsAndChunks(documentId);
    if (chunks.length === 0) {
      continue;
    }

    resolvedDocs.push({
      documentId,
      document,
      sections,
      chunks,
    });
  }

  if (resolvedDocs.length === 0) {
    return [];
  }

  const queryEmbedding = await getEmbeddingProvider().embedQuery(question);
  const snippetsPerDocument = Math.max(
    2,
    Math.ceil(MAX_WORKSPACE_CONTEXT_SNIPPETS / resolvedDocs.length),
  );

  return Promise.all(
    resolvedDocs.map(async ({ documentId, document, sections, chunks }) => {
      const retrieved = await retrieveRelevantChunks(question, chunks, {
        queryEmbedding,
        topK: Math.max(12, snippetsPerDocument * 3),
        finalContextChunks: snippetsPerDocument,
      });
      return formatWorkspaceDocumentContext(
        documentId,
        document,
        sections,
        retrieved,
      );
    }),
  );
}
