// CurriculumRepository (spec §7) — persistence abstraction for the curriculum
// domain: curricula, draft/published versions, and the version content graph
// (modules, nodes, edges, sources, node-source bindings). Dual backends
// ("file" for local dev/tests, "supabase" for production) selected by
// getCurriculumRepository() exactly like projects-repository / the RAG store:
// BRANCHMIND_CURRICULUM_BACKEND = auto|file|supabase; auto = supabase when
// configured, file outside production, supabase required in production. The
// file backend is forbidden in production unless
// BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION=true (smoke tests only).
//
// Owner scoping: every method takes ownerId and only touches rows owned by
// it; a missing or foreign-owned curriculum returns null (404 semantics live
// in the service layer), mirroring the RAG requireOwnedDocument pattern.
//
// File backend notes:
// - Persists to data/branchmind-curriculum.json as { version: 1, curricula,
//   sourceChunks } with nested version content. Writes go through a
//   per-process write queue and a temp-file + rename swap (same pattern as
//   projects-store), so a failed write can never leave a torn file behind.
// - version_number allocation and publish both run inside the write queue,
//   which serializes read-modify-write per process: concurrent version
//   creation cannot allocate duplicate numbers, and a publish that throws
//   midway persists nothing — the queued mutation computes the full next
//   state in memory and only then performs the atomic write, giving the same
//   all-or-nothing semantics as the publish_curriculum_version RPC.
// - BRANCHMIND_CURRICULUM_DATA_DIR overrides the data directory (tests).

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import { buildCurriculumEdges } from "@/lib/curriculum/curriculum-graph-service";
import type {
  CurriculumBuildRequest,
  CurriculumConflict,
  CurriculumDraft,
  CurriculumEdgeRow,
  CurriculumModuleRow,
  CurriculumNodeRow,
  CurriculumNodeSourceRow,
  CurriculumRow,
  CurriculumSourceChunkRow,
  CurriculumSourceRow,
  CurriculumStatus,
  CurriculumVersionRow,
  CurriculumVersionStatus,
} from "@/lib/curriculum/curriculum-types";
import type { CurriculumValidationResult } from "@/lib/curriculum/curriculum-validation-service";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
  requireSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Public contract (DTOs are camelCase; row shapes stay internal).
// ---------------------------------------------------------------------------

export type CurriculumBackend = "file" | "supabase";

export type CurriculumDto = {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  title: string;
  subject: string;
  learningGoal: string;
  status: CurriculumStatus;
  createdAt: string;
  updatedAt: string;
};

export type CurriculumVersionDto = {
  id: string;
  curriculumId: string;
  versionNumber: number;
  versionLabel: string;
  status: CurriculumVersionStatus;
  audience: string;
  assumptions: string[];
  exclusions: string[];
  conflicts: CurriculumConflict[];
  estimatedWeeks: number | null;
  estimatedHours: number | null;
  buildRequest: CurriculumBuildRequest | null;
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
};

// A version aggregated with its content graph. The draft is reassembled in
// CurriculumDraft shape with the persisted server ids standing in for the
// original builder clientIds (clientIds only exist until persistence).
export type CurriculumVersionContentDto = {
  version: CurriculumVersionDto;
  draft: CurriculumDraft;
  validation: unknown | null;
};

export type CurriculumOverviewDto = {
  curriculum: CurriculumDto;
  versions: CurriculumVersionDto[];
  defaultVersion: CurriculumVersionContentDto | null;
};

export type CreateCurriculumInput = {
  title: string;
  subject?: string;
  learningGoal: string;
  projectId?: string;
};

export type UpdateCurriculumPatch = {
  title?: string;
  learningGoal?: string;
};

export type CreateDraftVersionInput = {
  draft: CurriculumDraft;
  validation: CurriculumValidationResult;
  buildRequest?: CurriculumBuildRequest | null;
  createdBy?: string | null;
  agentRunId?: string | null;
};

export type SaveDraftVersionInput = {
  draft: CurriculumDraft;
  validation: CurriculumValidationResult;
};

export type SaveDraftVersionResult =
  | { kind: "saved"; content: CurriculumVersionContentDto }
  | { kind: "not-found" }
  | { kind: "not-draft"; status: CurriculumVersionStatus };

export type PublishCurriculumVersionResult =
  | { kind: "published"; version: CurriculumVersionDto }
  | { kind: "not-found" }
  | { kind: "not-draft"; status: CurriculumVersionStatus };

// Cleaned source excerpts (spec §7.15). The embedding column is intentionally
// absent from the DTO: the MVP writes/reads keyword-searchable text only and
// leaves embedding null (Phase 6 may add vector recall).
export type CurriculumSourceChunkDto = {
  id: string;
  sourceId: string;
  chunkIndex: number;
  excerpt: string;
  tokenCount: number;
  contentHash: string;
  createdAt: string;
};

export type SourceChunkWriteInput = {
  chunkIndex: number;
  excerpt: string;
  tokenCount: number;
  contentHash: string;
};

export type CurriculumRepository = {
  backend: CurriculumBackend;
  createCurriculum: (
    ownerId: string,
    input: CreateCurriculumInput,
  ) => Promise<CurriculumDto>;
  listCurricula: (ownerId: string) => Promise<CurriculumDto[]>;
  getCurriculum: (
    ownerId: string,
    curriculumId: string,
  ) => Promise<CurriculumDto | null>;
  getCurriculumOverview: (
    ownerId: string,
    curriculumId: string,
  ) => Promise<CurriculumOverviewDto | null>;
  updateCurriculum: (
    ownerId: string,
    curriculumId: string,
    patch: UpdateCurriculumPatch,
  ) => Promise<CurriculumDto | null>;
  archiveCurriculum: (
    ownerId: string,
    curriculumId: string,
  ) => Promise<CurriculumDto | null>;
  createDraftVersion: (
    ownerId: string,
    curriculumId: string,
    input: CreateDraftVersionInput,
  ) => Promise<CurriculumVersionContentDto | null>;
  listVersions: (
    ownerId: string,
    curriculumId: string,
  ) => Promise<CurriculumVersionDto[] | null>;
  getVersionWithContent: (
    ownerId: string,
    curriculumId: string,
    versionId: string,
  ) => Promise<CurriculumVersionContentDto | null>;
  // Server-only read used by learning. The learning domain never receives
  // arbitrary curriculum ids from a client without first checking an
  // enrollment, but it still needs to read a published/superseded version
  // without pretending the learner owns the curriculum.
  getVersionWithContentById: (
    curriculumId: string,
    versionId: string,
  ) => Promise<CurriculumVersionContentDto | null>;
  saveDraftVersion: (
    ownerId: string,
    curriculumId: string,
    versionId: string,
    input: SaveDraftVersionInput,
  ) => Promise<SaveDraftVersionResult>;
  publishVersion: (
    ownerId: string,
    curriculumId: string,
    versionId: string,
  ) => Promise<PublishCurriculumVersionResult>;
  // Replaces all chunks of one source with the given set (delete + insert).
  // Returns null when the source does not exist (Supabase enforces the same
  // boundary through the foreign key). Dedup on (source_id, chunk_index) is
  // guaranteed because the previous set is removed first; callers that want
  // no-op idempotency should compare content hashes via listSourceChunks
  // before writing (SourceContentService does exactly that).
  saveSourceChunks: (
    sourceId: string,
    chunks: SourceChunkWriteInput[],
    options?: { createdAt?: string },
  ) => Promise<CurriculumSourceChunkDto[] | null>;
  // Chunks of the given sources, ordered by (sourceId, chunkIndex).
  listSourceChunks: (sourceIds: string[]) => Promise<CurriculumSourceChunkDto[]>;
  // All chunks of every source attached to a version. Returns null when the
  // version does not exist or belongs to another owner (owner scoping is
  // resolved through version -> curriculum).
  listChunksForVersion: (
    ownerId: string,
    curriculumVersionId: string,
  ) => Promise<CurriculumSourceChunkDto[] | null>;
  // Same retrieval boundary after the learning service has already verified
  // an enrollment. The version id is still checked against the curriculum
  // source rows; no caller-supplied owner id is trusted for this path.
  listChunksForVersionById: (
    curriculumVersionId: string,
  ) => Promise<CurriculumSourceChunkDto[] | null>;
};

