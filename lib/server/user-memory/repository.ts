import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import {
  cleanConceptTitle,
  mergeMemoryText,
  normalizeConceptKey,
  truncateMemoryText,
} from "@/lib/server/user-memory/extractor";
import {
  MAX_CONCEPT_NAME_CHARS,
  MAX_CONCEPT_NOTE_CHARS,
  MAX_PREFERRED_STYLE_CHARS,
  MAX_PROFILE_SUMMARY_CHARS,
  MAX_STORED_CONCEPTS_PER_USER,
  type StoredUserMemoryConcept,
  type UpsertConceptInput,
  type UserMemoryConceptStatus,
  type UserMemorySnapshot,
} from "@/lib/server/user-memory/types";
import type { Database } from "@/lib/supabase/database.types";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";

export type UserMemoryBackend = "file" | "supabase" | "memory";

export type UserMemoryRepository = {
  getSnapshot(ownerId: string): Promise<UserMemorySnapshot>;
  upsertProfile(
    ownerId: string,
    update: { profileSummary?: string; preferredStyle?: string },
  ): Promise<UserMemorySnapshot>;
  upsertConcepts(
    ownerId: string,
    items: UpsertConceptInput[],
    maxConcepts?: number,
  ): Promise<StoredUserMemoryConcept[]>;
  deleteConcept(
    ownerId: string,
    identifier: { id?: string; conceptKey?: string },
  ): Promise<boolean>;
  clearOwnerMemory(ownerId: string): Promise<void>;
  transferOwner(fromOwnerId: string, toOwnerId: string): Promise<number>;
};

export class UserMemorySchemaUnavailableError extends Error {
  code: string;

  constructor(message: string, code = "USER_MEMORY_SCHEMA_UNAVAILABLE") {
    super(message);
    this.name = "UserMemorySchemaUnavailableError";
    this.code = code;
  }
}

export function isMissingUserMemorySchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const obj = error as Record<string, unknown>;
  const code = typeof obj.code === "string" ? obj.code.trim() : "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST204") {
    return true;
  }
  const combinedText = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return /could not find.*branchmind_user_memory|branchmind_user_memory.*does not exist|schema cache.*branchmind_user_memory/i.test(
    combinedText,
  );
}

function emptySnapshot(ownerId: string): UserMemorySnapshot {
  return {
    ownerId,
    profileSummary: "",
    preferredStyle: "",
    concepts: [],
    updatedAt: null,
  };
}

function retentionPriority(status: UserMemoryConceptStatus): number {
  if (status === "struggling") return 3;
  if (status === "learning") return 2;
  return 1;
}

