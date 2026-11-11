export const MAX_PROFILE_SUMMARY_CHARS = 500;
export const MAX_PREFERRED_STYLE_CHARS = 360;
export const MAX_CONCEPT_NAME_CHARS = 120;
export const MAX_CONCEPT_NOTE_CHARS = 220;
export const MAX_STORED_CONCEPTS_PER_USER = 60;
export const DEFAULT_MEMORY_SLOT_CONCEPT_LIMIT = 8;

export type UserMemoryConceptStatus = "mastered" | "learning" | "struggling";

export type StoredUserMemoryConcept = {
  id: string;
  ownerId: string;
  conceptKey: string;
  concept: string;
  status: UserMemoryConceptStatus;
  note: string;
  sourceProjectId: string | null;
  sourceNodeId: string | null;
  evidenceCount: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type UserMemorySnapshot = {
  ownerId: string;
  profileSummary: string;
  preferredStyle: string;
  concepts: StoredUserMemoryConcept[];
  updatedAt: string | null;
};

export type UpsertConceptInput = {
  concept: string;
  conceptKey?: string;
  status: UserMemoryConceptStatus;
  note?: string;
  sourceProjectId?: string | null;
  sourceNodeId?: string | null;
  evidenceCount?: number;
  lastSeenAt?: string;
};

export type PatchUserMemoryInput = {
  profileSummary?: string;
  preferredStyle?: string;
  upsertConcepts?: Array<{
    concept: string;
    status: UserMemoryConceptStatus;
    note?: string;
  }>;
  removeConceptIds?: string[];
  removeConceptKeys?: string[];
};

export type RecordCanvasTurnMemoryInput = {
  ownerId: string;
  projectId?: string;
  nodeId?: string;
  mode: "root" | "continue" | "branch";
  instruction: string;
  sourceText?: string;
  reply: {
    title: string;
    summary: string;
  };
  contextSummaries?: string[];
};