// ---------------------------------------------------------------------------
// Internal storage shapes. The file backend persists these verbatim; the
// Supabase backend normalizes its rows into the same shapes so DTO mapping
// and draft reassembly are shared.
// ---------------------------------------------------------------------------

type VersionRowSet = {
  version: CurriculumVersionRow;
  modules: CurriculumModuleRow[];
  nodes: CurriculumNodeRow[];
  edges: CurriculumEdgeRow[];
  sources: CurriculumSourceRow[];
  nodeSources: CurriculumNodeSourceRow[];
};

type StoredCurriculum = {
  curriculum: CurriculumRow;
  versions: VersionRowSet[];
};

type CurriculumDataFile = {
  version: 1;
  curricula: StoredCurriculum[];
  // Flat chunk table mirroring curriculum_source_chunks (keyed by source_id,
  // which is globally unique). Older data files without this key normalize
  // to an empty array.
  sourceChunks: CurriculumSourceChunkRow[];
};

function nowIso() {
  return new Date().toISOString();
}

function resolveCurriculumSubject(input: CreateCurriculumInput) {
  // The database requires a non-blank subject; when the caller omits it the
  // curriculum title is the least surprising stand-in.
  const subject = input.subject?.trim();
  return subject || input.title;
}

function requireMappedId(map: Map<string, string>, clientId: string, kind: string) {
  const id = map.get(clientId);
  if (!id) {
    throw new Error(`Curriculum draft references unknown ${kind} "${clientId}".`);
  }
  return id;
}

// Assigns server ids to every module/node/source and materializes the full
// row set for one version. Throws on dangling clientId references; drafts
// reaching persistence are pre-validated, so a dangling reference indicates
// data corruption rather than user error.
function buildVersionRows(
  curriculumId: string,
  versionNumber: number,
  input: CreateDraftVersionInput,
  timestamp: string,
  versionId = createId("cver"),
): VersionRowSet {
  const { draft } = input;
  const moduleIdByClientId = new Map<string, string>();
  const nodeIdByClientId = new Map<string, string>();
  const sourceIdByClientId = new Map<string, string>();

  for (const courseModule of draft.modules) {
    moduleIdByClientId.set(courseModule.clientId, createId("cmod"));
    for (const node of courseModule.nodes) {
      nodeIdByClientId.set(node.clientId, createId("cnode"));
    }
  }
  for (const source of draft.sources) {
    sourceIdByClientId.set(source.id, createId("csrc"));
  }

  const version: CurriculumVersionRow = {
    id: versionId,
    curriculum_id: curriculumId,
    agent_run_id: input.agentRunId ?? null,
    version_number: versionNumber,
    version_label: draft.versionLabel,
    status: "draft",
    audience: draft.audience,
    assumptions_json: draft.assumptions,
    exclusions_json: draft.exclusions,
    conflicts_json: draft.conflicts,
    estimated_weeks: draft.estimatedWeeks ?? null,
    estimated_hours: draft.estimatedHours ?? null,
    build_request_json: input.buildRequest ?? null,
    validation_json: input.validation,
    created_by: input.createdBy ?? null,
    created_at: timestamp,
    published_at: null,
  };

  const modules: CurriculumModuleRow[] = draft.modules.map((courseModule) => ({
    id: requireMappedId(moduleIdByClientId, courseModule.clientId, "module"),
    curriculum_version_id: versionId,
    title: courseModule.title,
    description: courseModule.description,
    order_index: courseModule.orderIndex,
    required: courseModule.required,
    created_at: timestamp,
  }));

  const nodes: CurriculumNodeRow[] = draft.modules.flatMap((courseModule) =>
    courseModule.nodes.map((node) => ({
      id: requireMappedId(nodeIdByClientId, node.clientId, "node"),
      curriculum_version_id: versionId,
      module_id: requireMappedId(moduleIdByClientId, courseModule.clientId, "module"),
      title: node.title,
      summary: node.summary,
      node_type: node.nodeType,
      importance: node.importance,
      difficulty: node.difficulty,
      estimated_minutes: node.estimatedMinutes,
      learning_objectives_json: node.learningObjectives,
      completion_criteria_json: node.completionCriteria,
      tags_json: node.tags,
      order_index: node.orderIndex,
      created_at: timestamp,
    })),
  );

  const edges: CurriculumEdgeRow[] = buildCurriculumEdges(draft).map((edge) => ({
    id: createId("cedge"),
    curriculum_version_id: versionId,
    from_node_id: requireMappedId(nodeIdByClientId, edge.fromClientId, "node"),
    to_node_id: requireMappedId(nodeIdByClientId, edge.toClientId, "node"),
    edge_type: edge.edgeType,
    created_at: timestamp,
  }));

  const sources: CurriculumSourceRow[] = draft.sources.map((source) => ({
    id: requireMappedId(sourceIdByClientId, source.id, "source"),
    curriculum_version_id: versionId,
    url: source.url,
    canonical_url: source.url,
    title: source.title,
    publisher: source.publisher ?? null,
    source_type: source.sourceType,
    retrieved_at: source.retrievedAt,
    published_at: null,
    quality_score: source.qualityScore,
    content_hash: null,
    metadata_json: source.notes ? { notes: source.notes } : {},
    created_at: timestamp,
  }));

  const nodeSources: CurriculumNodeSourceRow[] = [];
  const seenBindings = new Set<string>();
  for (const courseModule of draft.modules) {
    for (const node of courseModule.nodes) {
      const nodeId = requireMappedId(nodeIdByClientId, node.clientId, "node");
      for (const sourceClientId of node.sourceIds) {
        const sourceId = requireMappedId(sourceIdByClientId, sourceClientId, "source");
        const bindingKey = `${nodeId}|${sourceId}`;
        if (seenBindings.has(bindingKey)) continue;
        seenBindings.add(bindingKey);
        nodeSources.push({
          node_id: nodeId,
          source_id: sourceId,
          support_type: "supporting",
          note: null,
          created_at: timestamp,
        });
      }
    }
  }

  return { version, modules, nodes, edges, sources, nodeSources };
}

// ---------------------------------------------------------------------------
// Row -> DTO mapping and draft reassembly (shared by both backends).
// ---------------------------------------------------------------------------

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toConflicts(value: unknown): CurriculumConflict[] {
  return Array.isArray(value) ? (value as CurriculumConflict[]) : [];
}

function toBuildRequest(value: unknown): CurriculumBuildRequest | null {
  return value && typeof value === "object" ? (value as CurriculumBuildRequest) : null;
}

function toValidationResult(value: unknown): CurriculumValidationResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CurriculumValidationResult>;
  if (!Array.isArray(candidate.warnings)) return null;
  return candidate as CurriculumValidationResult;
}