function parseTimestamp(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function sortConceptsByLastSeenDesc(
  concepts: StoredUserMemoryConcept[],
): StoredUserMemoryConcept[] {
  return [...concepts].sort((left, right) => {
    const diff = parseTimestamp(right.lastSeenAt) - parseTimestamp(left.lastSeenAt);
    if (diff !== 0) return diff;
    return right.id.localeCompare(left.id);
  });
}

function pruneConceptsToCap(
  concepts: StoredUserMemoryConcept[],
  maxConcepts: number,
): {
  kept: StoredUserMemoryConcept[];
  prunedIds: string[];
} {
  const cap = Math.max(1, Math.floor(maxConcepts));
  if (concepts.length <= cap) {
    return { kept: sortConceptsByLastSeenDesc(concepts), prunedIds: [] };
  }

  // Keep `struggling` entries longest, then `learning`, then `mastered`;
  // within the same priority tier, keep the most recently seen entries.
  const rankedForRetention = [...concepts].sort((left, right) => {
    const priorityDiff =
      retentionPriority(right.status) - retentionPriority(left.status);
    if (priorityDiff !== 0) return priorityDiff;

    const seenDiff =
      parseTimestamp(right.lastSeenAt) - parseTimestamp(left.lastSeenAt);
    if (seenDiff !== 0) return seenDiff;

    const evidenceDiff = right.evidenceCount - left.evidenceCount;
    if (evidenceDiff !== 0) return evidenceDiff;

    return right.id.localeCompare(left.id);
  });

  const kept = sortConceptsByLastSeenDesc(rankedForRetention.slice(0, cap));
  const prunedIds = rankedForRetention.slice(cap).map((item) => item.id);
  return { kept, prunedIds };
}

function applyConceptUpserts(
  ownerId: string,
  existingConcepts: StoredUserMemoryConcept[],
  items: UpsertConceptInput[],
  maxConcepts: number = MAX_STORED_CONCEPTS_PER_USER,
): {
  kept: StoredUserMemoryConcept[];
  touchedKeys: Set<string>;
  prunedIds: string[];
} {
  const byKey = new Map<string, StoredUserMemoryConcept>();
  for (const item of existingConcepts) {
    byKey.set(item.conceptKey, { ...item });
  }

  const touchedKeys = new Set<string>();
  const nowIso = new Date().toISOString();

  for (const rawItem of items) {
    const cleanedConcept = cleanConceptTitle(
      rawItem.concept,
      MAX_CONCEPT_NAME_CHARS,
    );
    const conceptKey =
      rawItem.conceptKey?.trim()
        ? normalizeConceptKey(rawItem.conceptKey)
        : normalizeConceptKey(cleanedConcept);
    if (!cleanedConcept || !conceptKey) continue;

    const existing = byKey.get(conceptKey);
    const note =
      rawItem.note !== undefined
        ? truncateMemoryText(rawItem.note, MAX_CONCEPT_NOTE_CHARS)
        : existing?.note ?? "";
    const lastSeenAt = rawItem.lastSeenAt ?? nowIso;
    const evidenceCount =
      rawItem.evidenceCount !== undefined
        ? Math.max(1, Math.floor(rawItem.evidenceCount))
        : existing
          ? existing.evidenceCount + 1
          : 1;

    const nextRecord: StoredUserMemoryConcept = {
      id: existing?.id ?? createId("memc"),
      ownerId,
      conceptKey,
      concept: cleanedConcept,
      status: rawItem.status,
      note,
      sourceProjectId:
        rawItem.sourceProjectId !== undefined
          ? rawItem.sourceProjectId
          : existing?.sourceProjectId ?? null,
      sourceNodeId:
        rawItem.sourceNodeId !== undefined
          ? rawItem.sourceNodeId
          : existing?.sourceNodeId ?? null,
      evidenceCount,
      lastSeenAt,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    byKey.set(conceptKey, nextRecord);
    touchedKeys.add(conceptKey);
  }

  const { kept, prunedIds } = pruneConceptsToCap(
    [...byKey.values()],
    maxConcepts,
  );
  return { kept, touchedKeys, prunedIds };
}

function mergeTransferredStatus(
  fromConcept: StoredUserMemoryConcept,
  toConcept: StoredUserMemoryConcept,
): UserMemoryConceptStatus {
  const fromNewer =
    parseTimestamp(fromConcept.lastSeenAt) >=
    parseTimestamp(toConcept.lastSeenAt);
  const newer = fromNewer ? fromConcept : toConcept;
  const older = fromNewer ? toConcept : fromConcept;

  // Preserve an unresolved `struggling` signal if the newer one is only `learning`
  if (older.status === "struggling" && newer.status === "learning") {
    return "struggling";
  }
  return newer.status;
}

function computeSnapshotUpdatedAt(
  profileUpdatedAt: string | null,
  concepts: StoredUserMemoryConcept[],
): string | null {
  let best: string | null = profileUpdatedAt;
  for (const concept of concepts) {
    if (!best || parseTimestamp(concept.updatedAt) > parseTimestamp(best)) {
      best = concept.updatedAt;
    }
  }
  return best;
}

function mergeOwnerSnapshots(
  toOwnerId: string,
  fromSnapshot: UserMemorySnapshot,
  toSnapshot: UserMemorySnapshot,
): {
  profileSummary: string;
  preferredStyle: string;
  keptConcepts: StoredUserMemoryConcept[];
  prunedToIds: string[];
  transferredCount: number;
} {
  const hasFromProfile = Boolean(
    fromSnapshot.profileSummary.trim() || fromSnapshot.preferredStyle.trim(),
  );
  const transferredCount =
    fromSnapshot.concepts.length + (hasFromProfile ? 1 : 0);

  const profileSummary = mergeMemoryText(
    toSnapshot.profileSummary,
    fromSnapshot.profileSummary,
    MAX_PROFILE_SUMMARY_CHARS,
  );
  const preferredStyle = mergeMemoryText(
    toSnapshot.preferredStyle,
    fromSnapshot.preferredStyle,
    MAX_PREFERRED_STYLE_CHARS,
  );

  const mergedByKey = new Map<string, StoredUserMemoryConcept>();
  for (const existing of toSnapshot.concepts) {
    mergedByKey.set(existing.conceptKey, { ...existing, ownerId: toOwnerId });
  }

  const nowIso = new Date().toISOString();
  for (const incoming of fromSnapshot.concepts) {
    const existing = mergedByKey.get(incoming.conceptKey);
    if (!existing) {
      mergedByKey.set(incoming.conceptKey, {
        ...incoming,
        ownerId: toOwnerId,
        updatedAt: nowIso,
      });
      continue;
    }

    const fromNewer =
      parseTimestamp(incoming.lastSeenAt) >= parseTimestamp(existing.lastSeenAt);
    const primaryNote = fromNewer
      ? incoming.note || existing.note
      : existing.note || incoming.note;
    const latestSeenAt = fromNewer ? incoming.lastSeenAt : existing.lastSeenAt;

    mergedByKey.set(incoming.conceptKey, {
      ...existing,
      ownerId: toOwnerId,
      concept: fromNewer ? incoming.concept : existing.concept,
      status: mergeTransferredStatus(incoming, existing),
      note: truncateMemoryText(primaryNote, MAX_CONCEPT_NOTE_CHARS),
      sourceProjectId:
        (fromNewer ? incoming.sourceProjectId : existing.sourceProjectId) ??
        existing.sourceProjectId ??
        incoming.sourceProjectId,
      sourceNodeId:
        (fromNewer ? incoming.sourceNodeId : existing.sourceNodeId) ??
        existing.sourceNodeId ??
        incoming.sourceNodeId,
      evidenceCount: existing.evidenceCount + incoming.evidenceCount,
      lastSeenAt: latestSeenAt,
      updatedAt: nowIso,
    });
  }

  const { kept, prunedIds } = pruneConceptsToCap(
    [...mergedByKey.values()],
    MAX_STORED_CONCEPTS_PER_USER,
  );
  const existingToIds = new Set(toSnapshot.concepts.map((c) => c.id));
  const prunedToIds = prunedIds.filter((id) => existingToIds.has(id));

  return {
    profileSummary,
    preferredStyle,
    keptConcepts: kept,
    prunedToIds,
    transferredCount,
  };
}

// ---------------------------------------------------------------------------
// 1. In-memory repository (used automatically in Vitest unless file/supabase requested)
// ---------------------------------------------------------------------------

type StoredOwnerRecord = {
  profileSummary: string;
  preferredStyle: string;
  profileUpdatedAt: string | null;
  concepts: StoredUserMemoryConcept[];
};

class InMemoryUserMemoryRepository implements UserMemoryRepository {
  private owners = new Map<string, StoredOwnerRecord>();

  reset() {
    this.owners.clear();
  }

  async getSnapshot(ownerId: string): Promise<UserMemorySnapshot> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return emptySnapshot("");
    const record = this.owners.get(cleanOwner);
    if (!record) return emptySnapshot(cleanOwner);

    const concepts = sortConceptsByLastSeenDesc(
      record.concepts.map((item) => ({ ...item })),
    );
    return {
      ownerId: cleanOwner,
      profileSummary: record.profileSummary,
      preferredStyle: record.preferredStyle,
      concepts,
      updatedAt: computeSnapshotUpdatedAt(record.profileUpdatedAt, concepts),
    };
  }

  async upsertProfile(
    ownerId: string,
    update: { profileSummary?: string; preferredStyle?: string },
  ): Promise<UserMemorySnapshot> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return emptySnapshot("");

    const current = this.owners.get(cleanOwner) ?? {
      profileSummary: "",
      preferredStyle: "",
      profileUpdatedAt: null,
      concepts: [],
    };
    const nowIso = new Date().toISOString();

    const nextProfileSummary =
      update.profileSummary !== undefined
        ? truncateMemoryText(update.profileSummary, MAX_PROFILE_SUMMARY_CHARS)
        : current.profileSummary;
    const nextPreferredStyle =
      update.preferredStyle !== undefined
        ? truncateMemoryText(update.preferredStyle, MAX_PREFERRED_STYLE_CHARS)
        : current.preferredStyle;

    this.owners.set(cleanOwner, {
      ...current,
      profileSummary: nextProfileSummary,
      preferredStyle: nextPreferredStyle,
      profileUpdatedAt: nowIso,
    });

    return this.getSnapshot(cleanOwner);
  }

  async upsertConcepts(
    ownerId: string,
    items: UpsertConceptInput[],
    maxConcepts = MAX_STORED_CONCEPTS_PER_USER,
  ): Promise<StoredUserMemoryConcept[]> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return [];

    const current = this.owners.get(cleanOwner) ?? {
      profileSummary: "",
      preferredStyle: "",
      profileUpdatedAt: null,
      concepts: [],
    };

    const { kept } = applyConceptUpserts(
      cleanOwner,
      current.concepts,
      items,
      maxConcepts,
    );

    this.owners.set(cleanOwner, {
      ...current,
      concepts: kept,
    });

    return kept.map((item) => ({ ...item }));
  }

  async deleteConcept(
    ownerId: string,
    identifier: { id?: string; conceptKey?: string },
  ): Promise<boolean> {
    const cleanOwner = ownerId.trim();
    const record = this.owners.get(cleanOwner);
    if (!record) return false;

    const targetId = identifier.id?.trim();
    const targetKey = identifier.conceptKey
      ? normalizeConceptKey(identifier.conceptKey)
      : "";
    if (!targetId && !targetKey) return false;

    const nextConcepts = record.concepts.filter((item) => {
      if (targetId && item.id === targetId) return false;
      if (targetKey && item.conceptKey === targetKey) return false;
      return true;
    });

    if (nextConcepts.length === record.concepts.length) {
      return false;
    }

    this.owners.set(cleanOwner, {
      ...record,
      concepts: nextConcepts,
    });
    return true;
  }

  async clearOwnerMemory(ownerId: string): Promise<void> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return;
    this.owners.delete(cleanOwner);
  }

  async transferOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
    const fromId = fromOwnerId.trim();
    const toId = toOwnerId.trim();
    if (!fromId || !toId || fromId === toId) return 0;

    const fromSnapshot = await this.getSnapshot(fromId);
    if (
      !fromSnapshot.profileSummary &&
      !fromSnapshot.preferredStyle &&
      fromSnapshot.concepts.length === 0
    ) {
      return 0;
    }

    const toSnapshot = await this.getSnapshot(toId);
    const merged = mergeOwnerSnapshots(toId, fromSnapshot, toSnapshot);
    const nowIso = new Date().toISOString();

    this.owners.set(toId, {
      profileSummary: merged.profileSummary,
      preferredStyle: merged.preferredStyle,
      profileUpdatedAt:
        merged.profileSummary || merged.preferredStyle
          ? nowIso
          : this.owners.get(toId)?.profileUpdatedAt ?? null,
      concepts: merged.keptConcepts,
    });
    this.owners.delete(fromId);

    return merged.transferredCount;
  }
}

