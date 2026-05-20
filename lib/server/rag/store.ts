import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
  requireSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { PDF_PARSER_VERSION, DEFAULT_CHUNK_VERSION } from "./config";
import { RagError } from "./errors";
import { estimateTokenCount } from "./text";
import type {
  ParsedDocument,
  RagChunk,
  RagDocument,
  RagPage,
  RagSection,
  RagUpload,
} from "./types";

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
type PageRow = Database["public"]["Tables"]["document_pages"]["Row"];
type PageInsert = Database["public"]["Tables"]["document_pages"]["Insert"];
type SectionRow = Database["public"]["Tables"]["document_sections"]["Row"];
type SectionInsert = Database["public"]["Tables"]["document_sections"]["Insert"];
type ChunkRow = Database["public"]["Tables"]["document_chunks"]["Row"];
type ChunkInsert = Database["public"]["Tables"]["document_chunks"]["Insert"];

type RagDataFile = {
  version: 1;
  documents: RagDocument[];
  pages: RagPage[];
  sections: RagSection[];
  chunks: RagChunk[];
};

export type RagBackend = "file" | "supabase";

export type SaveParsedResult = {
  document: RagDocument;
  pages: RagPage[];
  sections: RagSection[];
};

export type RagRepository = {
  backend: RagBackend;
  createUploadedDocument: (upload: RagUpload) => Promise<RagDocument>;
  listDocuments: (userId: string) => Promise<RagDocument[]>;
  getDocument: (userId: string, documentId: string) => Promise<RagDocument | null>;
  renameDocument: (
    documentId: string,
    update: Pick<RagDocument, "fileName" | "title">,
  ) => Promise<RagDocument>;
  deleteDocument: (document: RagDocument) => Promise<void>;
  getDocumentFilePath: (document: RagDocument) => string | null;
  readDocumentFile: (document: RagDocument) => Promise<Uint8Array | null>;
  setDocumentStatus: (
    documentId: string,
    status: RagDocument["status"],
    update?: Partial<
      Pick<
        RagDocument,
        | "errorMessage"
        | "errorCode"
        | "errorStage"
        | "errorRequestId"
        | "errorDetails"
        | "pageCount"
        | "title"
        | "parserVersion"
        | "chunkVersion"
      >
    >,
  ) => Promise<RagDocument>;
  saveParsedDocument: (
    document: RagDocument,
    parsed: ParsedDocument,
  ) => Promise<SaveParsedResult>;
  getPages: (documentId: string) => Promise<RagPage[]>;
  getPage: (documentId: string, pageNumber: number) => Promise<RagPage | null>;
  getSections: (documentId: string) => Promise<RagSection[]>;
  replaceChunks: (documentId: string, chunks: RagChunk[]) => Promise<RagChunk[]>;
  countChunks: (documentId: string) => Promise<number>;
  getChunks: (documentId: string) => Promise<RagChunk[]>;
  transferOwner: (fromUserId: string, toUserId: string) => Promise<number>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "branchmind-rag.json");
const RAG_FILES_DIR = path.join(DATA_DIR, "rag-files");
let writeQueue: Promise<unknown> = Promise.resolve();

function emptyDataFile(): RagDataFile {
  return { version: 1, documents: [], pages: [], sections: [], chunks: [] };
}

function now() {
  return new Date().toISOString();
}

function isSupabaseSchemaError(error: { code?: string; message: string }) {
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /could not find|does not exist|schema cache/i.test(error.message)
  );
}

function assertNoError(
  error: { code?: string; message: string } | null,
  operation: string,
) {
  if (!error) return;
  const schemaError = isSupabaseSchemaError(error);
  const hint = schemaError
    ? " Apply the SQL files in supabase/migrations, including 20260516010000_pdf_rag_diagnostics.sql, then retry."
    : "";

  throw new RagError(`Supabase ${operation} failed: ${error.message}.${hint}`, {
    code: schemaError ? "RAG_SUPABASE_SCHEMA_ERROR" : "RAG_SUPABASE_ERROR",
    expose: true,
    status: 500,
  });
}

