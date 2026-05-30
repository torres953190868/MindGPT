#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const projectRoot = process.cwd();
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const dryRun = args.has("--dry-run");
const projectsOnly = args.has("--projects-only");
const ragOnly = args.has("--rag-only");
const RAG_FILES_BUCKET = "branchmind-rag-files";
const RAG_FILES_DIR = path.join(projectRoot, "data", "rag-files");

const migrationOptions = {
  batchSize: readPositiveIntegerOption("--batch-size", 500),
  chunkBatchSize: readPositiveIntegerOption("--chunk-batch-size", 100),
  concurrency: readPositiveIntegerOption("--concurrency", 3),
};

if (projectsOnly && ragOnly) {
  throw new Error("Use either --projects-only or --rag-only, not both.");
}

function readPositiveIntegerOption(name, fallback) {
  const equalsPrefix = `${name}=`;
  const equalsArg = rawArgs.find((arg) => arg.startsWith(equalsPrefix));
  const value = equalsArg
    ? equalsArg.slice(equalsPrefix.length)
    : rawArgs[rawArgs.indexOf(name) + 1];
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseEnvValue(rawValue) {
  let value = rawValue.trim();
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }

  if (quote === '"') {
    value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  return value;
}

async function loadLocalEnv() {
  const values = new Map();

  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(projectRoot, fileName);
    if (!existsSync(filePath)) continue;

    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      values.set(match[1], parseEnvValue(match[2]));
    }
  }

  for (const [key, value] of values) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function clean(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getSupabaseConfig() {
  const url = clean(process.env.SUPABASE_URL) ?? clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !serviceRoleKey) {
    const missing = [
      ["NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL", url],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    throw new Error(`Missing Supabase migration config: ${missing.join(", ")}.`);
  }

  return { url, serviceRoleKey };
}

function createSupabaseClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "branchmind-local-migration",
      },
    },
  });
}

function assertNoError(error, operation) {
  if (!error) return;

  const migrationHint =
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find|does not exist|schema cache/i.test(error.message ?? "")
      ? " Apply the SQL files in supabase/migrations first, then rerun this script."
      : "";

  throw new Error(`Supabase ${operation} failed: ${error.message}.${migrationHint}`);
}

