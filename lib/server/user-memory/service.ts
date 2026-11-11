import type {
  UserMemoryConceptItem,
  UserMemoryContextSlot,
} from "@/lib/server/tree-context/types";
import {
  extractCanvasConceptUpdates,
  extractProfileAndStyleSignals,
  mergeMemoryText,
} from "@/lib/server/user-memory/extractor";
import {
  getUserMemoryRepository,
  isMissingUserMemorySchemaError,
  registerSchemaWarningResetHook,
  UserMemorySchemaUnavailableError,
} from "@/lib/server/user-memory/repository";
import {
  DEFAULT_MEMORY_SLOT_CONCEPT_LIMIT,
  MAX_PREFERRED_STYLE_CHARS,
  MAX_PROFILE_SUMMARY_CHARS,
  MAX_STORED_CONCEPTS_PER_USER,
  type PatchUserMemoryInput,
  type RecordCanvasTurnMemoryInput,
  type StoredUserMemoryConcept,
  type UpsertConceptInput,
  type UserMemoryConceptStatus,
  type UserMemorySnapshot,
} from "@/lib/server/user-memory/types";

let hasWarnedMissingSchema = false;

registerSchemaWarningResetHook(() => {
  hasWarnedMissingSchema = false;
});

function warnMemoryFailure(step: string, error: unknown) {
  if (
    error instanceof UserMemorySchemaUnavailableError ||
    isMissingUserMemorySchemaError(error)
  ) {
    if (!hasWarnedMissingSchema) {
      hasWarnedMissingSchema = true;
      console.warn(
        "BranchMind user memory tables are unavailable; continuing without cross-canvas memory.",
        { step },
      );
    }
    return;
  }

  if (!process.env.VITEST) {
    console.warn("BranchMind user memory operation failed; failing open.", {
      step,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const EN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "this",
  "that",
  "these",
  "those",
  "from",
  "into",
  "about",
  "explain",
  "tell",
  "please",
  "can",
  "could",
  "would",
  "should",
  "does",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "more",
  "next",
]);

const ZH_STOP_BIGRAMS = new Set([
  "什么",
  "怎么",
  "如何",
  "为什",
  "这个",
  "那个",
  "一下",
  "讲讲",
  "请问",
  "可以",
  "继续",
  "解释",
  "理解",
  "意思",
  "这里",
  "那里",
  "我们",
  "他们",
  "是不是",
]);

export function tokenizeMemorySearchTerms(text: string): string[] {
  if (!text || !text.trim()) return [];
  const lower = text.toLowerCase();
  const seen = new Set<string>();

  const wordMatches = lower.match(/[a-z0-9_+#-]+/g) ?? [];
  for (const raw of wordMatches) {
    const cleaned = raw.replace(/^[-_+#]+|[-_]+$/g, "");
    if (cleaned.length < 2) continue;
    if (EN_STOPWORDS.has(cleaned)) continue;
    seen.add(cleaned);
  }

  const cjkRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length <= 4 && !ZH_STOP_BIGRAMS.has(run)) {
      seen.add(run);
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (!ZH_STOP_BIGRAMS.has(bigram)) {
        seen.add(bigram);
      }
    }
  }

  return [...seen];
}

function statusRelevanceWeight(status: UserMemoryConceptStatus): number {
  if (status === "struggling") return 0.9;
  if (status === "learning") return 0.5;
  return 0.2;
}

function parseTimestamp(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function rankConceptsForQuery(
  concepts: StoredUserMemoryConcept[],
  query: string | undefined,
  maxConcepts: number,
): UserMemoryConceptItem[] {
  const limit = Math.max(0, Math.floor(maxConcepts));
  if (limit === 0 || concepts.length === 0) return [];

  const trimmedQuery = query?.trim() ?? "";
  const queryLower = trimmedQuery.toLowerCase();
  const queryTerms = trimmedQuery ? tokenizeMemorySearchTerms(trimmedQuery) : [];

  const scored = concepts.map((item) => {
    let score = statusRelevanceWeight(item.status);

    if (queryLower) {
      const conceptLower = item.concept.toLowerCase().trim();
      if (
        (conceptLower.length >= 2 && queryLower.includes(conceptLower)) ||
        (item.conceptKey.length >= 2 && queryLower.includes(item.conceptKey))
      ) {
        score += 2.0;
      }

      if (queryTerms.length > 0) {
        const targetText = `${item.concept} ${item.note}`.toLowerCase();
        const targetTerms = new Set(tokenizeMemorySearchTerms(targetText));
        let matched = 0;
        for (const term of queryTerms) {
          if (targetTerms.has(term) || targetText.includes(term)) {
            matched += 1;
          }
        }
        const overlapRatio = matched / queryTerms.length;
        score += 3.0 * overlapRatio;
      }
    }

    return { item, score };
  });

  scored.sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

    const seenDiff =
      parseTimestamp(right.item.lastSeenAt) -
      parseTimestamp(left.item.lastSeenAt);
    if (seenDiff !== 0) return seenDiff;

    return right.item.id.localeCompare(left.item.id);
  });

  return scored.slice(0, limit).map(({ item }) => ({
    concept: item.concept,
    status: item.status,
    ...(item.note.trim() ? { note: item.note.trim() } : {}),
  }));
}

function createEmptySnapshot(ownerId: string): UserMemorySnapshot {
  return {
    ownerId,
    profileSummary: "",
    preferredStyle: "",
    concepts: [],
    updatedAt: null,
  };
}

export async function getUserMemoryForOwner(
  ownerId: string,
): Promise<UserMemorySnapshot> {
  const cleanOwner = ownerId.trim();
  if (!cleanOwner) return createEmptySnapshot("");

  try {
    return await getUserMemoryRepository().getSnapshot(cleanOwner);
  } catch (error) {
    if (
      error instanceof UserMemorySchemaUnavailableError ||
      isMissingUserMemorySchemaError(error)
    ) {
      warnMemoryFailure("get-snapshot", error);
      return createEmptySnapshot(cleanOwner);
    }
    throw error;
  }
}

/**
 * Resolves a relevance-ranked `UserMemoryContextSlot` for prompt injection.
 * Always fails open (`undefined`) on errors or when no memory exists yet,
 * ensuring chat and node generation are never blocked by memory storage.
 */
export async function resolveUserMemorySlotForOwner(
  ownerId: string,
  query?: string,
  options?: { maxConcepts?: number },
): Promise<UserMemoryContextSlot | undefined> {
  const cleanOwner = ownerId?.trim();
  if (!cleanOwner) return undefined;

  try {
    const snapshot = await getUserMemoryRepository().getSnapshot(cleanOwner);
    const profileSummary = snapshot.profileSummary.trim();
    const preferredStyle = snapshot.preferredStyle.trim();
    const maxConcepts =
      options?.maxConcepts ?? DEFAULT_MEMORY_SLOT_CONCEPT_LIMIT;
    const concepts = rankConceptsForQuery(
      snapshot.concepts,
      query,
      maxConcepts,
    );

    if (!profileSummary && !preferredStyle && concepts.length === 0) {
      return undefined;
    }

    const slot: UserMemoryContextSlot = {};
    if (profileSummary) slot.profileSummary = profileSummary;
    if (preferredStyle) slot.preferredStyle = preferredStyle;
    if (concepts.length > 0) slot.concepts = concepts;
    return slot;
  } catch (error) {
    warnMemoryFailure("resolve-slot", error);
    return undefined;
  }
}

/**
 * Extracts learner profile/style hints and concept mastery signals after a
 * canvas turn completes, merging them idempotently into user memory.
 * Fails open so post-turn persistence never breaks a response.
 */
export async function recordCanvasTurnMemoryForOwner(
  input: RecordCanvasTurnMemoryInput,
): Promise<void> {
  const cleanOwner = input.ownerId?.trim();
  if (!cleanOwner) return;

  try {
    const { profileHint, styleHint } = extractProfileAndStyleSignals(
      input.instruction,
    );
    const conceptSignals = extractCanvasConceptUpdates({
      mode: input.mode,
      instruction: input.instruction,
      sourceText: input.sourceText,
      reply: input.reply,
      contextSummaries: input.contextSummaries,
    });

    const hasAnySignal = Boolean(
      profileHint ||
        styleHint ||
        conceptSignals.currentConcept ||
        conceptSignals.explicitMasteredParent ||
        conceptSignals.promoteParentIfLearning,
    );
    if (!hasAnySignal) return;

    const repo = getUserMemoryRepository();
    const snapshot = await repo.getSnapshot(cleanOwner);

    const nextProfile = profileHint
      ? mergeMemoryText(
          snapshot.profileSummary,
          profileHint,
          MAX_PROFILE_SUMMARY_CHARS,
        )
      : snapshot.profileSummary;
    const nextStyle = styleHint
      ? mergeMemoryText(
          snapshot.preferredStyle,
          styleHint,
          MAX_PREFERRED_STYLE_CHARS,
        )
      : snapshot.preferredStyle;

    if (
      nextProfile !== snapshot.profileSummary ||
      nextStyle !== snapshot.preferredStyle
    ) {
      await repo.upsertProfile(cleanOwner, {
        profileSummary: nextProfile,
        preferredStyle: nextStyle,
      });
    }

    const existingByKey = new Map<string, StoredUserMemoryConcept>();
    for (const item of snapshot.concepts) {
      existingByKey.set(item.conceptKey, item);
    }

    const updatesByKey = new Map<string, UpsertConceptInput>();
    const nowIso = new Date().toISOString();

    if (conceptSignals.explicitMasteredParent) {
      const parent = conceptSignals.explicitMasteredParent;
      const existing = existingByKey.get(parent.conceptKey);
      updatesByKey.set(parent.conceptKey, {
        concept: existing?.concept ?? parent.concept,
        conceptKey: parent.conceptKey,
        status: "mastered",
        note: existing?.note ?? "",
        sourceProjectId: input.projectId ?? existing?.sourceProjectId ?? null,
        sourceNodeId: existing?.sourceNodeId ?? null,
        evidenceCount: (existing?.evidenceCount ?? 0) + 1,
        lastSeenAt: nowIso,
      });
    } else if (conceptSignals.promoteParentIfLearning) {
      const parent = conceptSignals.promoteParentIfLearning;
      const existing = existingByKey.get(parent.conceptKey);
      if (existing) {
        if (existing.status === "learning" && existing.evidenceCount >= 1) {
          updatesByKey.set(parent.conceptKey, {
            concept: existing.concept,
            conceptKey: parent.conceptKey,
            status: "mastered",
            note: existing.note,
            sourceProjectId:
              input.projectId ?? existing.sourceProjectId ?? null,
            sourceNodeId: existing.sourceNodeId,
            evidenceCount: existing.evidenceCount + 1,
            lastSeenAt: nowIso,
          });
        } else if (existing.status === "struggling") {
          const nextStatus: UserMemoryConceptStatus =
            existing.evidenceCount >= 2 ? "learning" : "struggling";
          updatesByKey.set(parent.conceptKey, {
            concept: existing.concept,
            conceptKey: parent.conceptKey,
            status: nextStatus,
            note: existing.note,
            sourceProjectId:
              input.projectId ?? existing.sourceProjectId ?? null,
            sourceNodeId: existing.sourceNodeId,
            evidenceCount: existing.evidenceCount + 1,
            lastSeenAt: nowIso,
          });
        }
      }
    }

    if (conceptSignals.currentConcept) {
      const curr = conceptSignals.currentConcept;
      const existing = existingByKey.get(curr.conceptKey);
      const pendingParentUpdate = updatesByKey.get(curr.conceptKey);

      let resolvedStatus: UserMemoryConceptStatus;
      if (curr.status === "struggling") {
        // Explicit confusion immediately overrides `mastered` or `learning`.
        resolvedStatus = "struggling";
      } else if (curr.status === "mastered") {
        resolvedStatus = "mastered";
      } else if (pendingParentUpdate) {
        resolvedStatus = pendingParentUpdate.status;
      } else if (existing?.status === "struggling") {
        resolvedStatus = "struggling";
      } else if (existing?.status === "mastered") {
        resolvedStatus = "mastered";
      } else {
        resolvedStatus = "learning";
      }

      const resolvedNote = curr.note || existing?.note || "";
      const resolvedEvidenceCount = pendingParentUpdate?.evidenceCount
        ? pendingParentUpdate.evidenceCount
        : (existing?.evidenceCount ?? 0) + 1;

      updatesByKey.set(curr.conceptKey, {
        concept: curr.concept,
        conceptKey: curr.conceptKey,
        status: resolvedStatus,
        note: resolvedNote,
        sourceProjectId: input.projectId ?? existing?.sourceProjectId ?? null,
        sourceNodeId: input.nodeId ?? existing?.sourceNodeId ?? null,
        evidenceCount: resolvedEvidenceCount,
        lastSeenAt: nowIso,
      });
    }

    if (updatesByKey.size > 0) {
      await repo.upsertConcepts(
        cleanOwner,
        [...updatesByKey.values()],
        MAX_STORED_CONCEPTS_PER_USER,
      );
    }
  } catch (error) {
    warnMemoryFailure("record-turn", error);
  }
}

export async function updateUserMemoryForOwner(
  ownerId: string,
  patch: PatchUserMemoryInput,
): Promise<UserMemorySnapshot> {
  const cleanOwner = ownerId.trim();
  if (!cleanOwner) return createEmptySnapshot("");

  const repo = getUserMemoryRepository();

  if (patch.removeConceptIds?.length) {
    for (const id of patch.removeConceptIds) {
      await repo.deleteConcept(cleanOwner, { id });
    }
  }

  if (patch.removeConceptKeys?.length) {
    for (const conceptKey of patch.removeConceptKeys) {
      await repo.deleteConcept(cleanOwner, { conceptKey });
    }
  }

  if (
    patch.profileSummary !== undefined ||
    patch.preferredStyle !== undefined
  ) {
    await repo.upsertProfile(cleanOwner, {
      profileSummary: patch.profileSummary,
      preferredStyle: patch.preferredStyle,
    });
  }

  if (patch.upsertConcepts?.length) {
    await repo.upsertConcepts(
      cleanOwner,
      patch.upsertConcepts.map((item) => ({
        concept: item.concept,
        status: item.status,
        note: item.note ?? "",
      })),
      MAX_STORED_CONCEPTS_PER_USER,
    );
  }

  return repo.getSnapshot(cleanOwner);
}

export async function clearUserMemoryForOwner(ownerId: string): Promise<void> {
  const cleanOwner = ownerId.trim();
  if (!cleanOwner) return;
  await getUserMemoryRepository().clearOwnerMemory(cleanOwner);
}

export async function clearUserMemoryForOwnerSafe(
  ownerId: string | null | undefined,
): Promise<void> {
  const cleanOwner = ownerId?.trim();
  if (!cleanOwner) return;

  try {
    await getUserMemoryRepository().clearOwnerMemory(cleanOwner);
  } catch (error) {
    warnMemoryFailure("clear-owner", error);
  }
}

export async function transferUserMemoryOwnerSafe(
  fromOwnerId: string | null | undefined,
  toOwnerId: string | null | undefined,
): Promise<number> {
  const fromId = fromOwnerId?.trim();
  const toId = toOwnerId?.trim();
  if (!fromId || !toId || fromId === toId) return 0;

  try {
    return await getUserMemoryRepository().transferOwner(fromId, toId);
  } catch (error) {
    warnMemoryFailure("transfer-owner", error);
    return 0;
  }
}