const inMemoryRepository = new InMemoryUserMemoryRepository();

let resetSchemaWarningCallback: (() => void) | null = null;

export function registerSchemaWarningResetHook(cb: () => void) {
  resetSchemaWarningCallback = cb;
}

export function resetInMemoryUserMemoryForTests() {
  inMemoryRepository.reset();
  resetSchemaWarningCallback?.();
}

// ---------------------------------------------------------------------------
// 2. File-backed repository (local development fallback)
// ---------------------------------------------------------------------------

type UserMemoryDataFile = {
  version: 1;
  owners: Record<string, StoredOwnerRecord>;
};

function resolveUserMemoryFilePath(): string {
  const explicit = process.env.BRANCHMIND_USER_MEMORY_FILE?.trim();
  if (explicit) return explicit;
  return path.join(process.cwd(), "data", "branchmind-user-memory.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeFileData(raw: unknown): UserMemoryDataFile {
  if (
    raw &&
    typeof raw === "object" &&
    "owners" in raw &&
    raw.owners &&
    typeof raw.owners === "object"
  ) {
    const ownersRecord = raw.owners as Record<string, Partial<StoredOwnerRecord>>;
    const normalizedOwners: Record<string, StoredOwnerRecord> = {};
    for (const [ownerId, entry] of Object.entries(ownersRecord)) {
      if (!entry || typeof entry !== "object") continue;
      normalizedOwners[ownerId] = {
        profileSummary:
          typeof entry.profileSummary === "string" ? entry.profileSummary : "",
        preferredStyle:
          typeof entry.preferredStyle === "string" ? entry.preferredStyle : "",
        profileUpdatedAt:
          typeof entry.profileUpdatedAt === "string"
            ? entry.profileUpdatedAt
            : null,
        concepts: Array.isArray(entry.concepts) ? entry.concepts : [],
      };
    }
    return { version: 1, owners: normalizedOwners };
  }
  return { version: 1, owners: {} };
}

async function readMemoryDataFile(filePath: string): Promise<UserMemoryDataFile> {
  try {
    const content = await readFile(filePath, "utf8");
    return normalizeFileData(JSON.parse(content));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, owners: {} };
    }
    throw error;
  }
}

