import type { ChatAttachment, ChatDocumentContext } from "@/lib/types";
import { generateGroundedAnswer } from "./answer";
import { getMaxPdfSizeBytes } from "./config";
import { RagError } from "./errors";
import { retrieveRelevantChunks } from "./retriever";
import { getRagRepository, requireOwnedDocument } from "./store";
import { compactText } from "./text";

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

export async function getDocumentChunksForOwner(userId: string, documentId: string) {
  const repository = getRagRepository();
  await requireOwnedDocument(userId, documentId);
  return repository.getChunks(documentId);
}

export async function queryDocumentForOwner(
  userId: string,
  documentId: string,
  question: string,
  topK?: number,
) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);

  if (document.status !== "indexed") {
    throw new RagError("Document is not indexed yet.", {
      code: "DOCUMENT_NOT_INDEXED",
      status: 409,
    });
  }

  const [sections, chunks] = await Promise.all([
    repository.getSections(documentId),
    repository.getChunks(documentId),
  ]);
  const retrieved = await retrieveRelevantChunks(question, chunks, { topK });
  return generateGroundedAnswer(question, retrieved, sections);
}

export async function getWorkspaceDocumentContextsForOwner(
  userId: string,
  attachments: ChatAttachment[],
  question: string,
): Promise<ChatDocumentContext[]> {
  const documentIds = Array.from(
    new Set(
      attachments
        .map((attachment) => attachment.documentId?.trim())
        .filter((documentId): documentId is string => Boolean(documentId)),
    ),
  ).slice(0, MAX_WORKSPACE_CONTEXT_DOCUMENTS);

  if (documentIds.length === 0) return [];

  const repository = getRagRepository();
  const snippetsPerDocument = Math.max(
    2,
    Math.ceil(MAX_WORKSPACE_CONTEXT_SNIPPETS / documentIds.length),
  );

  return Promise.all(
    documentIds.map(async (documentId) => {
      const document = await requireOwnedDocument(userId, documentId);
      if (document.status !== "indexed") {
        throw new RagError(`Attached PDF "${document.fileName}" is not indexed yet.`, {
          code: "ATTACHED_DOCUMENT_NOT_INDEXED",
          status: 409,
        });
      }

      const chunks = await repository.getChunks(documentId);
      const retrieved = await retrieveRelevantChunks(question, chunks, {
        topK: Math.max(12, snippetsPerDocument * 3),
        finalContextChunks: snippetsPerDocument,
      });

      return {
        documentId,
        fileName: document.fileName,
        title: document.title,
        snippets: retrieved.map(({ chunk }) => ({
          chunkId: chunk.id,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          headingPath: chunk.headingPath,
          content: compactText(chunk.content, MAX_WORKSPACE_SNIPPET_LENGTH),
        })),
      };
    }),
  );
}
