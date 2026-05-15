import { chunkDocument } from "./chunker";
import { CHUNK_CONFIG, DEFAULT_CHUNK_VERSION, PDF_PARSER_VERSION } from "./config";
import { getEmbeddingProvider } from "./embeddings";
import { RagError } from "./errors";
import { parsePdf } from "./parser";
import { getRagRepository, requireOwnedDocument, type SaveParsedResult } from "./store";

function exposeMessage(error: unknown) {
  if (error instanceof RagError) return error.message;
  if (error instanceof Error) return error.message;
  return "Document indexing failed.";
}

export async function indexDocumentForOwner(userId: string, documentId: string) {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);

  try {
    await repository.setDocumentStatus(document.id, "parsing", {
      errorMessage: null,
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
          errorMessage: null,
          parserVersion: PDF_PARSER_VERSION,
          chunkVersion: DEFAULT_CHUNK_VERSION,
        }),
        pages,
        sections,
      };
    }

    const indexingDocument = await repository.setDocumentStatus(document.id, "indexing", {
      errorMessage: null,
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

    await repository.replaceChunks(document.id, embeddedChunks);
    const indexedDocument = await repository.setDocumentStatus(document.id, "indexed", {
      errorMessage: null,
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
    await repository.setDocumentStatus(document.id, "failed", {
      errorMessage: exposeMessage(error),
    });
    throw error;
  }
}