async function writeMemoryDataFile(filePath: string, data: UserMemoryDataFile) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

let fileWriteQueue: Promise<unknown> = Promise.resolve();

function mutateMemoryDataFile<T>(
  mutator: (data: UserMemoryDataFile) => T | Promise<T>,
): Promise<T> {
  const filePath = resolveUserMemoryFilePath();
  const next = fileWriteQueue.then(async () => {
    const data = await readMemoryDataFile(filePath);
    const result = await mutator(data);
    await writeMemoryDataFile(filePath, data);
    return result;
  });
  fileWriteQueue = next.catch(() => undefined);
  return next;
}

class FileUserMemoryRepository implements UserMemoryRepository {
  async getSnapshot(ownerId: string): Promise<UserMemorySnapshot> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return emptySnapshot("");
    const data = await readMemoryDataFile(resolveUserMemoryFilePath());
    const record = data.owners[cleanOwner];
    if (!record) return emptySnapshot(cleanOwner);

    const concepts = sortConceptsByLastSeenDesc(record.concepts);
    return {
      ownerId: cleanOwner,
      profileSummary: record.profileSummary,
      preferredStyle: record.preferredStyle,
      concepts,
      updatedAt: computeSnapshotUpdatedAt(record.profileUpdatedAt, concepts),
    };
  }

  async upsertProfile(
    ownerId: string,
    update: { profileSummary?: string; preferredStyle?: string },
  ): Promise<UserMemorySnapshot> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return emptySnapshot("");

    return mutateMemoryDataFile((data) => {
      const current = data.owners[cleanOwner] ?? {
        profileSummary: "",
        preferredStyle: "",
        profileUpdatedAt: null,
        concepts: [],
      };
      const nowIso = new Date().toISOString();
      const profileSummary =
        update.profileSummary !== undefined
          ? truncateMemoryText(update.profileSummary, MAX_PROFILE_SUMMARY_CHARS)
          : current.profileSummary;
      const preferredStyle =
        update.preferredStyle !== undefined
          ? truncateMemoryText(update.preferredStyle, MAX_PREFERRED_STYLE_CHARS)
          : current.preferredStyle;

      const updated: StoredOwnerRecord = {
        ...current,
        profileSummary,
        preferredStyle,
        profileUpdatedAt: nowIso,
      };
      data.owners[cleanOwner] = updated;

      const concepts = sortConceptsByLastSeenDesc(updated.concepts);
      return {
        ownerId: cleanOwner,
        profileSummary,
        preferredStyle,
        concepts,
        updatedAt: computeSnapshotUpdatedAt(nowIso, concepts),
      };
    });
  }

  async upsertConcepts(
    ownerId: string,
    items: UpsertConceptInput[],
    maxConcepts = MAX_STORED_CONCEPTS_PER_USER,
  ): Promise<StoredUserMemoryConcept[]> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return [];

    return mutateMemoryDataFile((data) => {
      const current = data.owners[cleanOwner] ?? {
        profileSummary: "",
        preferredStyle: "",
        profileUpdatedAt: null,
        concepts: [],
      };

      const { kept } = applyConceptUpserts(
        cleanOwner,
        current.concepts,
        items,
        maxConcepts,
      );
      data.owners[cleanOwner] = {
        ...current,
        concepts: kept,
      };
      return kept;
    });
  }

  async deleteConcept(
    ownerId: string,
    identifier: { id?: string; conceptKey?: string },
  ): Promise<boolean> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return false;

    const targetId = identifier.id?.trim();
    const targetKey = identifier.conceptKey
      ? normalizeConceptKey(identifier.conceptKey)
      : "";
    if (!targetId && !targetKey) return false;

    return mutateMemoryDataFile((data) => {
      const current = data.owners[cleanOwner];
      if (!current) return false;

      const nextConcepts = current.concepts.filter((item) => {
        if (targetId && item.id === targetId) return false;
        if (targetKey && item.conceptKey === targetKey) return false;
        return true;
      });
      if (nextConcepts.length === current.concepts.length) {
        return false;
      }

      data.owners[cleanOwner] = {
        ...current,
        concepts: nextConcepts,
      };
      return true;
    });
  }

  async clearOwnerMemory(ownerId: string): Promise<void> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return;

    await mutateMemoryDataFile((data) => {
      delete data.owners[cleanOwner];
    });
  }

  async transferOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
    const fromId = fromOwnerId.trim();
    const toId = toOwnerId.trim();
    if (!fromId || !toId || fromId === toId) return 0;

    return mutateMemoryDataFile((data) => {
      const fromRecord = data.owners[fromId];
      if (!fromRecord) return 0;

      const fromConcepts = sortConceptsByLastSeenDesc(fromRecord.concepts);
      const fromSnapshot: UserMemorySnapshot = {
        ownerId: fromId,
        profileSummary: fromRecord.profileSummary,
        preferredStyle: fromRecord.preferredStyle,
        concepts: fromConcepts,
        updatedAt: computeSnapshotUpdatedAt(
          fromRecord.profileUpdatedAt,
          fromConcepts,
        ),
      };

      if (
        !fromSnapshot.profileSummary &&
        !fromSnapshot.preferredStyle &&
        fromSnapshot.concepts.length === 0
      ) {
        delete data.owners[fromId];
        return 0;
      }

      const toRecord = data.owners[toId];
      const toConcepts = toRecord
        ? sortConceptsByLastSeenDesc(toRecord.concepts)
        : [];
      const toSnapshot: UserMemorySnapshot = toRecord
        ? {
            ownerId: toId,
            profileSummary: toRecord.profileSummary,
            preferredStyle: toRecord.preferredStyle,
            concepts: toConcepts,
            updatedAt: computeSnapshotUpdatedAt(
              toRecord.profileUpdatedAt,
              toConcepts,
            ),
          }
        : emptySnapshot(toId);

      const merged = mergeOwnerSnapshots(toId, fromSnapshot, toSnapshot);
      const nowIso = new Date().toISOString();

      data.owners[toId] = {
        profileSummary: merged.profileSummary,
        preferredStyle: merged.preferredStyle,
        profileUpdatedAt:
          merged.profileSummary || merged.preferredStyle
            ? nowIso
            : toRecord?.profileUpdatedAt ?? null,
        concepts: merged.keptConcepts,
      };
      delete data.owners[fromId];

      return merged.transferredCount;
    });
  }
}