async function readJsonFile(fileName, fallback) {
  const filePath = path.join(projectRoot, fileName);
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function ensureSelectableColumns(client, tableColumns) {
  for (const [tableName, columns] of Object.entries(tableColumns)) {
    const { error } = await client
      .from(tableName)
      .select(columns.join(","))
      .limit(1);
    assertNoError(error, `check ${tableName} columns`);
  }
}

async function insertRows(client, tableName, rows, options = {}) {
  if (rows.length === 0) return 0;

  const batchSize = options.batchSize ?? migrationOptions.batchSize;
  const concurrency = Math.min(options.concurrency ?? 1, Math.ceil(rows.length / batchSize));
  const batches = [];

  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push({
      start: index,
      rows: rows.slice(index, index + batchSize),
    });
  }

  let nextBatchIndex = 0;
  let completedBatches = 0;
  let insertedRows = 0;

  async function worker() {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[batchIndex];

      const { error } = await client.from(tableName).insert(batch.rows);
      assertNoError(
        error,
        `insert ${tableName} rows ${batch.start + 1}-${batch.start + batch.rows.length}`,
      );

      completedBatches += 1;
      insertedRows += batch.rows.length;
      if (options.logProgress) {
        console.log(
          `Inserted ${tableName}: ${insertedRows}/${rows.length} rows (${completedBatches}/${batches.length} batches)`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return rows.length;
}

async function deleteDocumentRows(client, documentId) {
  for (const tableName of ["document_chunks", "document_sections", "document_pages"]) {
    const deletion = await client.from(tableName).delete().eq("document_id", documentId);
    assertNoError(deletion.error, `delete ${tableName} for ${documentId}`);
  }
}

async function insertProjectRows(client, project, nodeRows, messageRows) {
  const upsertProject = await client.from("branchmind_projects").upsert(project);
  assertNoError(upsertProject.error, `upsert project ${project.id}`);

  const deleteMessages = await client
    .from("branchmind_messages")
    .delete()
    .eq("project_id", project.id);
  assertNoError(deleteMessages.error, `delete messages for ${project.id}`);

  const deleteNodes = await client
    .from("branchmind_nodes")
    .delete()
    .eq("project_id", project.id);
  assertNoError(deleteNodes.error, `delete nodes for ${project.id}`);

  await insertRows(client, "branchmind_nodes", nodeRows);
  await insertRows(client, "branchmind_messages", messageRows);
}

async function insertRagRows(client, documentId, pages, sections, chunks) {
  await insertRows(client, "document_pages", pages.map(pageToRow), {
    batchSize: migrationOptions.batchSize,
    concurrency: migrationOptions.concurrency,
    logProgress: true,
  });
  await insertRows(client, "document_sections", sections.map(sectionToRow), {
    batchSize: migrationOptions.batchSize,
    concurrency: migrationOptions.concurrency,
    logProgress: true,
  });

  const chunkConcurrency = chunks.some((chunk) => chunk.parentChunkId)
    ? 1
    : migrationOptions.concurrency;
  await insertRows(client, "document_chunks", chunks.map(chunkToRow), {
    batchSize: migrationOptions.chunkBatchSize,
    concurrency: chunkConcurrency,
    logProgress: true,
  });
}

function requireProjectOwner(project) {
  const ownerSessionId = project.ownerSessionId?.trim();
  if (!ownerSessionId) {
    throw new Error(`Project ${project.id} cannot be migrated without ownerSessionId.`);
  }

  return ownerSessionId;
}

function getPersistenceNodeOrder(project) {
  const ordered = [];
  const queuedIds = [project.rootNodeId];
  const seenIds = new Set();

  while (queuedIds.length > 0) {
    const id = queuedIds.shift();
    if (!id || seenIds.has(id)) continue;

    const node = project.nodes?.[id];
    if (!node) continue;

    ordered.push(node);
    seenIds.add(id);
    queuedIds.push(...(node.children ?? []));
  }

  for (const node of Object.values(project.nodes ?? {})) {
    if (!seenIds.has(node.id)) ordered.push(node);
  }

  return ordered;
}

function getChildOrder(project, node) {
  if (!node.parentId) return 0;
  const parent = project.nodes?.[node.parentId];
  const index = parent?.children?.indexOf(node.id) ?? -1;
  return index >= 0 ? index : 0;
}

function projectToRows(project) {
  const ownerSessionId = requireProjectOwner(project);
  const rootNode = project.nodes?.[project.rootNodeId];

  if (!rootNode) {
    throw new Error(`Project ${project.id} is missing root node ${project.rootNodeId}.`);
  }

  const projectRow = {
    id: project.id,
    owner_session_id: ownerSessionId,
    title: project.title,
    notes: typeof project.notes === "string" ? project.notes : "",
    root_node_id: project.rootNodeId,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
  const orderedNodes = getPersistenceNodeOrder(project);
  const nodeRows = orderedNodes.map((node) => ({
    id: node.id,
    project_id: project.id,
    parent_id: node.parentId ?? null,
    title: node.title,
    summary: node.summary ?? "",
    position_x: node.position?.x ?? 0,
    position_y: node.position?.y ?? 0,
    branch_type: node.branchType,
    collapsed: node.collapsed ?? false,
    child_order: getChildOrder(project, node),
    created_at: node.createdAt,
    updated_at: node.updatedAt,
  }));
  const messageRows = orderedNodes.flatMap((node) =>
    (node.messages ?? []).map((message, index) => ({
      id: message.id,
      project_id: project.id,
      node_id: node.id,
      role: message.role,
      content: message.content,
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
      sort_order: index,
      created_at: message.createdAt,
    })),
  );

  return { projectRow, nodeRows, messageRows };
}

async function migrateProjects(client, projects) {
  await ensureSelectableColumns(client, {
    branchmind_projects: [
      "id",
      "owner_session_id",
      "title",
      "notes",
      "root_node_id",
      "created_at",
      "updated_at",
    ],
    branchmind_nodes: [
      "id",
      "project_id",
      "parent_id",
      "title",
      "summary",
      "position_x",
      "position_y",
      "branch_type",
      "collapsed",
      "child_order",
      "created_at",
      "updated_at",
    ],
    branchmind_messages: [
      "id",
      "project_id",
      "node_id",
      "role",
      "content",
      "attachments",
      "sort_order",
      "created_at",
    ],
  });

  let nodeCount = 0;
  let messageCount = 0;

  for (const project of projects) {
    const { projectRow, nodeRows, messageRows } = projectToRows(project);
    await insertProjectRows(client, projectRow, nodeRows, messageRows);

    nodeCount += nodeRows.length;
    messageCount += messageRows.length;
    console.log(`Migrated project ${project.id}`);
  }

  return {
    projects: projects.length,
    nodes: nodeCount,
    messages: messageCount,
  };
}

function createRagStoragePath(userId, documentId) {
  return `users/${encodeURIComponent(normalizeOwnerId(userId) ?? "anonymous")}/${documentId}.pdf`;
}

function normalizeOwnerId(value) {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  const angleBracketMatch = /^<([^<>]+)>$/.exec(trimmed);
  return angleBracketMatch ? angleBracketMatch[1] : trimmed;
}

function isLocalFilePath(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return path.isAbsolute(value) || value.includes(`${path.sep}rag-files${path.sep}`);
}

async function resolveLocalPdfPath(document) {
  const candidates = [
    isLocalFilePath(document.storagePath) ? document.storagePath : null,
    path.join(RAG_FILES_DIR, `${document.id}.pdf`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const filePath = path.resolve(candidate);
    if (existsSync(filePath)) return filePath;
  }

  return null;
}

async function uploadRagDocumentFile(client, document) {
  const localPdfPath = await resolveLocalPdfPath(document);
  const hasLocalStoragePath = isLocalFilePath(document.storagePath);

  if (!localPdfPath) {
    if (hasLocalStoragePath) {
      throw new Error(
        `Document ${document.id} has a local storagePath, but the PDF file was not found.`,
      );
    }
    return document.storagePath ?? null;
  }

  const storagePath = createRagStoragePath(document.userId, document.id);
  const bytes = await readFile(localPdfPath);
  const { error } = await client.storage.from(RAG_FILES_BUCKET).upload(storagePath, bytes, {
    contentType: document.mimeType || "application/pdf",
    upsert: true,
  });
  assertNoError(error, `upload PDF file for document ${document.id}`);
  return storagePath;
}

function documentToRow(document, storagePath = document.storagePath ?? null) {
  return {
    id: document.id,
    user_id: normalizeOwnerId(document.userId),
    file_name: document.fileName,
    file_url: document.fileUrl ?? null,
    storage_path: storagePath,
    mime_type: document.mimeType,
    page_count: document.pageCount ?? 0,
    title: document.title ?? null,
    status: document.status,
    parser_version: document.parserVersion,
    chunk_version: document.chunkVersion,
    error_message: document.errorMessage ?? null,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

function pageToRow(page) {
  return {
    id: page.id,
    document_id: page.documentId,
    page_number: page.pageNumber,
    raw_text: page.rawText,
    clean_text: page.cleanText,
    char_count: page.charCount ?? 0,
    token_count: page.tokenCount ?? 0,
    created_at: page.createdAt,
  };
}

function sectionToRow(section) {
  return {
    id: section.id,
    document_id: section.documentId,
    title: section.title,
    heading_path: Array.isArray(section.headingPath) ? section.headingPath : [],
    level: section.level,
    page_start: section.pageStart,
    page_end: section.pageEnd,
    source: section.source,
    created_at: section.createdAt,
  };
}

function chunkToRow(chunk) {
  return {
    id: chunk.id,
    document_id: chunk.documentId,
    section_id: chunk.sectionId ?? null,
    parent_chunk_id: chunk.parentChunkId ?? null,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    content_hash: chunk.contentHash,
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    heading_path: Array.isArray(chunk.headingPath) ? chunk.headingPath : [],
    token_count: chunk.tokenCount,
    char_start: chunk.charStart ?? null,
    char_end: chunk.charEnd ?? null,
    embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null,
    embedding_model: chunk.embeddingModel ?? null,
    chunk_version: chunk.chunkVersion,
    metadata: chunk.metadata ?? {},
    created_at: chunk.createdAt,
  };
}

function orderChunksForInsert(chunks) {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(chunk) {
    if (visited.has(chunk.id)) return;
    if (visiting.has(chunk.id)) return;

    visiting.add(chunk.id);
    const parent = chunk.parentChunkId ? byId.get(chunk.parentChunkId) : null;
    if (parent) visit(parent);
    visiting.delete(chunk.id);
    visited.add(chunk.id);
    ordered.push(chunk);
  }

  for (const chunk of chunks) visit(chunk);
  return ordered;
}

async function migrateRag(client, ragData) {
  await ensureSelectableColumns(client, {
    documents: [
      "id",
      "user_id",
      "file_name",
      "file_url",
      "storage_path",
      "mime_type",
      "page_count",
      "title",
      "status",
      "parser_version",
      "chunk_version",
      "error_message",
      "created_at",
      "updated_at",
    ],
    document_pages: [
      "id",
      "document_id",
      "page_number",
      "raw_text",
      "clean_text",
      "char_count",
      "token_count",
      "created_at",
    ],
    document_sections: [
      "id",
      "document_id",
      "title",
      "heading_path",
      "level",
      "page_start",
      "page_end",
      "source",
      "created_at",
    ],
    document_chunks: [
      "id",
      "document_id",
      "section_id",
      "parent_chunk_id",
      "chunk_index",
      "content",
      "content_hash",
      "page_start",
      "page_end",
      "heading_path",
      "token_count",
      "char_start",
      "char_end",
      "embedding",
      "embedding_model",
      "chunk_version",
      "metadata",
      "created_at",
    ],
  });

  let pageCount = 0;
  let sectionCount = 0;
  let chunkCount = 0;

  for (const document of ragData.documents ?? []) {
    const documentId = document.id;
    const pages = (ragData.pages ?? []).filter((page) => page.documentId === documentId);
    const sections = (ragData.sections ?? []).filter(
      (section) => section.documentId === documentId,
    );
    const chunks = orderChunksForInsert(
      (ragData.chunks ?? []).filter((chunk) => chunk.documentId === documentId),
    );

    const storagePath = await uploadRagDocumentFile(client, document);
    const upsertDocument = await client
      .from("documents")
      .upsert(documentToRow(document, storagePath));
    assertNoError(upsertDocument.error, `upsert document ${documentId}`);

    await deleteDocumentRows(client, documentId);
    await insertRagRows(client, documentId, pages, sections, chunks);

    pageCount += pages.length;
    sectionCount += sections.length;
    chunkCount += chunks.length;
    console.log(`Migrated document ${documentId}`);
  }

  return {
    documents: ragData.documents?.length ?? 0,
    pages: pageCount,
    sections: sectionCount,
    chunks: chunkCount,
  };
}

async function main() {
  await loadLocalEnv();

  const projectData = await readJsonFile("data/branchmind-projects.json", {
    version: 1,
    projects: [],
  });
  const ragData = await readJsonFile("data/branchmind-rag.json", {
    version: 1,
    documents: [],
    pages: [],
    sections: [],
    chunks: [],
  });

  const localSummary = {
    projects: projectData.projects?.length ?? 0,
    documents: ragData.documents?.length ?? 0,
    pages: ragData.pages?.length ?? 0,
    sections: ragData.sections?.length ?? 0,
    chunks: ragData.chunks?.length ?? 0,
  };

  if (dryRun) {
    console.log("Dry run: no Supabase writes were made.");
    console.log(JSON.stringify(localSummary, null, 2));
    return;
  }

  const client = createSupabaseClient();
  const result = {};

  if (!ragOnly) {
    result.projects = await migrateProjects(client, projectData.projects ?? []);
  }

  if (!projectsOnly) {
    result.rag = await migrateRag(client, ragData);
  }

  console.log("Migration complete.");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