function notFound(): never {
  throw new RagError("Document was not found.", {
    code: "DOCUMENT_NOT_FOUND",
    status: 404,
  });
}

function requireRow<TRow>(row: TRow | null, operation: string): TRow {
  if (row) return row;
  throw new RagError(`Supabase ${operation} returned no row.`, {
    code: "RAG_SUPABASE_EMPTY_ROW",
    expose: true,
    status: 500,
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toDocument(row: DocumentRow): RagDocument {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    fileUrl: row.file_url,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    pageCount: row.page_count,
    title: row.title,
    status: row.status,
    parserVersion: row.parser_version,
    chunkVersion: row.chunk_version,
    errorMessage: row.error_message,
    errorCode: row.error_code ?? null,
    errorStage: (row.error_stage as RagDocument["errorStage"]) ?? null,
    errorRequestId: row.error_request_id ?? null,
    errorDetails: row.error_details ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeDocument(document: RagDocument): RagDocument {
  return {
    ...document,
    errorCode: document.errorCode ?? null,
    errorStage: document.errorStage ?? null,
    errorRequestId: document.errorRequestId ?? null,
    errorDetails: document.errorDetails ?? null,
  };
}

function toPage(row: PageRow): RagPage {
  return {
    id: row.id,
    documentId: row.document_id,
    pageNumber: row.page_number,
    rawText: row.raw_text,
    cleanText: row.clean_text,
    charCount: row.char_count,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}

function toStringArray(value: Json): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toSection(row: SectionRow): RagSection {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    headingPath: toStringArray(row.heading_path),
    level: row.level,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    source: row.source,
    createdAt: row.created_at,
  };
}

function parseVector(value: number[] | string | null) {
  if (Array.isArray(value)) return value;
  if (!value) return null;
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function toChunk(row: ChunkRow): RagChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    sectionId: row.section_id,
    parentChunkId: row.parent_chunk_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentHash: row.content_hash,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    headingPath: toStringArray(row.heading_path),
    tokenCount: row.token_count,
    charStart: row.char_start,
    charEnd: row.char_end,
    embedding: parseVector(row.embedding),
    embeddingModel: row.embedding_model,
    chunkVersion: row.chunk_version,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function pageToInsert(page: RagPage): PageInsert {
  return {
    id: page.id,
    document_id: page.documentId,
    page_number: page.pageNumber,
    raw_text: page.rawText,
    clean_text: page.cleanText,
    char_count: page.charCount,
    token_count: page.tokenCount,
    created_at: page.createdAt,
  };
}

function sectionToInsert(section: RagSection): SectionInsert {
  return {
    id: section.id,
    document_id: section.documentId,
    title: section.title,
    heading_path: section.headingPath,
    level: section.level,
    page_start: section.pageStart,
    page_end: section.pageEnd,
    source: section.source,
    created_at: section.createdAt,
  };
}

function chunkToInsert(chunk: RagChunk): ChunkInsert {
  return {
    id: chunk.id,
    document_id: chunk.documentId,
    section_id: chunk.sectionId,
    parent_chunk_id: chunk.parentChunkId,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    content_hash: chunk.contentHash,
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    heading_path: chunk.headingPath,
    token_count: chunk.tokenCount,
    char_start: chunk.charStart,
    char_end: chunk.charEnd,
    embedding: chunk.embedding,
    embedding_model: chunk.embeddingModel,
    chunk_version: chunk.chunkVersion,
    metadata: chunk.metadata,
    created_at: chunk.createdAt,
  };
}

function createPages(documentId: string, parsed: ParsedDocument): RagPage[] {
  const createdAt = now();
  return parsed.pages.map((page) => ({
    id: createId("page"),
    documentId,
    pageNumber: page.pageNumber,
    rawText: page.rawText,
    cleanText: page.cleanText,
    charCount: page.cleanText.length,
    tokenCount: estimateTokenCount(page.cleanText),
    createdAt,
  }));
}

function createSections(documentId: string, parsed: ParsedDocument): RagSection[] {
  const createdAt = now();
  return parsed.sections.map((section) => ({
    id: createId("section"),
    documentId,
    title: section.title,
    headingPath: section.headingPath,
    level: section.level,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    source: section.source,
    createdAt,
  }));
}

function normalizeDataFile(value: unknown): RagDataFile {
  if (!value || typeof value !== "object") {
    return emptyDataFile();
  }

  const record = value as Partial<RagDataFile>;
  return {
    version: 1,
    documents: Array.isArray(record.documents) ? record.documents : [],
    pages: Array.isArray(record.pages) ? record.pages : [],
    sections: Array.isArray(record.sections) ? record.sections : [],
    chunks: Array.isArray(record.chunks) ? record.chunks : [],
  };
}

async function readDataFile(): Promise<RagDataFile> {
  try {
    return normalizeDataFile(JSON.parse(await readFile(DATA_FILE, "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return emptyDataFile();
    }
    throw error;
  }
}

async function writeDataFile(data: RagDataFile) {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempFile, DATA_FILE);
}

function enqueueWrite<T>(operation: () => Promise<T>) {
  const nextWrite = writeQueue.then(operation, operation);
  writeQueue = nextWrite.catch(() => undefined);
  return nextWrite;
}

function requireFilePath(document: RagDocument) {
  if (!document.storagePath) return null;
  const filePath = path.resolve(document.storagePath);
  const filesDir = path.resolve(RAG_FILES_DIR);
  const relativePath = path.relative(filesDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return filePath;
}

async function deleteDocumentFile(document: RagDocument) {
  const filePath = requireFilePath(document);
  if (!filePath) return;

  try {
    await unlink(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

class FileRagRepository implements RagRepository {
  backend: RagBackend = "file";

  async createUploadedDocument(upload: RagUpload) {
    return enqueueWrite(async () => {
      const data = await readDataFile();
      const id = createId("doc");
      const createdAt = now();
      const storagePath = path.join(RAG_FILES_DIR, `${id}.pdf`);
      const document: RagDocument = {
        id,
        userId: upload.userId,
        fileName: upload.fileName,
        fileUrl: null,
        storagePath,
        mimeType: upload.mimeType,
        pageCount: 0,
        title: null,
        status: "uploaded",
        parserVersion: PDF_PARSER_VERSION,
        chunkVersion: DEFAULT_CHUNK_VERSION,
        errorMessage: null,
        errorCode: null,
        errorStage: null,
        errorRequestId: null,
        errorDetails: null,
        createdAt,
        updatedAt: createdAt,
      };

      await mkdir(RAG_FILES_DIR, { recursive: true });
      await writeFile(storagePath, upload.bytes);
      data.documents.unshift(document);
      await writeDataFile(data);
      return document;
    });
  }

  async listDocuments(userId: string) {
    const data = await readDataFile();
    return data.documents
      .filter((document) => document.userId === userId)
      .map(normalizeDocument)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getDocument(userId: string, documentId: string) {
    const data = await readDataFile();
    const document =
      data.documents.find(
        (document) => document.id === documentId && document.userId === userId,
      ) ?? null;
    return document ? normalizeDocument(document) : null;
  }

  async renameDocument(
    documentId: string,
    update: Pick<RagDocument, "fileName" | "title">,
  ) {
    return enqueueWrite(async () => {
      const data = await readDataFile();
      const index = data.documents.findIndex((document) => document.id === documentId);
      if (index < 0) notFound();

      const document = normalizeDocument({
        ...data.documents[index],
        fileName: update.fileName,
        title: update.title,
        updatedAt: now(),
      });
      data.documents[index] = document;
      await writeDataFile(data);
      return document;
    });
  }

  async deleteDocument(document: RagDocument) {
    await enqueueWrite(async () => {
      const data = await readDataFile();
      data.documents = data.documents.filter((item) => item.id !== document.id);
      data.pages = data.pages.filter((page) => page.documentId !== document.id);
      data.sections = data.sections.filter((section) => section.documentId !== document.id);
      data.chunks = data.chunks.filter((chunk) => chunk.documentId !== document.id);
      await writeDataFile(data);
    });
    await deleteDocumentFile(document);
  }

  getDocumentFilePath(document: RagDocument) {
    return requireFilePath(document);
  }

  async readDocumentFile(document: RagDocument) {
    const filePath = requireFilePath(document);
    if (!filePath) return null;
    try {
      return new Uint8Array(await readFile(filePath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async setDocumentStatus(
    documentId: string,
    status: RagDocument["status"],
    update: Parameters<RagRepository["setDocumentStatus"]>[2] = {},
  ) {
    return enqueueWrite(async () => {
      const data = await readDataFile();
      const index = data.documents.findIndex((document) => document.id === documentId);
      if (index < 0) notFound();

      const document = {
        ...data.documents[index],
        ...update,
        status,
        errorMessage: update.errorMessage ?? null,
        errorCode: update.errorCode ?? null,
        errorStage: update.errorStage ?? null,
        errorRequestId: update.errorRequestId ?? null,
        errorDetails: update.errorDetails ?? null,
        updatedAt: now(),
      };
      data.documents[index] = document;
      await writeDataFile(data);
      return document;
    });
  }

  async saveParsedDocument(document: RagDocument, parsed: ParsedDocument) {
    return enqueueWrite(async () => {
      const data = await readDataFile();
      const index = data.documents.findIndex((item) => item.id === document.id);
      if (index < 0) notFound();

      const pages = createPages(document.id, parsed);
      const sections = createSections(document.id, parsed);
      const nextDocument: RagDocument = {
        ...data.documents[index],
        pageCount: parsed.pageCount,
        title: parsed.title,
        status: "parsed",
        parserVersion: PDF_PARSER_VERSION,
        errorMessage: null,
        errorCode: null,
        errorStage: null,
        errorRequestId: null,
        errorDetails: null,
        updatedAt: now(),
      };

      data.documents[index] = nextDocument;
      data.pages = data.pages
        .filter((page) => page.documentId !== document.id)
        .concat(pages);
      data.sections = data.sections
        .filter((section) => section.documentId !== document.id)
        .concat(sections);
      data.chunks = data.chunks.filter((chunk) => chunk.documentId !== document.id);
      await writeDataFile(data);
      return { document: nextDocument, pages, sections };
    });
  }

  async getPages(documentId: string) {
    const data = await readDataFile();
    return data.pages
      .filter((page) => page.documentId === documentId)
      .sort((left, right) => left.pageNumber - right.pageNumber);
  }

  async getPage(documentId: string, pageNumber: number) {
    const pages = await this.getPages(documentId);
    return pages.find((page) => page.pageNumber === pageNumber) ?? null;
  }

  async getSections(documentId: string) {
    const data = await readDataFile();
    return data.sections
      .filter((section) => section.documentId === documentId)
      .sort((left, right) => left.pageStart - right.pageStart || left.level - right.level);
  }

  async replaceChunks(documentId: string, chunks: RagChunk[]) {
    return enqueueWrite(async () => {
      const data = await readDataFile();
      data.chunks = data.chunks
        .filter((chunk) => chunk.documentId !== documentId)
        .concat(chunks);
      const documentIndex = data.documents.findIndex(
        (document) => document.id === documentId,
      );
      if (documentIndex >= 0) {
        data.documents[documentIndex] = {
          ...data.documents[documentIndex],
          chunkVersion: DEFAULT_CHUNK_VERSION,
          updatedAt: now(),
        };
      }
      await writeDataFile(data);
      return chunks;
    });
  }

  async getChunks(documentId: string) {
    const data = await readDataFile();
    return data.chunks
      .filter((chunk) => chunk.documentId === documentId)
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
  }

  async countChunks(documentId: string) {
    const data = await readDataFile();
    return data.chunks.filter((chunk) => chunk.documentId === documentId).length;
  }

  async transferOwner(fromUserId: string, toUserId: string) {
    if (fromUserId === toUserId) return 0;

    return enqueueWrite(async () => {
      const data = await readDataFile();
      let transferredCount = 0;
      data.documents = data.documents.map((document) => {
        if (document.userId !== fromUserId) return document;
        transferredCount += 1;
        return { ...document, userId: toUserId, updatedAt: now() };
      });
      await writeDataFile(data);
      return transferredCount;
    });
  }
}

class SupabaseRagRepository implements RagRepository {
  backend: RagBackend = "supabase";

  async createUploadedDocument(upload: RagUpload) {
    const id = createId("doc");
    const createdAt = now();
    const row: DocumentInsert = {
      id,
      user_id: upload.userId,
      file_name: upload.fileName,
      file_url: null,
      storage_path: null,
      mime_type: upload.mimeType,
      page_count: 0,
      title: null,
      status: "uploaded",
      parser_version: PDF_PARSER_VERSION,
      chunk_version: DEFAULT_CHUNK_VERSION,
      error_message: null,
      error_code: null,
      error_stage: null,
      error_request_id: null,
      error_details: null,
      created_at: createdAt,
      updated_at: createdAt,
    };

    const { data, error } = await getSupabaseAdminClient()
      .from("documents")
      .insert(row)
      .select("*")
      .single();
    assertNoError(error, "create document");

    const storagePath = path.join(RAG_FILES_DIR, `${id}.pdf`);
    await mkdir(RAG_FILES_DIR, { recursive: true });
    await writeFile(storagePath, upload.bytes);

    const updateStorage = await getSupabaseAdminClient()
      .from("documents")
      .update({ storage_path: storagePath, updated_at: now() })
      .eq("id", id);
    assertNoError(updateStorage.error, "update document storage path");

    return { ...toDocument(requireRow(data, "create document")), storagePath };
  }

  async listDocuments(userId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("documents")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    assertNoError(error, "list documents");
    return (data ?? []).map(toDocument);
  }

  async getDocument(userId: string, documentId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .eq("user_id", userId)
      .maybeSingle();
    assertNoError(error, "read document");
    return data ? toDocument(data) : null;
  }

  async renameDocument(
    documentId: string,
    update: Pick<RagDocument, "fileName" | "title">,
  ) {
    const { data, error } = await getSupabaseAdminClient()
      .from("documents")
      .update({
        file_name: update.fileName,
        title: update.title,
        updated_at: now(),
      })
      .eq("id", documentId)
      .select("*")
      .single();
    assertNoError(error, "rename document");
    return toDocument(requireRow(data, "rename document"));
  }

  async deleteDocument(document: RagDocument) {
    const { error } = await getSupabaseAdminClient()
      .from("documents")
      .delete()
      .eq("id", document.id);
    assertNoError(error, "delete document");
    await deleteDocumentFile(document);
  }

  getDocumentFilePath(document: RagDocument) {
    return requireFilePath(document);
  }

  async readDocumentFile(document: RagDocument) {
    const filePath = requireFilePath(document);
    if (!filePath) return null;
    try {
      return new Uint8Array(await readFile(filePath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async setDocumentStatus(
    documentId: string,
    status: RagDocument["status"],
    update: Parameters<RagRepository["setDocumentStatus"]>[2] = {},
  ) {
    const { data, error } = await getSupabaseAdminClient()
      .from("documents")
      .update({
        status,
        error_message: update.errorMessage ?? null,
        error_code: update.errorCode ?? null,
        error_stage: update.errorStage ?? null,
        error_request_id: update.errorRequestId ?? null,
        error_details: update.errorDetails ?? null,
        page_count: update.pageCount,
        title: update.title,
        parser_version: update.parserVersion,
        chunk_version: update.chunkVersion,
        updated_at: now(),
      })
      .eq("id", documentId)
      .select("*")
      .single();
    assertNoError(error, "update document status");
    return toDocument(requireRow(data, "update document status"));
  }

  async saveParsedDocument(document: RagDocument, parsed: ParsedDocument) {
    const client = getSupabaseAdminClient();
    const pages = createPages(document.id, parsed);
    const sections = createSections(document.id, parsed);

    assertNoError(
      (await client.from("document_chunks").delete().eq("document_id", document.id))
        .error,
      "delete document chunks",
    );
    assertNoError(
      (await client.from("document_sections").delete().eq("document_id", document.id))
        .error,
      "delete document sections",
    );
    assertNoError(
      (await client.from("document_pages").delete().eq("document_id", document.id))
        .error,
      "delete document pages",
    );

    if (pages.length > 0) {
      assertNoError(
        (await client.from("document_pages").insert(pages.map(pageToInsert))).error,
        "insert document pages",
      );
    }
    if (sections.length > 0) {
      assertNoError(
        (await client
          .from("document_sections")
          .insert(sections.map(sectionToInsert))).error,
        "insert document sections",
      );
    }

    const { data, error } = await client
      .from("documents")
      .update({
        page_count: parsed.pageCount,
        title: parsed.title,
        status: "parsed",
        parser_version: PDF_PARSER_VERSION,
        error_message: null,
        error_code: null,
        error_stage: null,
        error_request_id: null,
        error_details: null,
        updated_at: now(),
      })
      .eq("id", document.id)
      .select("*")
      .single();
    assertNoError(error, "update parsed document");

    return {
      document: toDocument(requireRow(data, "update parsed document")),
      pages,
      sections,
    };
  }

  async getPages(documentId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("document_pages")
      .select("*")
      .eq("document_id", documentId)
      .order("page_number");
    assertNoError(error, "read document pages");
    return (data ?? []).map(toPage);
  }

  async getPage(documentId: string, pageNumber: number) {
    const { data, error } = await getSupabaseAdminClient()
      .from("document_pages")
      .select("*")
      .eq("document_id", documentId)
      .eq("page_number", pageNumber)
      .maybeSingle();
    assertNoError(error, "read document page");
    return data ? toPage(data) : null;
  }

  async getSections(documentId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("document_sections")
      .select("*")
      .eq("document_id", documentId)
      .order("page_start")
      .order("level");
    assertNoError(error, "read document sections");
    return (data ?? []).map(toSection);
  }

  async replaceChunks(documentId: string, chunks: RagChunk[]) {
    const client = getSupabaseAdminClient();
    assertNoError(
      (await client.from("document_chunks").delete().eq("document_id", documentId))
        .error,
      "delete document chunks",
    );
    if (chunks.length > 0) {
      assertNoError(
        (await client.from("document_chunks").insert(chunks.map(chunkToInsert))).error,
        "insert document chunks",
      );
    }
    assertNoError(
      (
        await client
          .from("documents")
          .update({ chunk_version: DEFAULT_CHUNK_VERSION, updated_at: now() })
          .eq("id", documentId)
      ).error,
      "update document chunk version",
    );
    return chunks;
  }

  async getChunks(documentId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("document_chunks")
      .select("*")
      .eq("document_id", documentId)
      .order("chunk_index");
    assertNoError(error, "read document chunks");
    return (data ?? []).map(toChunk);
  }

  async countChunks(documentId: string) {
    const { count, error } = await getSupabaseAdminClient()
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId);
    assertNoError(error, "count document chunks");
    return count ?? 0;
  }

  async transferOwner(fromUserId: string, toUserId: string) {
    if (fromUserId === toUserId) return 0;

    const { data, error } = await getSupabaseAdminClient()
      .from("documents")
      .update({ user_id: toUserId, updated_at: now() })
      .eq("user_id", fromUserId)
      .select("id");

    assertNoError(error, "transfer document owner");
    return data?.length ?? 0;
  }
}

const fileRepository = new FileRagRepository();
const supabaseRepository = new SupabaseRagRepository();

function getConfiguredBackend(): RagBackend | "auto" {
  const value = process.env.BRANCHMIND_RAG_BACKEND?.trim().toLowerCase();
  if (value === "file" || value === "supabase") return value;
  return "auto";
}

export function getRagRepository(): RagRepository {
  const backend = getConfiguredBackend();

  if (backend === "file") return fileRepository;
  if (backend === "supabase") {
    requireSupabaseServerConfig();
    return supabaseRepository;
  }

  if (hasSupabaseServerConfig()) return supabaseRepository;
  if (process.env.NODE_ENV === "production") requireSupabaseServerConfig();
  return fileRepository;
}

export async function requireOwnedDocument(userId: string, documentId: string) {
  const repository = getRagRepository();
  const document = await repository.getDocument(userId, documentId);
  if (!document) notFound();
  return document;
}

export async function transferRagOwner(fromUserId: string, toUserId: string) {
  return getRagRepository().transferOwner(fromUserId, toUserId);
}