const fileRepository = new FileUserMemoryRepository();

// ---------------------------------------------------------------------------
// 3. Supabase-backed repository (production)
// ---------------------------------------------------------------------------

type ProfileRow =
  Database["public"]["Tables"]["branchmind_user_memory_profiles"]["Row"];
type ConceptRow =
  Database["public"]["Tables"]["branchmind_user_memory_concepts"]["Row"];
type ConceptInsert =
  Database["public"]["Tables"]["branchmind_user_memory_concepts"]["Insert"];

function mapConceptRow(row: ConceptRow): StoredUserMemoryConcept {
  return {
    id: row.id,
    ownerId: row.owner_id,
    conceptKey: row.concept_key,
    concept: row.concept,
    status: row.status,
    note: row.note,
    sourceProjectId: row.source_project_id,
    sourceNodeId: row.source_node_id,
    evidenceCount: row.evidence_count,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConceptToInsert(item: StoredUserMemoryConcept): ConceptInsert {
  return {
    id: item.id,
    owner_id: item.ownerId,
    concept_key: item.conceptKey,
    concept: item.concept,
    status: item.status,
    note: item.note,
    source_project_id: item.sourceProjectId,
    source_node_id: item.sourceNodeId,
    evidence_count: item.evidenceCount,
    last_seen_at: item.lastSeenAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function throwForSupabaseError(error: unknown, step: string): never {
  if (isMissingUserMemorySchemaError(error)) {
    const msg =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : "User memory schema tables are not migrated yet.";
    throw new UserMemorySchemaUnavailableError(msg);
  }
  if (error instanceof Error) {
    throw error;
  }
  const detail =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  throw new Error(`Supabase user memory ${step} failed: ${detail}`);
}

class SupabaseUserMemoryRepository implements UserMemoryRepository {
  private async fetchProfileRow(ownerId: string): Promise<ProfileRow | null> {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("branchmind_user_memory_profiles")
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throwForSupabaseError(error, "read-profile");
    return (data as ProfileRow | null) ?? null;
  }

  private async fetchConceptRows(ownerId: string): Promise<ConceptRow[]> {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("branchmind_user_memory_concepts")
      .select("*")
      .eq("owner_id", ownerId)
      .order("last_seen_at", { ascending: false });
    if (error) throwForSupabaseError(error, "list-concepts");
    return (data as ConceptRow[] | null) ?? [];
  }

  async getSnapshot(ownerId: string): Promise<UserMemorySnapshot> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return emptySnapshot("");

    const [profileRow, conceptRows] = await Promise.all([
      this.fetchProfileRow(cleanOwner),
      this.fetchConceptRows(cleanOwner),
    ]);

    const concepts = sortConceptsByLastSeenDesc(conceptRows.map(mapConceptRow));
    return {
      ownerId: cleanOwner,
      profileSummary: profileRow?.profile_summary ?? "",
      preferredStyle: profileRow?.preferred_style ?? "",
      concepts,
      updatedAt: computeSnapshotUpdatedAt(
        profileRow?.updated_at ?? null,
        concepts,
      ),
    };
  }

  async upsertProfile(
    ownerId: string,
    update: { profileSummary?: string; preferredStyle?: string },
  ): Promise<UserMemorySnapshot> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return emptySnapshot("");

    const existing = await this.fetchProfileRow(cleanOwner);
    const nowIso = new Date().toISOString();
    const profileSummary =
      update.profileSummary !== undefined
        ? truncateMemoryText(update.profileSummary, MAX_PROFILE_SUMMARY_CHARS)
        : existing?.profile_summary ?? "";
    const preferredStyle =
      update.preferredStyle !== undefined
        ? truncateMemoryText(update.preferredStyle, MAX_PREFERRED_STYLE_CHARS)
        : existing?.preferred_style ?? "";

    const client = getSupabaseAdminClient();
    const { error } = await client
      .from("branchmind_user_memory_profiles")
      .upsert(
        {
          owner_id: cleanOwner,
          profile_summary: profileSummary,
          preferred_style: preferredStyle,
          created_at: existing?.created_at ?? nowIso,
          updated_at: nowIso,
        },
        { onConflict: "owner_id" },
      );
    if (error) throwForSupabaseError(error, "upsert-profile");

    return this.getSnapshot(cleanOwner);
  }

  async upsertConcepts(
    ownerId: string,
    items: UpsertConceptInput[],
    maxConcepts = MAX_STORED_CONCEPTS_PER_USER,
  ): Promise<StoredUserMemoryConcept[]> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner || items.length === 0) {
      return cleanOwner
        ? sortConceptsByLastSeenDesc(
            (await this.fetchConceptRows(cleanOwner)).map(mapConceptRow),
          )
        : [];
    }

    const existingRows = await this.fetchConceptRows(cleanOwner);
    const existingConcepts = existingRows.map(mapConceptRow);
    const existingIds = new Set(existingConcepts.map((c) => c.id));

    const { kept, touchedKeys, prunedIds } = applyConceptUpserts(
      cleanOwner,
      existingConcepts,
      items,
      maxConcepts,
    );

    const rowsToUpsert = kept
      .filter((item) => touchedKeys.has(item.conceptKey))
      .map(mapConceptToInsert);

    const client = getSupabaseAdminClient();
    if (rowsToUpsert.length > 0) {
      const { error } = await client
        .from("branchmind_user_memory_concepts")
        .upsert(rowsToUpsert, { onConflict: "owner_id,concept_key" });
      if (error) throwForSupabaseError(error, "upsert-concepts");
    }

    const persistedPrunedIds = prunedIds.filter((id) => existingIds.has(id));
    if (persistedPrunedIds.length > 0) {
      const { error } = await client
        .from("branchmind_user_memory_concepts")
        .delete()
        .eq("owner_id", cleanOwner)
        .in("id", persistedPrunedIds);
      if (error) throwForSupabaseError(error, "prune-concepts");
    }

    return kept;
  }

  async deleteConcept(
    ownerId: string,
    identifier: { id?: string; conceptKey?: string },
  ): Promise<boolean> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return false;

    const targetId = identifier.id?.trim();
    const targetKey = identifier.conceptKey
      ? normalizeConceptKey(identifier.conceptKey)
      : "";
    if (!targetId && !targetKey) return false;

    const existingRows = await this.fetchConceptRows(cleanOwner);
    const matchingIds = existingRows
      .filter((row) => {
        if (targetId && row.id === targetId) return true;
        if (targetKey && row.concept_key === targetKey) return true;
        return false;
      })
      .map((row) => row.id);

    if (matchingIds.length === 0) return false;

    const client = getSupabaseAdminClient();
    const { error } = await client
      .from("branchmind_user_memory_concepts")
      .delete()
      .eq("owner_id", cleanOwner)
      .in("id", matchingIds);
    if (error) throwForSupabaseError(error, "delete-concept");

    return true;
  }

  async clearOwnerMemory(ownerId: string): Promise<void> {
    const cleanOwner = ownerId.trim();
    if (!cleanOwner) return;

    const client = getSupabaseAdminClient();
    const { error: conceptsError } = await client
      .from("branchmind_user_memory_concepts")
      .delete()
      .eq("owner_id", cleanOwner);
    if (conceptsError) throwForSupabaseError(conceptsError, "clear-concepts");

    const { error: profileError } = await client
      .from("branchmind_user_memory_profiles")
      .delete()
      .eq("owner_id", cleanOwner);
    if (profileError) throwForSupabaseError(profileError, "clear-profile");
  }

  async transferOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
    const fromId = fromOwnerId.trim();
    const toId = toOwnerId.trim();
    if (!fromId || !toId || fromId === toId) return 0;

    const [fromSnapshot, toSnapshot] = await Promise.all([
      this.getSnapshot(fromId),
      this.getSnapshot(toId),
    ]);

    if (
      !fromSnapshot.profileSummary &&
      !fromSnapshot.preferredStyle &&
      fromSnapshot.concepts.length === 0
    ) {
      return 0;
    }

    const merged = mergeOwnerSnapshots(toId, fromSnapshot, toSnapshot);
    const client = getSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    if (merged.profileSummary || merged.preferredStyle) {
      const { error } = await client
        .from("branchmind_user_memory_profiles")
        .upsert(
          {
            owner_id: toId,
            profile_summary: merged.profileSummary,
            preferred_style: merged.preferredStyle,
            updated_at: nowIso,
          },
          { onConflict: "owner_id" },
        );
      if (error) throwForSupabaseError(error, "transfer-upsert-profile");
    }

    if (merged.keptConcepts.length > 0) {
      const { error } = await client
        .from("branchmind_user_memory_concepts")
        .upsert(merged.keptConcepts.map(mapConceptToInsert), {
          onConflict: "owner_id,concept_key",
        });
      if (error) throwForSupabaseError(error, "transfer-upsert-concepts");
    }

    if (merged.prunedToIds.length > 0) {
      const { error } = await client
        .from("branchmind_user_memory_concepts")
        .delete()
        .eq("owner_id", toId)
        .in("id", merged.prunedToIds);
      if (error) throwForSupabaseError(error, "transfer-prune-concepts");
    }

    await this.clearOwnerMemory(fromId);
    return merged.transferredCount;
  }
}

const supabaseRepository = new SupabaseUserMemoryRepository();

function assertFileStoreAllowedInProduction() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true"
  ) {
    throw new Error("File user memory storage is not allowed in production.");
  }
}

export function getUserMemoryRepository(): UserMemoryRepository {
  const configured = process.env.BRANCHMIND_MEMORY_BACKEND?.trim().toLowerCase();

  if (configured === "file") {
    assertFileStoreAllowedInProduction();
    return fileRepository;
  }

  if (configured === "supabase") {
    return supabaseRepository;
  }

  if (configured === "memory") {
    return inMemoryRepository;
  }

  // "auto" (default)
  if (hasSupabaseServerConfig()) {
    return supabaseRepository;
  }

  if (process.env.VITEST && !process.env.BRANCHMIND_USER_MEMORY_FILE?.trim()) {
    return inMemoryRepository;
  }

  assertFileStoreAllowedInProduction();
  return fileRepository;
}