function readSourceNotes(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const notes = (metadata as { notes?: unknown }).notes;
  return typeof notes === "string" && notes.trim() ? notes : undefined;
}

function toCurriculumDto(row: CurriculumRow): CurriculumDto {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    projectId: row.project_id,
    title: row.title,
    subject: row.subject,
    learningGoal: row.learning_goal,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersionDto(row: CurriculumVersionRow): CurriculumVersionDto {
  return {
    id: row.id,
    curriculumId: row.curriculum_id,
    versionNumber: row.version_number,
    versionLabel: row.version_label,
    status: row.status,
    audience: row.audience,
    assumptions: toStringArray(row.assumptions_json),
    exclusions: toStringArray(row.exclusions_json),
    conflicts: toConflicts(row.conflicts_json),
    estimatedWeeks: row.estimated_weeks,
    estimatedHours: row.estimated_hours,
    buildRequest: toBuildRequest(row.build_request_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function toSourceChunkDto(row: CurriculumSourceChunkRow): CurriculumSourceChunkDto {
  return {
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    excerpt: row.excerpt,
    tokenCount: row.token_count,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

function sortChunks(rows: CurriculumSourceChunkRow[]): CurriculumSourceChunkRow[] {
  return [...rows].sort(
    (left, right) =>
      left.source_id.localeCompare(right.source_id) || left.chunk_index - right.chunk_index,
  );
}

function assembleDraft(curriculum: CurriculumRow, rows: VersionRowSet): CurriculumDraft {
  const prerequisiteIdsByTarget = new Map<string, string[]>();
  for (const edge of rows.edges) {
    if (edge.edge_type !== "prerequisite") continue;
    const targets = prerequisiteIdsByTarget.get(edge.to_node_id) ?? [];
    targets.push(edge.from_node_id);
    prerequisiteIdsByTarget.set(edge.to_node_id, targets);
  }
  const sourceIdsByNode = new Map<string, string[]>();
  for (const binding of rows.nodeSources) {
    const sourceIds = sourceIdsByNode.get(binding.node_id) ?? [];
    sourceIds.push(binding.source_id);
    sourceIdsByNode.set(binding.node_id, sourceIds);
  }

  const validation = toValidationResult(rows.version.validation_json);

  return {
    title: curriculum.title,
    subject: curriculum.subject,
    versionLabel: rows.version.version_label,
    audience: rows.version.audience,
    learningGoal: curriculum.learning_goal,
    estimatedWeeks: rows.version.estimated_weeks ?? undefined,
    estimatedHours: rows.version.estimated_hours ?? undefined,
    assumptions: toStringArray(rows.version.assumptions_json),
    exclusions: toStringArray(rows.version.exclusions_json),
    modules: [...rows.modules]
      .sort((left, right) => left.order_index - right.order_index)
      .map((moduleRow) => ({
        clientId: moduleRow.id,
        title: moduleRow.title,
        description: moduleRow.description,
        orderIndex: moduleRow.order_index,
        required: moduleRow.required,
        nodes: rows.nodes
          .filter((nodeRow) => nodeRow.module_id === moduleRow.id)
          .sort((left, right) => left.order_index - right.order_index)
          .map((nodeRow) => ({
            clientId: nodeRow.id,
            title: nodeRow.title,
            summary: nodeRow.summary,
            nodeType: nodeRow.node_type,
            importance: nodeRow.importance,
            difficulty: nodeRow.difficulty,
            estimatedMinutes: nodeRow.estimated_minutes,
            learningObjectives: toStringArray(nodeRow.learning_objectives_json),
            completionCriteria: toStringArray(nodeRow.completion_criteria_json),
            prerequisiteClientIds: [
              ...(prerequisiteIdsByTarget.get(nodeRow.id) ?? []),
            ].sort(),
            sourceIds: [...(sourceIdsByNode.get(nodeRow.id) ?? [])].sort(),
            tags: toStringArray(nodeRow.tags_json),
            orderIndex: nodeRow.order_index,
          })),
      })),
    edges: rows.edges
      .map((edge) => ({
        fromClientId: edge.from_node_id,
        toClientId: edge.to_node_id,
        edgeType: edge.edge_type,
      }))
      .sort(
        (left, right) =>
          left.fromClientId.localeCompare(right.fromClientId) ||
          left.toClientId.localeCompare(right.toClientId) ||
          left.edgeType.localeCompare(right.edgeType),
      ),
    sources: rows.sources.map((sourceRow) => ({
      id: sourceRow.id,
      url: sourceRow.url,
      title: sourceRow.title,
      publisher: sourceRow.publisher ?? undefined,
      sourceType: sourceRow.source_type,
      retrievedAt: sourceRow.retrieved_at,
      qualityScore: sourceRow.quality_score,
      notes: readSourceNotes(sourceRow.metadata_json),
    })),
    conflicts: toConflicts(rows.version.conflicts_json),
    validation: {
      coverageScore: validation?.coverageScore ?? 0,
      sequenceScore: validation?.sequenceScore ?? 0,
      prerequisiteScore: validation?.prerequisiteScore ?? 0,
      sourceQualityScore: validation?.sourceQualityScore ?? 0,
      difficultyFitScore: validation?.difficultyFitScore ?? 0,
      warnings: validation?.warnings ?? [],
    },
  };
}

function assembleVersionContent(
  curriculum: CurriculumRow,
  rows: VersionRowSet,
): CurriculumVersionContentDto {
  return {
    version: toVersionDto(rows.version),
    draft: assembleDraft(curriculum, rows),
    validation: rows.version.validation_json,
  };
}

// ---------------------------------------------------------------------------
// File backend.
// ---------------------------------------------------------------------------

const DATA_FILE_NAME = "branchmind-curriculum.json";
let writeQueue: Promise<unknown> = Promise.resolve();

function getDataFilePath() {
  const override = process.env.BRANCHMIND_CURRICULUM_DATA_DIR?.trim();
  return path.join(override || path.join(process.cwd(), "data"), DATA_FILE_NAME);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeVersionRowSet(value: unknown): VersionRowSet {
  const entry = (value ?? {}) as Partial<VersionRowSet>;
  return {
    version: entry.version as CurriculumVersionRow,
    modules: Array.isArray(entry.modules) ? entry.modules : [],
    nodes: Array.isArray(entry.nodes) ? entry.nodes : [],
    edges: Array.isArray(entry.edges) ? entry.edges : [],
    sources: Array.isArray(entry.sources) ? entry.sources : [],
    nodeSources: Array.isArray(entry.nodeSources) ? entry.nodeSources : [],
  };
}

function normalizeDataFile(value: unknown): CurriculumDataFile {
  if (
    value &&
    typeof value === "object" &&
    "curricula" in value &&
    Array.isArray((value as { curricula: unknown }).curricula)
  ) {
    const record = value as {
      curricula: StoredCurriculum[];
      sourceChunks?: unknown;
    };
    return {
      version: 1,
      curricula: record.curricula.map((entry) => ({
        curriculum: entry.curriculum,
        versions: Array.isArray(entry.versions)
          ? entry.versions.map(normalizeVersionRowSet)
          : [],
      })),
      sourceChunks: Array.isArray(record.sourceChunks) ? record.sourceChunks : [],
    };
  }

  return { version: 1, curricula: [], sourceChunks: [] };
}

async function readCurriculaData(): Promise<CurriculumDataFile> {
  try {
    const content = await readFile(getDataFilePath(), "utf8");
    return normalizeDataFile(JSON.parse(content));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, curricula: [], sourceChunks: [] };
    }
    throw error;
  }
}

async function writeCurriculaDataNow(data: CurriculumDataFile) {
  const dataFile = getDataFilePath();
  await mkdir(path.dirname(dataFile), { recursive: true });

  const tempFile = `${dataFile}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempFile, dataFile);
}

function enqueueCurriculumWrite<T>(operation: () => Promise<T>) {
  const nextWrite = writeQueue.then(operation, operation);
  writeQueue = nextWrite.catch(() => undefined);
  return nextWrite;
}

// Serialized read-modify-write. The mutator computes the full next state (or
// throws); the file is only written when it succeeds, so any failure leaves
// the on-disk state untouched — the file backend's transaction semantics.
async function mutateCurriculaData<T>(
  mutator: (data: CurriculumDataFile) => T | Promise<T>,
): Promise<T> {
  return enqueueCurriculumWrite(async () => {
    const data = await readCurriculaData();
    const result = await mutator(data);
    await writeCurriculaDataNow(data);
    return result;
  });
}

function findStoredCurriculum(
  data: CurriculumDataFile,
  ownerId: string,
  curriculumId: string,
) {
  return (
    data.curricula.find(
      (entry) =>
        entry.curriculum.id === curriculumId && entry.curriculum.owner_user_id === ownerId,
    ) ?? null
  );
}

const fileRepository: CurriculumRepository = {
  backend: "file",

  createCurriculum: async (ownerId, input) => {
    return mutateCurriculaData((data) => {
      const timestamp = nowIso();
      const row: CurriculumRow = {
        id: createId("curriculum"),
        owner_user_id: ownerId,
        project_id: input.projectId ?? null,
        title: input.title,
        subject: resolveCurriculumSubject(input),
        learning_goal: input.learningGoal,
        status: "draft",
        created_at: timestamp,
        updated_at: timestamp,
      };
      data.curricula.push({ curriculum: row, versions: [] });
      return toCurriculumDto(row);
    });
  },

  listCurricula: async (ownerId) => {
    const data = await readCurriculaData();
    return data.curricula
      .filter((entry) => entry.curriculum.owner_user_id === ownerId)
      .map((entry) => entry.curriculum)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map(toCurriculumDto);
  },

  getCurriculum: async (ownerId, curriculumId) => {
    const data = await readCurriculaData();
    const stored = findStoredCurriculum(data, ownerId, curriculumId);
    return stored ? toCurriculumDto(stored.curriculum) : null;
  },

  getCurriculumOverview: async (ownerId, curriculumId) => {
    const data = await readCurriculaData();
    const stored = findStoredCurriculum(data, ownerId, curriculumId);
    if (!stored) return null;

    const versionRows = [...stored.versions].sort(
      (left, right) => right.version.version_number - left.version.version_number,
    );
    return {
      curriculum: toCurriculumDto(stored.curriculum),
      versions: versionRows.map((entry) => toVersionDto(entry.version)),
      defaultVersion: versionRows[0]
        ? assembleVersionContent(stored.curriculum, versionRows[0])
        : null,
    };
  },

  updateCurriculum: async (ownerId, curriculumId, patch) => {
    return mutateCurriculaData((data) => {
      const stored = findStoredCurriculum(data, ownerId, curriculumId);
      if (!stored) return null;

      if (typeof patch.title === "string") stored.curriculum.title = patch.title;
      if (typeof patch.learningGoal === "string") {
        stored.curriculum.learning_goal = patch.learningGoal;
      }
      stored.curriculum.updated_at = nowIso();
      return toCurriculumDto(stored.curriculum);
    });
  },

  archiveCurriculum: async (ownerId, curriculumId) => {
    return mutateCurriculaData((data) => {
      const stored = findStoredCurriculum(data, ownerId, curriculumId);
      if (!stored) return null;

      if (stored.curriculum.status !== "archived") {
        stored.curriculum.status = "archived";
        stored.curriculum.updated_at = nowIso();
      }
      return toCurriculumDto(stored.curriculum);
    });
  },

  createDraftVersion: async (ownerId, curriculumId, input) => {
    return mutateCurriculaData((data) => {
      const stored = findStoredCurriculum(data, ownerId, curriculumId);
      if (!stored) return null;
      if (input.agentRunId) {
        const existing = stored.versions.find(
          (entry) => entry.version.agent_run_id === input.agentRunId,
        );
        if (existing) return assembleVersionContent(stored.curriculum, existing);
      }

      // Allocated inside the write queue, so concurrent creations serialize
      // and can never produce duplicate numbers (spec §7.2).
      const versionNumber =
        stored.versions.reduce(
          (max, entry) => Math.max(max, entry.version.version_number),
          0,
        ) + 1;
      const rows = buildVersionRows(curriculumId, versionNumber, input, nowIso());
      stored.versions.push(rows);
      return assembleVersionContent(stored.curriculum, rows);
    });
  },

  listVersions: async (ownerId, curriculumId) => {
    const data = await readCurriculaData();
    const stored = findStoredCurriculum(data, ownerId, curriculumId);
    if (!stored) return null;

    return stored.versions
      .map((entry) => entry.version)
      .sort((left, right) => right.version_number - left.version_number)
      .map(toVersionDto);
  },

  getVersionWithContent: async (ownerId, curriculumId, versionId) => {
    const data = await readCurriculaData();
    const stored = findStoredCurriculum(data, ownerId, curriculumId);
    const rows = stored?.versions.find((entry) => entry.version.id === versionId);
    if (!stored || !rows) return null;

    return assembleVersionContent(stored.curriculum, rows);
  },

  getVersionWithContentById: async (curriculumId, versionId) => {
    const data = await readCurriculaData();
    const stored = data.curricula.find((entry) => entry.curriculum.id === curriculumId);
    const rows = stored?.versions.find((entry) => entry.version.id === versionId);
    if (!stored || !rows) return null;
    return assembleVersionContent(stored.curriculum, rows);
  },

  saveDraftVersion: async (ownerId, curriculumId, versionId, input) => {
    return mutateCurriculaData((data): SaveDraftVersionResult => {
      const stored = findStoredCurriculum(data, ownerId, curriculumId);
      const index = stored?.versions.findIndex((entry) => entry.version.id === versionId) ?? -1;
      if (!stored || index < 0) return { kind: "not-found" };

      const previous = stored.versions[index];
      if (previous.version.status !== "draft") {
        return { kind: "not-draft", status: previous.version.status };
      }

      const timestamp = nowIso();
      const next = buildVersionRows(
        curriculumId,
        previous.version.version_number,
        {
          draft: input.draft,
          validation: input.validation,
          agentRunId: previous.version.agent_run_id,
        },
        timestamp,
        previous.version.id,
      );
      next.version.created_at = previous.version.created_at;
      next.version.created_by = previous.version.created_by;
      next.version.build_request_json = previous.version.build_request_json;

      const oldSourceIds = new Set(previous.sources.map((source) => source.id));
      data.sourceChunks = data.sourceChunks.filter((chunk) => !oldSourceIds.has(chunk.source_id));
      stored.versions[index] = next;
      stored.curriculum.updated_at = timestamp;
      return { kind: "saved", content: assembleVersionContent(stored.curriculum, next) };
    });
  },

  publishVersion: async (ownerId, curriculumId, versionId) => {
    return mutateCurriculaData((data): PublishCurriculumVersionResult => {
      const stored = findStoredCurriculum(data, ownerId, curriculumId);
      const rows = stored?.versions.find((entry) => entry.version.id === versionId);
      if (!stored || !rows) return { kind: "not-found" };
      if (rows.version.status !== "draft") {
        return { kind: "not-draft", status: rows.version.status };
      }

      // Same transition sequence as the publish_curriculum_version RPC
      // (spec §7.2): supersede the old published version, publish the target,
      // activate a still-draft curriculum. Any throw above the write aborts
      // the whole mutation — nothing partial reaches disk.
      const timestamp = nowIso();
      for (const entry of stored.versions) {
        if (entry.version.status === "published") {
          entry.version.status = "superseded";
        }
      }
      rows.version.status = "published";
      rows.version.published_at = timestamp;
      if (stored.curriculum.status === "draft") {
        stored.curriculum.status = "active";
        stored.curriculum.updated_at = timestamp;
      }
      return { kind: "published", version: toVersionDto(rows.version) };
    });
  },

  saveSourceChunks: async (sourceId, chunks, options) => {
    return mutateCurriculaData((data) => {
      const sourceExists = data.curricula.some((entry) =>
        entry.versions.some((version) =>
          version.sources.some((source) => source.id === sourceId),
        ),
      );
      if (!sourceExists) return null;

      const timestamp = options?.createdAt ?? nowIso();
      data.sourceChunks = data.sourceChunks.filter(
        (chunk) => chunk.source_id !== sourceId,
      );
      const rows: CurriculumSourceChunkRow[] = chunks.map((chunk) => ({
        id: createId("cchunk"),
        source_id: sourceId,
        chunk_index: chunk.chunkIndex,
        excerpt: chunk.excerpt,
        embedding: null,
        token_count: chunk.tokenCount,
        content_hash: chunk.contentHash,
        created_at: timestamp,
      }));
      data.sourceChunks.push(...rows);
      return sortChunks(rows).map(toSourceChunkDto);
    });
  },

  listSourceChunks: async (sourceIds) => {
    const data = await readCurriculaData();
    const wanted = new Set(sourceIds);
    return sortChunks(
      data.sourceChunks.filter((chunk) => wanted.has(chunk.source_id)),
    ).map(toSourceChunkDto);
  },

  listChunksForVersion: async (ownerId, curriculumVersionId) => {
    const data = await readCurriculaData();
    const stored = data.curricula.find(
      (entry) =>
        entry.curriculum.owner_user_id === ownerId &&
        entry.versions.some((version) => version.version.id === curriculumVersionId),
    );
    const version = stored?.versions.find(
      (entry) => entry.version.id === curriculumVersionId,
    );
    if (!stored || !version) return null;

    const sourceIds = new Set(version.sources.map((source) => source.id));
    return sortChunks(
      data.sourceChunks.filter((chunk) => sourceIds.has(chunk.source_id)),
    ).map(toSourceChunkDto);
  },

  listChunksForVersionById: async (curriculumVersionId) => {
    const data = await readCurriculaData();
    const version = data.curricula
      .flatMap((entry) => entry.versions)
      .find((entry) => entry.version.id === curriculumVersionId);
    if (!version) return null;

    const sourceIds = new Set(version.sources.map((source) => source.id));
    return sortChunks(
      data.sourceChunks.filter((chunk) => sourceIds.has(chunk.source_id)),
    ).map(toSourceChunkDto);
  },
};

// ---------------------------------------------------------------------------
// Supabase backend.
// ---------------------------------------------------------------------------

type DbCurriculumRow = Database["public"]["Tables"]["curricula"]["Row"];
type DbCurriculumInsert = Database["public"]["Tables"]["curricula"]["Insert"];
type DbVersionRow = Database["public"]["Tables"]["curriculum_versions"]["Row"];
type DbVersionInsert = Database["public"]["Tables"]["curriculum_versions"]["Insert"];
type DbModuleRow = Database["public"]["Tables"]["curriculum_modules"]["Row"];
type DbModuleInsert = Database["public"]["Tables"]["curriculum_modules"]["Insert"];
type DbNodeRow = Database["public"]["Tables"]["curriculum_nodes"]["Row"];
type DbNodeInsert = Database["public"]["Tables"]["curriculum_nodes"]["Insert"];
type DbEdgeRow = Database["public"]["Tables"]["curriculum_edges"]["Row"];
type DbEdgeInsert = Database["public"]["Tables"]["curriculum_edges"]["Insert"];
type DbSourceRow = Database["public"]["Tables"]["curriculum_sources"]["Row"];
type DbSourceInsert = Database["public"]["Tables"]["curriculum_sources"]["Insert"];
type DbNodeSourceRow = Database["public"]["Tables"]["curriculum_node_sources"]["Row"];
type DbNodeSourceInsert = Database["public"]["Tables"]["curriculum_node_sources"]["Insert"];
type DbSourceChunkRow = Database["public"]["Tables"]["curriculum_source_chunks"]["Row"];
type DbSourceChunkInsert = Database["public"]["Tables"]["curriculum_source_chunks"]["Insert"];

function assertNoError(error: { message: string } | null, operation: string) {
  if (!error) return;
  throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

// PostgREST renders timestamptz in its own ISO variant ("…+00:00"); normalize
// to the canonical JS ISO format (same convention as projects-repository).
function normalizeRowTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

function toJson(value: unknown): Json {
  return value as Json;
}

function fromDbCurriculumRow(row: DbCurriculumRow): CurriculumRow {
  return {
    ...row,
    created_at: normalizeRowTimestamp(row.created_at),
    updated_at: normalizeRowTimestamp(row.updated_at),
  };
}

function fromDbVersionRow(row: DbVersionRow): CurriculumVersionRow {
  return {
    ...row,
    assumptions_json: toStringArray(row.assumptions_json),
    exclusions_json: toStringArray(row.exclusions_json),
    conflicts_json: toConflicts(row.conflicts_json),
    build_request_json: toBuildRequest(row.build_request_json),
    created_at: normalizeRowTimestamp(row.created_at),
    published_at: row.published_at ? normalizeRowTimestamp(row.published_at) : null,
  };
}

function fromDbModuleRow(row: DbModuleRow): CurriculumModuleRow {
  return { ...row, created_at: normalizeRowTimestamp(row.created_at) };
}

function fromDbNodeRow(row: DbNodeRow): CurriculumNodeRow {
  return {
    ...row,
    learning_objectives_json: toStringArray(row.learning_objectives_json),
    completion_criteria_json: toStringArray(row.completion_criteria_json),
    tags_json: toStringArray(row.tags_json),
    created_at: normalizeRowTimestamp(row.created_at),
  };
}

function fromDbEdgeRow(row: DbEdgeRow): CurriculumEdgeRow {
  return { ...row, created_at: normalizeRowTimestamp(row.created_at) };
}

function fromDbSourceRow(row: DbSourceRow): CurriculumSourceRow {
  return {
    ...row,
    retrieved_at: normalizeRowTimestamp(row.retrieved_at),
    published_at: row.published_at ? normalizeRowTimestamp(row.published_at) : null,
    metadata_json:
      row.metadata_json && typeof row.metadata_json === "object"
        ? (row.metadata_json as Record<string, unknown>)
        : {},
    created_at: normalizeRowTimestamp(row.created_at),
  };
}

function fromDbNodeSourceRow(row: DbNodeSourceRow): CurriculumNodeSourceRow {
  return { ...row, created_at: normalizeRowTimestamp(row.created_at) };
}

function fromDbSourceChunkRow(row: DbSourceChunkRow): CurriculumSourceChunkRow {
  return { ...row, created_at: normalizeRowTimestamp(row.created_at) };
}

function toVersionInsert(row: CurriculumVersionRow): DbVersionInsert {
  return {
    ...row,
    assumptions_json: toJson(row.assumptions_json),
    exclusions_json: toJson(row.exclusions_json),
    conflicts_json: toJson(row.conflicts_json),
    build_request_json: toJson(row.build_request_json),
    validation_json: toJson(row.validation_json),
  };
}

function toModuleInsert(row: CurriculumModuleRow): DbModuleInsert {
  return { ...row };
}

function toNodeInsert(row: CurriculumNodeRow): DbNodeInsert {
  return {
    ...row,
    learning_objectives_json: toJson(row.learning_objectives_json),
    completion_criteria_json: toJson(row.completion_criteria_json),
    tags_json: toJson(row.tags_json),
  };
}

function toEdgeInsert(row: CurriculumEdgeRow): DbEdgeInsert {
  return { ...row };
}

function toSourceInsert(row: CurriculumSourceRow): DbSourceInsert {
  return { ...row, metadata_json: toJson(row.metadata_json) };
}

function toNodeSourceInsert(row: CurriculumNodeSourceRow): DbNodeSourceInsert {
  return { ...row };
}

class SupabaseCurriculumRepository implements CurriculumRepository {
  backend: CurriculumBackend = "supabase";

  private async getOwnedCurriculumRow(ownerId: string, curriculumId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("curricula")
      .select("*")
      .eq("id", curriculumId)
      .eq("owner_user_id", ownerId)
      .maybeSingle();
    assertNoError(error, "read curriculum");
    return data ? fromDbCurriculumRow(data) : null;
  }

  private async getVersionRow(curriculumId: string, versionId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("curriculum_versions")
      .select("*")
      .eq("id", versionId)
      .eq("curriculum_id", curriculumId)
      .maybeSingle();
    assertNoError(error, "read curriculum version");
    return data ? fromDbVersionRow(data) : null;
  }

  async createCurriculum(ownerId: string, input: CreateCurriculumInput) {
    const timestamp = nowIso();
    const row: DbCurriculumInsert = {
      id: createId("curriculum"),
      owner_user_id: ownerId,
      project_id: input.projectId ?? null,
      title: input.title,
      subject: resolveCurriculumSubject(input),
      learning_goal: input.learningGoal,
      status: "draft",
      created_at: timestamp,
      updated_at: timestamp,
    };
    const { data, error } = await getSupabaseAdminClient()
      .from("curricula")
      .insert(row)
      .select()
      .single();
    assertNoError(error, "create curriculum");
    if (!data) throw new Error("Supabase create curriculum failed: no row returned.");
    return toCurriculumDto(fromDbCurriculumRow(data));
  }

  async listCurricula(ownerId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("curricula")
      .select("*")
      .eq("owner_user_id", ownerId)
      .order("updated_at", { ascending: false });
    assertNoError(error, "list curricula");
    return (data ?? []).map((row) => toCurriculumDto(fromDbCurriculumRow(row)));
  }

  async getCurriculum(ownerId: string, curriculumId: string) {
    const row = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    return row ? toCurriculumDto(row) : null;
  }

  async getCurriculumOverview(ownerId: string, curriculumId: string) {
    const curriculum = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    if (!curriculum) return null;

    const { data, error } = await getSupabaseAdminClient()
      .from("curriculum_versions")
      .select("*")
      .eq("curriculum_id", curriculumId)
      .order("version_number", { ascending: false });
    assertNoError(error, "list curriculum versions for overview");

    const versions = (data ?? []).map((row) => fromDbVersionRow(row));
    const defaultVersion = versions[0]
      ? await this.getVersionWithContent(ownerId, curriculumId, versions[0].id)
      : null;

    return {
      curriculum: toCurriculumDto(curriculum),
      versions: versions.map(toVersionDto),
      defaultVersion,
    };
  }

  async updateCurriculum(ownerId: string, curriculumId: string, patch: UpdateCurriculumPatch) {
    const { data, error } = await getSupabaseAdminClient()
      .from("curricula")
      .update({
        ...(typeof patch.title === "string" ? { title: patch.title } : {}),
        ...(typeof patch.learningGoal === "string"
          ? { learning_goal: patch.learningGoal }
          : {}),
        updated_at: nowIso(),
      })
      .eq("id", curriculumId)
      .eq("owner_user_id", ownerId)
      .select()
      .maybeSingle();
    assertNoError(error, "update curriculum");
    return data ? toCurriculumDto(fromDbCurriculumRow(data)) : null;
  }

  async archiveCurriculum(ownerId: string, curriculumId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("curricula")
      .update({ status: "archived", updated_at: nowIso() })
      .eq("id", curriculumId)
      .eq("owner_user_id", ownerId)
      .select()
      .maybeSingle();
    assertNoError(error, "archive curriculum");
    return data ? toCurriculumDto(fromDbCurriculumRow(data)) : null;
  }

  async createDraftVersion(
    ownerId: string,
    curriculumId: string,
    input: CreateDraftVersionInput,
  ) {
    const curriculum = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    if (!curriculum) return null;

    const client = getSupabaseAdminClient();
    if (input.agentRunId) {
      const existing = await client
        .from("curriculum_versions")
        .select("id")
        .eq("curriculum_id", curriculumId)
        .eq("agent_run_id", input.agentRunId)
        .maybeSingle();
      assertNoError(existing.error, "read idempotent curriculum draft");
      if (existing.data) {
        return this.getVersionWithContent(ownerId, curriculumId, existing.data.id);
      }
    }
    const { data: versionNumber, error: allocateError } = await client.rpc(
      "allocate_curriculum_version_number",
      { p_curriculum_id: curriculumId },
    );
    assertNoError(allocateError, "allocate curriculum version number");
    if (typeof versionNumber !== "number") {
      throw new Error("Supabase allocate curriculum version number failed: no number returned.");
    }

    const rows = buildVersionRows(curriculumId, versionNumber, input, nowIso());

    // PostgREST cannot wrap multi-table inserts in one transaction; on any
    // failure the version row is deleted (children cascade) so a half-written
    // version graph never survives.
    try {
      const insertVersion = await client
        .from("curriculum_versions")
        .insert(toVersionInsert(rows.version));
      if (insertVersion.error?.code === "23505" && input.agentRunId) {
        const existing = await client
          .from("curriculum_versions")
          .select("id")
          .eq("curriculum_id", curriculumId)
          .eq("agent_run_id", input.agentRunId)
          .maybeSingle();
        assertNoError(existing.error, "read raced idempotent curriculum draft");
        if (existing.data) {
          return this.getVersionWithContent(ownerId, curriculumId, existing.data.id);
        }
      }
      assertNoError(insertVersion.error, "insert curriculum version");

      if (rows.modules.length > 0) {
        const insertModules = await client
          .from("curriculum_modules")
          .insert(rows.modules.map(toModuleInsert));
        assertNoError(insertModules.error, "insert curriculum modules");
      }
      if (rows.nodes.length > 0) {
        const insertNodes = await client
          .from("curriculum_nodes")
          .insert(rows.nodes.map(toNodeInsert));
        assertNoError(insertNodes.error, "insert curriculum nodes");
      }
      if (rows.sources.length > 0) {
        const insertSources = await client
          .from("curriculum_sources")
          .insert(rows.sources.map(toSourceInsert));
        assertNoError(insertSources.error, "insert curriculum sources");
      }
      if (rows.edges.length > 0) {
        const insertEdges = await client
          .from("curriculum_edges")
          .insert(rows.edges.map(toEdgeInsert));
        assertNoError(insertEdges.error, "insert curriculum edges");
      }
      if (rows.nodeSources.length > 0) {
        const insertNodeSources = await client
          .from("curriculum_node_sources")
          .insert(rows.nodeSources.map(toNodeSourceInsert));
        assertNoError(insertNodeSources.error, "insert curriculum node sources");
      }
    } catch (error) {
      const cleanup = await client
        .from("curriculum_versions")
        .delete()
        .eq("id", rows.version.id);
      if (cleanup.error) {
        console.error("BranchMind curriculum version cleanup failed", {
          versionId: rows.version.id,
          message: cleanup.error.message,
        });
      }
      throw error;
    }

    return assembleVersionContent(curriculum, rows);
  }

  async listVersions(ownerId: string, curriculumId: string) {
    const curriculum = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    if (!curriculum) return null;

    const { data, error } = await getSupabaseAdminClient()
      .from("curriculum_versions")
      .select("*")
      .eq("curriculum_id", curriculumId)
      .order("version_number", { ascending: false });
    assertNoError(error, "list curriculum versions");
    return (data ?? []).map((row) => toVersionDto(fromDbVersionRow(row)));
  }

  async getVersionWithContent(ownerId: string, curriculumId: string, versionId: string) {
    const curriculum = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    if (!curriculum) return null;
    const version = await this.getVersionRow(curriculumId, versionId);
    if (!version) return null;

    const client = getSupabaseAdminClient();
    const [modulesResult, nodesResult, edgesResult, sourcesResult] = await Promise.all([
      client
        .from("curriculum_modules")
        .select("*")
        .eq("curriculum_version_id", versionId)
        .order("order_index"),
      client.from("curriculum_nodes").select("*").eq("curriculum_version_id", versionId),
      client.from("curriculum_edges").select("*").eq("curriculum_version_id", versionId),
      client.from("curriculum_sources").select("*").eq("curriculum_version_id", versionId),
    ]);
    assertNoError(modulesResult.error, "read curriculum modules");
    assertNoError(nodesResult.error, "read curriculum nodes");
    assertNoError(edgesResult.error, "read curriculum edges");
    assertNoError(sourcesResult.error, "read curriculum sources");

    const nodeIds = (nodesResult.data ?? []).map((row) => row.id);
    const nodeSourcesResult = nodeIds.length
      ? await client.from("curriculum_node_sources").select("*").in("node_id", nodeIds)
      : { data: [], error: null };
    assertNoError(nodeSourcesResult.error, "read curriculum node sources");

    const rows: VersionRowSet = {
      version,
      modules: (modulesResult.data ?? []).map(fromDbModuleRow),
      nodes: (nodesResult.data ?? []).map(fromDbNodeRow),
      edges: (edgesResult.data ?? []).map(fromDbEdgeRow),
      sources: (sourcesResult.data ?? []).map(fromDbSourceRow),
      nodeSources: (nodeSourcesResult.data ?? []).map(fromDbNodeSourceRow),
    };
    return assembleVersionContent(curriculum, rows);
  }

  async getVersionWithContentById(curriculumId: string, versionId: string) {
    const client = getSupabaseAdminClient();
    const [curriculumResult, versionResult] = await Promise.all([
      client.from("curricula").select("*").eq("id", curriculumId).maybeSingle(),
      client
        .from("curriculum_versions")
        .select("*")
        .eq("id", versionId)
        .eq("curriculum_id", curriculumId)
        .maybeSingle(),
    ]);
    assertNoError(curriculumResult.error, "read curriculum for learning");
    assertNoError(versionResult.error, "read curriculum version for learning");
    if (!curriculumResult.data || !versionResult.data) return null;

    const curriculum = fromDbCurriculumRow(curriculumResult.data);
    const version = fromDbVersionRow(versionResult.data);
    const [modulesResult, nodesResult, edgesResult, sourcesResult] = await Promise.all([
      client
        .from("curriculum_modules")
        .select("*")
        .eq("curriculum_version_id", versionId)
        .order("order_index"),
      client.from("curriculum_nodes").select("*").eq("curriculum_version_id", versionId),
      client.from("curriculum_edges").select("*").eq("curriculum_version_id", versionId),
      client.from("curriculum_sources").select("*").eq("curriculum_version_id", versionId),
    ]);
    assertNoError(modulesResult.error, "read learning curriculum modules");
    assertNoError(nodesResult.error, "read learning curriculum nodes");
    assertNoError(edgesResult.error, "read learning curriculum edges");
    assertNoError(sourcesResult.error, "read learning curriculum sources");

    const nodeIds = (nodesResult.data ?? []).map((row) => row.id);
    const nodeSourcesResult = nodeIds.length
      ? await client.from("curriculum_node_sources").select("*").in("node_id", nodeIds)
      : { data: [], error: null };
    assertNoError(nodeSourcesResult.error, "read learning curriculum source bindings");

    return assembleVersionContent(curriculum, {
      version,
      modules: (modulesResult.data ?? []).map(fromDbModuleRow),
      nodes: (nodesResult.data ?? []).map(fromDbNodeRow),
      edges: (edgesResult.data ?? []).map(fromDbEdgeRow),
      sources: (sourcesResult.data ?? []).map(fromDbSourceRow),
      nodeSources: (nodeSourcesResult.data ?? []).map(fromDbNodeSourceRow),
    });
  }

  async saveDraftVersion(
    ownerId: string,
    curriculumId: string,
    versionId: string,
    input: SaveDraftVersionInput,
  ): Promise<SaveDraftVersionResult> {
    const curriculum = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    if (!curriculum) return { kind: "not-found" };
    const previous = await this.getVersionRow(curriculumId, versionId);
    if (!previous) return { kind: "not-found" };
    if (previous.status !== "draft") return { kind: "not-draft", status: previous.status };

    const rows = buildVersionRows(
      curriculumId,
      previous.version_number,
      {
        draft: input.draft,
        validation: input.validation,
        buildRequest: toBuildRequest(previous.build_request_json),
        createdBy: previous.created_by,
        agentRunId: previous.agent_run_id,
      },
      nowIso(),
      versionId,
    );
    rows.version.created_at = previous.created_at;

    const client = getSupabaseAdminClient();
    const { data: oldNodes, error: oldNodesError } = await client
      .from("curriculum_nodes")
      .select("id")
      .eq("curriculum_version_id", versionId);
    assertNoError(oldNodesError, "read draft nodes before update");
    const oldNodeIds = (oldNodes ?? []).map((row) => row.id);

    const updateVersion = await client
      .from("curriculum_versions")
      .update({
        version_label: rows.version.version_label,
        audience: rows.version.audience,
        assumptions_json: toJson(rows.version.assumptions_json),
        exclusions_json: toJson(rows.version.exclusions_json),
        conflicts_json: toJson(rows.version.conflicts_json),
        estimated_weeks: rows.version.estimated_weeks,
        estimated_hours: rows.version.estimated_hours,
        validation_json: toJson(rows.version.validation_json),
      })
      .eq("id", versionId)
      .eq("curriculum_id", curriculumId)
      .eq("status", "draft");
    assertNoError(updateVersion.error, "update curriculum draft version");

    if (oldNodeIds.length > 0) {
      const deleteBindings = await client
        .from("curriculum_node_sources")
        .delete()
        .in("node_id", oldNodeIds);
      assertNoError(deleteBindings.error, "delete old curriculum source bindings");
    }
    for (const [table, label] of [
      ["curriculum_edges", "delete old curriculum edges"],
      ["curriculum_nodes", "delete old curriculum nodes"],
      ["curriculum_modules", "delete old curriculum modules"],
      ["curriculum_sources", "delete old curriculum sources"],
    ] as const) {
      const result = await client.from(table).delete().eq("curriculum_version_id", versionId);
      assertNoError(result.error, label);
    }

    if (rows.modules.length > 0) {
      const result = await client.from("curriculum_modules").insert(rows.modules.map(toModuleInsert));
      assertNoError(result.error, "insert curriculum modules");
    }
    if (rows.nodes.length > 0) {
      const result = await client.from("curriculum_nodes").insert(rows.nodes.map(toNodeInsert));
      assertNoError(result.error, "insert curriculum nodes");
    }
    if (rows.edges.length > 0) {
      const result = await client.from("curriculum_edges").insert(rows.edges.map(toEdgeInsert));
      assertNoError(result.error, "insert curriculum edges");
    }
    if (rows.sources.length > 0) {
      const result = await client.from("curriculum_sources").insert(rows.sources.map(toSourceInsert));
      assertNoError(result.error, "insert curriculum sources");
    }
    if (rows.nodeSources.length > 0) {
      const result = await client
        .from("curriculum_node_sources")
        .insert(rows.nodeSources.map(toNodeSourceInsert));
      assertNoError(result.error, "insert curriculum source bindings");
    }

    await client
      .from("curricula")
      .update({ updated_at: nowIso() })
      .eq("id", curriculumId)
      .eq("owner_user_id", ownerId);

    return { kind: "saved", content: assembleVersionContent(curriculum, rows) };
  }

  async publishVersion(ownerId: string, curriculumId: string, versionId: string) {
    const curriculum = await this.getOwnedCurriculumRow(ownerId, curriculumId);
    if (!curriculum) return { kind: "not-found" } as const;
    const version = await this.getVersionRow(curriculumId, versionId);
    if (!version) return { kind: "not-found" } as const;
    if (version.status !== "draft") {
      return { kind: "not-draft", status: version.status } as const;
    }

    // The RPC performs the supersede/publish/activate transition atomically
    // and re-checks the draft status under the curricula row lock (spec §7.2).
    const client = getSupabaseAdminClient();
    const { error } = await client.rpc("publish_curriculum_version", {
      p_curriculum_id: curriculumId,
      p_version_id: versionId,
    });
    if (error) {
      if (/not found/i.test(error.message)) return { kind: "not-found" } as const;
      const notDraft = /only draft versions can be published \(version .+ is (\w+)\)/i.exec(
        error.message,
      );
      if (notDraft) {
        return {
          kind: "not-draft",
          status: notDraft[1] as CurriculumVersionStatus,
        } as const;
      }
      assertNoError(error, "publish curriculum version");
    }

    const published = await this.getVersionRow(curriculumId, versionId);
    if (!published) return { kind: "not-found" } as const;
    return { kind: "published", version: toVersionDto(published) } as const;
  }

  async saveSourceChunks(
    sourceId: string,
    chunks: SourceChunkWriteInput[],
    options?: { createdAt?: string },
  ) {
    const client = getSupabaseAdminClient();
    const { data: source, error: sourceError } = await client
      .from("curriculum_sources")
      .select("id")
      .eq("id", sourceId)
      .maybeSingle();
    assertNoError(sourceError, "read curriculum source");
    if (!source) return null;

    const timestamp = options?.createdAt ?? nowIso();
    const rows: DbSourceChunkInsert[] = chunks.map((chunk) => ({
      id: createId("cchunk"),
      source_id: sourceId,
      chunk_index: chunk.chunkIndex,
      excerpt: chunk.excerpt,
      token_count: chunk.tokenCount,
      content_hash: chunk.contentHash,
      created_at: timestamp,
    }));

    // Replace strategy: PostgREST cannot wrap delete + insert in one
    // transaction, but chunks are derived data — a failed insert after the
    // delete just leaves the source temporarily chunk-less, and the caller
    // retries the save. The (source_id, chunk_index) unique constraint plus
    // the preceding delete is what makes re-saves dedupe-safe.
    const deleteResult = await client
      .from("curriculum_source_chunks")
      .delete()
      .eq("source_id", sourceId);
    assertNoError(deleteResult.error, "delete curriculum source chunks");

    if (rows.length > 0) {
      const insertResult = await client.from("curriculum_source_chunks").insert(rows);
      assertNoError(insertResult.error, "insert curriculum source chunks");
    }

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      chunkIndex: row.chunk_index,
      excerpt: row.excerpt,
      tokenCount: row.token_count,
      contentHash: row.content_hash,
      createdAt: row.created_at ?? timestamp,
    }));
  }

  async listSourceChunks(sourceIds: string[]) {
    if (sourceIds.length === 0) return [];
    const { data, error } = await getSupabaseAdminClient()
      .from("curriculum_source_chunks")
      .select("*")
      .in("source_id", sourceIds)
      .order("chunk_index");
    assertNoError(error, "list curriculum source chunks");
    return sortChunks((data ?? []).map(fromDbSourceChunkRow)).map(toSourceChunkDto);
  }

  async listChunksForVersion(ownerId: string, curriculumVersionId: string) {
    const client = getSupabaseAdminClient();
    const { data: version, error: versionError } = await client
      .from("curriculum_versions")
      .select("id, curriculum_id")
      .eq("id", curriculumVersionId)
      .maybeSingle();
    assertNoError(versionError, "read curriculum version");
    if (!version) return null;

    const { data: curriculum, error: curriculumError } = await client
      .from("curricula")
      .select("id")
      .eq("id", version.curriculum_id)
      .eq("owner_user_id", ownerId)
      .maybeSingle();
    assertNoError(curriculumError, "read curriculum");
    if (!curriculum) return null;

    const { data: sources, error: sourcesError } = await client
      .from("curriculum_sources")
      .select("id")
      .eq("curriculum_version_id", curriculumVersionId);
    assertNoError(sourcesError, "list curriculum sources");

    return this.listSourceChunks((sources ?? []).map((row) => row.id));
  }

  async listChunksForVersionById(curriculumVersionId: string) {
    const client = getSupabaseAdminClient();
    const { data: sources, error } = await client
      .from("curriculum_sources")
      .select("id")
      .eq("curriculum_version_id", curriculumVersionId);
    assertNoError(error, "list learning curriculum sources");
    const version = await client
      .from("curriculum_versions")
      .select("id")
      .eq("id", curriculumVersionId)
      .maybeSingle();
    assertNoError(version.error, "read learning curriculum version");
    if (!version.data) return null;
    return this.listSourceChunks((sources ?? []).map((source) => source.id));
  }
}

const supabaseRepository = new SupabaseCurriculumRepository();

// ---------------------------------------------------------------------------
// Backend selection (same rules as getProjectsRepository / getRagRepository).
// ---------------------------------------------------------------------------

function getConfiguredBackend(): CurriculumBackend | "auto" {
  const value = process.env.BRANCHMIND_CURRICULUM_BACKEND?.trim().toLowerCase();
  if (value === "file" || value === "supabase") return value;
  return "auto";
}

export function getCurriculumRepository(): CurriculumRepository {
  const backend = getConfiguredBackend();

  if (backend === "file") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true"
    ) {
      throw new Error("File curriculum storage is not allowed in production.");
    }

    return fileRepository;
  }

  if (backend === "supabase") {
    requireSupabaseServerConfig();
    return supabaseRepository;
  }

  if (hasSupabaseServerConfig()) return supabaseRepository;
  if (process.env.NODE_ENV === "production") {
    requireSupabaseServerConfig();
  }

  return fileRepository;
}
