import { chunkDocument } from "./chunker";
import { CHUNK_CONFIG, DEFAULT_CHUNK_VERSION, PDF_PARSER_VERSION } from "./config";
import {
  createRagFailureDiagnostic,
  logRagFailureDiagnostic,
} from "./diagnostics";
import { getEmbeddingProvider } from "./embeddings";
import { RagError } from "./errors";
import { parsePdf } from "./parser";
import { getRagRepository, requireOwnedDocument, type SaveParsedResult } from "./store";
import type { RagErrorStage } from "./types";

const CLEAR_RAG_ERROR = {
  errorCode: null,
  errorDetails: null,
  errorMessage: null,
  errorRequestId: null,
  errorStage: null,
};

export async function indexDocumentForOwner(
  userId: string,
  documentId: string,
  options: { requestId: string },
) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);
  let stage: RagErrorStage = "parsing";

  try {
    await repository.setDocumentStatus(document.id, "parsing", {
      ...CLEAR_RAG_ERROR,
      parserVersion: PDF_PARSER_VERSION,
      chunkVersion: DEFAULT_CHUNK_VERSION,
    });

    const fileBytes = await repository.readDocumentFile(document);
    let parsedResult: SaveParsedResult;

    if (fileBytes) {
      const parsed = await parsePdf(fileBytes);
      parsedResult = await repository.saveParsedDocument(document, parsed);
    } else {
      const pages = await repository.getPages(document.id);
      const sections = await repository.getSections(document.id);
      if (pages.length === 0 || sections.length === 0) {
        throw new RagError("The uploaded PDF file is not available for parsing.", {
          code: "PDF_FILE_MISSING",
          status: 409,
        });
      }
      parsedResult = {
        document: await repository.setDocumentStatus(document.id, "parsed", {
          ...CLEAR_RAG_ERROR,
          parserVersion: PDF_PARSER_VERSION,
          chunkVersion: DEFAULT_CHUNK_VERSION,
        }),
        pages,
        sections,
      };
    }

    stage = "chunking";
    const indexingDocument = await repository.setDocumentStatus(document.id, "indexing", {
      ...CLEAR_RAG_ERROR,
    });
    const chunks = chunkDocument(
      indexingDocument,
      parsedResult.pages,
      parsedResult.sections,
      CHUNK_CONFIG,
    );

    if (chunks.length === 0) {
      throw new RagError("No indexable text chunks were created from this PDF.", {
        code: "NO_INDEXABLE_CHUNKS",
        status: 422,
      });
    }

    stage = "embedding";
    const embeddingProvider = getEmbeddingProvider();
    const embeddings = await embeddingProvider.embedTexts(
      chunks.map((chunk) => chunk.content),
    );
    if (embeddings.length !== chunks.length) {
      throw new RagError("Embedding provider returned the wrong number of vectors.", {
        code: "EMBEDDING_COUNT_MISMATCH",
        status: 502,
      });
    }

    const embeddedChunks = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index],
      embeddingModel: embeddingProvider.model,
    }));

    stage = "persisting";
    await repository.replaceChunks(document.id, embeddedChunks);
    const indexedDocument = await repository.setDocumentStatus(document.id, "indexed", {
      ...CLEAR_RAG_ERROR,
      pageCount: parsedResult.document.pageCount,
      title: parsedResult.document.title,
      parserVersion: PDF_PARSER_VERSION,
      chunkVersion: DEFAULT_CHUNK_VERSION,
    });

    return {
      document: indexedDocument,
      pageCount: parsedResult.pages.length,
      sectionCount: parsedResult.sections.length,
      chunkCount: embeddedChunks.length,
      embeddingModel: embeddingProvider.model,
    };
  } catch (error) {
    const diagnostic = createRagFailureDiagnostic(error, {
      requestId: options.requestId,
      stage,
    });
    logRagFailureDiagnostic(document, diagnostic);
    await repository.setDocumentStatus(document.id, "failed", {
      errorCode: diagnostic.code,
      errorDetails: diagnostic.details,
      errorMessage: diagnostic.message,
      errorRequestId: diagnostic.requestId,
      errorStage: diagnostic.stage,
    });
    throw error;
  }
}
