// Owner-scoped persistence for the Phase 4 learning domain. The repository is
// deliberately separate from curriculum storage: learners may read a
// published curriculum without owning its authoring rows, while every
// enrollment/session/message/progress row remains scoped to the learner.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import { getSupabaseAdminClient, requireSupabaseServerConfig } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { CurriculumNodeStatus } from "@/lib/curriculum/curriculum-types";
import type {
  LearningEnrollment,
  LearningEnrollmentRow,
  LearningMessage,
  LearningMessageRole,
  LearningMessageRow,
  LearningNodeProgress,
  LearningNodeProgressRow,
  LearningSession,
  LearningSessionRow,
} from "@/lib/learning/learning-types";

export type LearningBackend = "file" | "supabase";

export type ProgressPatch = {
  status?: CurriculumNodeStatus;
  // Phase 4 stores proposals/evidence for audit, but does not accept a model
  // mastery score as an authoritative progress update.
  lastEvidence?: unknown;
  masteryScore?: number;
  attemptCount?: number;
  lastAssessedAt?: string | null;
  nextReviewAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type CreateMessageInput = {
  role: LearningMessageRole;
  blocks: unknown;
  agentRunId?: string | null;
};

export type EnrollmentMigrationProgressInput = {
  fromNodeId: string;
  toNodeId: string;
  status: CurriculumNodeStatus;
  masteryScore: number;
  attemptCount: number;
  lastEvidence: unknown;
  lastAssessedAt: string | null;
  nextReviewAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type LearningRepository = {
  backend: LearningBackend;
  createEnrollment(
    userId: string,
    input: { curriculumId: string; curriculumVersionId: string },
  ): Promise<LearningEnrollment>;
  getEnrollmentForUser(userId: string, enrollmentId: string): Promise<LearningEnrollment | null>;
  findEnrollmentForVersion(
    userId: string,
    curriculumVersionId: string,
  ): Promise<LearningEnrollment | null>;
  updateEnrollmentCurrentNode(
    userId: string,
    enrollmentId: string,
    currentNodeId: string | null,
  ): Promise<LearningEnrollment | null>;
  migrateEnrollment(
    userId: string,
    enrollmentId: string,
    targetVersionId: string,
    progress: EnrollmentMigrationProgressInput[],
    targetCurrentNodeId?: string | null,
  ): Promise<LearningEnrollment | null>;
  listProgress(userId: string, enrollmentId: string): Promise<LearningNodeProgress[]>;
  upsertProgress(
    userId: string,
    enrollmentId: string,
    nodeId: string,
    patch: ProgressPatch,
  ): Promise<LearningNodeProgress | null>;
  getOrCreateSession(
    userId: string,
    enrollmentId: string,
    input: { nodeId?: string | null; skillId?: string | null },
  ): Promise<LearningSession | null>;
  listRecentMessages(
    userId: string,
    enrollmentId: string,
    limit: number,
    sessionId?: string,
  ): Promise<LearningMessage[]>;
  updateSessionSummary(
    userId: string,
    enrollmentId: string,
    sessionId: string,
    summary: string,
  ): Promise<LearningSession | null>;
  appendMessages(
    userId: string,
    enrollmentId: string,
    sessionId: string,
    messages: CreateMessageInput[],
  ): Promise<LearningMessage[]>;
};

function nowIso() {
  return new Date().toISOString();
}

function toEnrollment(row: LearningEnrollmentRow): LearningEnrollment {
  return {
    id: row.id,
    userId: row.user_id,
    curriculumId: row.curriculum_id,
    curriculumVersionId: row.curriculum_version_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProgress(row: LearningNodeProgressRow): LearningNodeProgress {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    nodeId: row.node_id,
    status: row.status,
    masteryScore: row.mastery_score,
    attemptCount: row.attempt_count,
    lastEvidence: row.last_evidence_json,
    lastAssessedAt: row.last_assessed_at,
    nextReviewAt: row.next_review_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: LearningSessionRow): LearningSession {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    nodeId: row.node_id,
    skillId: row.skill_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function toMessage(row: LearningMessageRow): LearningMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    enrollmentId: row.enrollment_id,
    role: row.role,
    blocks: row.blocks_json,
    agentRunId: row.agent_run_id,
    createdAt: row.created_at,
  };
}

type LearningDataFile = {
  version: 1;
  enrollments: LearningEnrollmentRow[];
  progress: LearningNodeProgressRow[];
  sessions: LearningSessionRow[];
  messages: LearningMessageRow[];
};

const DATA_FILE_NAME = "branchmind-learning.json";
let writeQueue: Promise<unknown> = Promise.resolve();

function getDataFilePath() {
  const override = process.env.BRANCHMIND_LEARNING_DATA_DIR?.trim();
  const curriculumOverride = process.env.BRANCHMIND_CURRICULUM_DATA_DIR?.trim();
  return path.join(override || curriculumOverride || path.join(process.cwd(), "data"), DATA_FILE_NAME);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function asLearningData(value: unknown): LearningDataFile {
  if (!value || typeof value !== "object") {
    return { version: 1, enrollments: [], progress: [], sessions: [], messages: [] };
  }
  const record = value as Partial<LearningDataFile>;
  return {
    version: 1,
    enrollments: Array.isArray(record.enrollments) ? record.enrollments : [],
    progress: Array.isArray(record.progress) ? record.progress : [],
    sessions: Array.isArray(record.sessions) ? record.sessions : [],
    messages: Array.isArray(record.messages) ? record.messages : [],
  };
}

async function readLearningData() {
  try {
    return asLearningData(JSON.parse(await readFile(getDataFilePath(), "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return asLearningData(null);
    }
    throw error;
  }
}

async function writeLearningData(data: LearningDataFile) {
  const filePath = getDataFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function mutateLearningData<T>(mutator: (data: LearningDataFile) => T | Promise<T>) {
  const next = writeQueue.then(async () => {
    const data = await readLearningData();
    const result = await mutator(data);
    await writeLearningData(data);
    return result;
  });
  writeQueue = next.catch(() => undefined);
  return next;
}

function findEnrollment(
  data: LearningDataFile,
  userId: string,
  enrollmentId: string,
) {
  return data.enrollments.find((row) => row.id === enrollmentId && row.user_id === userId) ?? null;
}

function findProgress(data: LearningDataFile, enrollmentId: string, nodeId: string) {
  return data.progress.find(
    (row) => row.enrollment_id === enrollmentId && row.node_id === nodeId,
  ) ?? null;
}

const fileRepository: LearningRepository = {
  backend: "file",

  createEnrollment: async (userId, input) =>
    mutateLearningData((data) => {
      const existing = data.enrollments.find(
        (row) =>
          row.user_id === userId && row.curriculum_version_id === input.curriculumVersionId,
      );
      if (existing) return toEnrollment(existing);
      const timestamp = nowIso();
      const row: LearningEnrollmentRow = {
        id: createId("enrollment"),
        user_id: userId,
        curriculum_id: input.curriculumId,
        curriculum_version_id: input.curriculumVersionId,
        status: "active",
        current_node_id: null,
        started_at: timestamp,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      };
      data.enrollments.push(row);
      return toEnrollment(row);
    }),

  getEnrollmentForUser: async (userId, enrollmentId) => {
    const data = await readLearningData();
    const row = findEnrollment(data, userId, enrollmentId);
    return row ? toEnrollment(row) : null;
  },

  findEnrollmentForVersion: async (userId, curriculumVersionId) => {
    const data = await readLearningData();
    const row = data.enrollments.find(
      (entry) => entry.user_id === userId && entry.curriculum_version_id === curriculumVersionId,
    );
    return row ? toEnrollment(row) : null;
  },

  updateEnrollmentCurrentNode: async (userId, enrollmentId, currentNodeId) =>
    mutateLearningData((data) => {
      const row = findEnrollment(data, userId, enrollmentId);
      if (!row) return null;
      row.current_node_id = currentNodeId;
      row.updated_at = nowIso();
      return toEnrollment(row);
    }),

  migrateEnrollment: async (
    userId,
    enrollmentId,
    targetVersionId,
    progress,
    targetCurrentNodeId = null,
  ) =>
    mutateLearningData((data) => {
      const enrollment = findEnrollment(data, userId, enrollmentId);
      if (!enrollment) return null;
      const timestamp = nowIso();
      enrollment.curriculum_version_id = targetVersionId;
      enrollment.current_node_id = targetCurrentNodeId;
      enrollment.updated_at = timestamp;

      for (const entry of progress) {
        const existing = findProgress(data, enrollmentId, entry.toNodeId);
        const row = existing ?? {
          id: createId("node-progress"),
          enrollment_id: enrollmentId,
          node_id: entry.toNodeId,
          status: entry.status,
          mastery_score: entry.masteryScore,
          attempt_count: entry.attemptCount,
          last_evidence_json: entry.lastEvidence,
          last_assessed_at: entry.lastAssessedAt,
          next_review_at: entry.nextReviewAt,
          started_at: entry.startedAt,
          completed_at: entry.completedAt,
          updated_at: timestamp,
        } satisfies LearningNodeProgressRow;
        if (existing) {
          existing.status = entry.status;
          existing.mastery_score = entry.masteryScore;
          existing.attempt_count = entry.attemptCount;
          existing.last_evidence_json = entry.lastEvidence;
          existing.last_assessed_at = entry.lastAssessedAt;
          existing.next_review_at = entry.nextReviewAt;
          existing.started_at = entry.startedAt;
          existing.completed_at = entry.completedAt;
          existing.updated_at = timestamp;
        } else {
          data.progress.push(row);
        }
      }
      return toEnrollment(enrollment);
    }),

  listProgress: async (userId, enrollmentId) => {
    const data = await readLearningData();
    if (!findEnrollment(data, userId, enrollmentId)) return [];
    return data.progress
      .filter((row) => row.enrollment_id === enrollmentId)
      .sort((left, right) => left.node_id.localeCompare(right.node_id))
      .map(toProgress);
  },

  upsertProgress: async (userId, enrollmentId, nodeId, patch) =>
    mutateLearningData((data) => {
      if (!findEnrollment(data, userId, enrollmentId)) return null;
      const timestamp = nowIso();
      let row = findProgress(data, enrollmentId, nodeId);
      if (!row) {
        row = {
          id: createId("node-progress"),
          enrollment_id: enrollmentId,
          node_id: nodeId,
          status: patch.status ?? "locked",
          mastery_score: patch.masteryScore ?? 0,
          attempt_count: patch.attemptCount ?? 0,
          last_evidence_json: patch.lastEvidence ?? null,
          last_assessed_at: patch.lastAssessedAt ?? null,
          next_review_at: patch.nextReviewAt ?? null,
          started_at: patch.startedAt ?? null,
          completed_at: patch.completedAt ?? null,
          updated_at: timestamp,
        };
        data.progress.push(row);
      } else {
        if (patch.status !== undefined) row.status = patch.status;
        if (patch.lastEvidence !== undefined) row.last_evidence_json = patch.lastEvidence;
        if (patch.masteryScore !== undefined) row.mastery_score = patch.masteryScore;
        if (patch.attemptCount !== undefined) row.attempt_count = patch.attemptCount;
        if (patch.lastAssessedAt !== undefined) row.last_assessed_at = patch.lastAssessedAt;
        if (patch.nextReviewAt !== undefined) row.next_review_at = patch.nextReviewAt;
        if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
        if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
        row.updated_at = timestamp;
      }
      return toProgress(row);
    }),

  getOrCreateSession: async (userId, enrollmentId, input) =>
    mutateLearningData((data) => {
      if (!findEnrollment(data, userId, enrollmentId)) return null;
      const active = data.sessions
        .filter((row) => row.enrollment_id === enrollmentId && row.status === "active")
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
      if (active && active.node_id === (input.nodeId ?? null) && active.skill_id === (input.skillId ?? null)) {
        return toSession(active);
      }
      const timestamp = nowIso();
      const row: LearningSessionRow = {
        id: createId("learning-session"),
        enrollment_id: enrollmentId,
        node_id: input.nodeId ?? null,
        skill_id: input.skillId ?? null,
        status: "active",
        started_at: timestamp,
        ended_at: null,
        summary: "",
        created_at: timestamp,
      };
      data.sessions.push(row);
      return toSession(row);
    }),

  listRecentMessages: async (userId, enrollmentId, limit, sessionId) => {
    const data = await readLearningData();
    if (!findEnrollment(data, userId, enrollmentId)) return [];
    return data.messages
      .filter((row) => row.enrollment_id === enrollmentId && (!sessionId || row.session_id === sessionId))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(-Math.max(1, Math.min(50, limit)))
      .map(toMessage);
  },

  updateSessionSummary: async (userId, enrollmentId, sessionId, summary) =>
    mutateLearningData((data) => {
      if (!findEnrollment(data, userId, enrollmentId)) return null;
      const session = data.sessions.find(
        (row) => row.id === sessionId && row.enrollment_id === enrollmentId,
      );
      if (!session) return null;
      session.summary = summary;
      return toSession(session);
    }),

  appendMessages: async (userId, enrollmentId, sessionId, messages) =>
    mutateLearningData((data) => {
      if (!findEnrollment(data, userId, enrollmentId)) return [];
      const session = data.sessions.find(
        (row) => row.id === sessionId && row.enrollment_id === enrollmentId,
      );
      if (!session) return [];
      const rows = messages.map((message) => ({
        id: createId("learning-message"),
        session_id: sessionId,
        enrollment_id: enrollmentId,
        role: message.role,
        blocks_json: message.blocks,
        agent_run_id: message.agentRunId ?? null,
        created_at: nowIso(),
      } satisfies LearningMessageRow));
      data.messages.push(...rows);
      return rows.map(toMessage);
    }),
};

type DbEnrollmentRow = Database["public"]["Tables"]["learning_enrollments"]["Row"];
type DbProgressRow = Database["public"]["Tables"]["learning_node_progress"]["Row"];
type DbSessionRow = Database["public"]["Tables"]["learning_sessions"]["Row"];
type DbMessageRow = Database["public"]["Tables"]["learning_messages"]["Row"];

function dbError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function fromDbEnrollment(row: DbEnrollmentRow): LearningEnrollment {
  return toEnrollment(row as LearningEnrollmentRow);
}
function fromDbProgress(row: DbProgressRow): LearningNodeProgress {
  return toProgress(row as LearningNodeProgressRow);
}
function fromDbSession(row: DbSessionRow): LearningSession {
  return toSession(row as LearningSessionRow);
}
function fromDbMessage(row: DbMessageRow): LearningMessage {
  return toMessage(row as LearningMessageRow);
}

class SupabaseLearningRepository implements LearningRepository {
  backend: LearningBackend = "supabase";

  async createEnrollment(userId: string, input: { curriculumId: string; curriculumVersionId: string }) {
    const client = getSupabaseAdminClient();
    const existing = await this.findEnrollmentForVersion(userId, input.curriculumVersionId);
    if (existing) return existing;
    const timestamp = nowIso();
    const row: Database["public"]["Tables"]["learning_enrollments"]["Insert"] = {
      id: createId("enrollment"),
      user_id: userId,
      curriculum_id: input.curriculumId,
      curriculum_version_id: input.curriculumVersionId,
      status: "active",
      current_node_id: null,
      started_at: timestamp,
      completed_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const result = await client.from("learning_enrollments").insert(row).select().maybeSingle();
    if (result.error && /duplicate|unique/i.test(result.error.message)) {
      const retry = await this.findEnrollmentForVersion(userId, input.curriculumVersionId);
      if (retry) return retry;
    }
    dbError(result.error, "create learning enrollment");
    if (!result.data) throw new Error("Supabase create learning enrollment returned no row.");
    return fromDbEnrollment(result.data);
  }

  async getEnrollmentForUser(userId: string, enrollmentId: string) {
    const result = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .eq("user_id", userId)
      .maybeSingle();
    dbError(result.error, "read learning enrollment");
    return result.data ? fromDbEnrollment(result.data) : null;
  }

  async findEnrollmentForVersion(userId: string, curriculumVersionId: string) {
    const result = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .select("*")
      .eq("user_id", userId)
      .eq("curriculum_version_id", curriculumVersionId)
      .maybeSingle();
    dbError(result.error, "find learning enrollment");
    return result.data ? fromDbEnrollment(result.data) : null;
  }

  async updateEnrollmentCurrentNode(userId: string, enrollmentId: string, currentNodeId: string | null) {
    const result = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .update({ current_node_id: currentNodeId, updated_at: nowIso() })
      .eq("id", enrollmentId)
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    dbError(result.error, "update learning enrollment");
    return result.data ? fromDbEnrollment(result.data) : null;
  }

  async migrateEnrollment(
    userId: string,
    enrollmentId: string,
    targetVersionId: string,
    progress: EnrollmentMigrationProgressInput[],
    targetCurrentNodeId = null,
  ) {
    const client = getSupabaseAdminClient();
    const owned = await client
      .from("learning_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .eq("user_id", userId)
      .maybeSingle();
    dbError(owned.error, "read learning enrollment for migration");
    if (!owned.data) return null;

    const updated = await client
      .from("learning_enrollments")
      .update({
        curriculum_version_id: targetVersionId,
        current_node_id: targetCurrentNodeId,
        updated_at: nowIso(),
      })
      .eq("id", enrollmentId)
      .eq("user_id", userId)
      .select()
      .single();
    dbError(updated.error, "migrate learning enrollment");

    for (const entry of progress) {
      const row: Database["public"]["Tables"]["learning_node_progress"]["Insert"] = {
        id: createId("node-progress"),
        enrollment_id: enrollmentId,
        node_id: entry.toNodeId,
        status: entry.status,
        mastery_score: entry.masteryScore,
        attempt_count: entry.attemptCount,
        last_evidence_json: entry.lastEvidence as Json,
        last_assessed_at: entry.lastAssessedAt,
        next_review_at: entry.nextReviewAt,
        started_at: entry.startedAt,
        completed_at: entry.completedAt,
        updated_at: nowIso(),
      };
      const saved = await client.from("learning_node_progress").upsert(row, {
        onConflict: "enrollment_id,node_id",
      });
      dbError(saved.error, "migrate learning node progress");
    }

    return updated.data ? fromDbEnrollment(updated.data) : null;
  }

  async listProgress(userId: string, enrollmentId: string) {
    if (!(await this.getEnrollmentForUser(userId, enrollmentId))) return [];
    const result = await getSupabaseAdminClient()
      .from("learning_node_progress")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .order("updated_at", { ascending: true });
    dbError(result.error, "list learning node progress");
    return (result.data ?? []).map(fromDbProgress);
  }

  async upsertProgress(userId: string, enrollmentId: string, nodeId: string, patch: ProgressPatch) {
    if (!(await this.getEnrollmentForUser(userId, enrollmentId))) return null;
    const client = getSupabaseAdminClient();
    const current = await client
      .from("learning_node_progress")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .eq("node_id", nodeId)
      .maybeSingle();
    dbError(current.error, "read learning node progress");
    const timestamp = nowIso();
    const next: Database["public"]["Tables"]["learning_node_progress"]["Insert"] = {
      id: current.data?.id ?? createId("node-progress"),
      enrollment_id: enrollmentId,
      node_id: nodeId,
      status: patch.status ?? current.data?.status ?? "locked",
      mastery_score: patch.masteryScore ?? current.data?.mastery_score ?? 0,
      attempt_count: patch.attemptCount ?? current.data?.attempt_count ?? 0,
      last_evidence_json: (patch.lastEvidence ?? current.data?.last_evidence_json ?? null) as Json,
      last_assessed_at: patch.lastAssessedAt !== undefined ? patch.lastAssessedAt : current.data?.last_assessed_at ?? null,
      next_review_at: patch.nextReviewAt !== undefined ? patch.nextReviewAt : current.data?.next_review_at ?? null,
      started_at: patch.startedAt !== undefined ? patch.startedAt : current.data?.started_at ?? null,
      completed_at: patch.completedAt !== undefined ? patch.completedAt : current.data?.completed_at ?? null,
      updated_at: timestamp,
    };
    const result = await client.from("learning_node_progress").upsert(next, {
      onConflict: "enrollment_id,node_id",
    }).select().single();
    dbError(result.error, "upsert learning node progress");
    return result.data ? fromDbProgress(result.data) : null;
  }

  async getOrCreateSession(userId: string, enrollmentId: string, input: { nodeId?: string | null; skillId?: string | null }) {
    if (!(await this.getEnrollmentForUser(userId, enrollmentId))) return null;
    const client = getSupabaseAdminClient();
    const active = await client
      .from("learning_sessions")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dbError(active.error, "read active learning session");
    if (active.data && active.data.node_id === (input.nodeId ?? null) && active.data.skill_id === (input.skillId ?? null)) {
      return fromDbSession(active.data);
    }
    const timestamp = nowIso();
    const row: Database["public"]["Tables"]["learning_sessions"]["Insert"] = {
      id: createId("learning-session"),
      enrollment_id: enrollmentId,
      node_id: input.nodeId ?? null,
      skill_id: input.skillId ?? null,
      status: "active",
      started_at: timestamp,
      ended_at: null,
      summary: "",
      created_at: timestamp,
    };
    const result = await client.from("learning_sessions").insert(row).select().single();
    dbError(result.error, "create learning session");
    return result.data ? fromDbSession(result.data) : null;
  }

  async listRecentMessages(userId: string, enrollmentId: string, limit: number, sessionId?: string) {
    if (!(await this.getEnrollmentForUser(userId, enrollmentId))) return [];
    let query = getSupabaseAdminClient()
      .from("learning_messages")
      .select("*")
      .eq("enrollment_id", enrollmentId);
    query = sessionId ? query.eq("session_id", sessionId) : query;
    const result = await query
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(50, limit)));
    dbError(result.error, "list learning messages");
    return (result.data ?? []).reverse().map(fromDbMessage);
  }

  async updateSessionSummary(userId: string, enrollmentId: string, sessionId: string, summary: string) {
    if (!(await this.getEnrollmentForUser(userId, enrollmentId))) return null;
    const result = await getSupabaseAdminClient()
      .from("learning_sessions")
      .update({ summary })
      .eq("id", sessionId)
      .eq("enrollment_id", enrollmentId)
      .select()
      .maybeSingle();
    dbError(result.error, "update learning session summary");
    return result.data ? fromDbSession(result.data) : null;
  }

  async appendMessages(userId: string, enrollmentId: string, sessionId: string, messages: CreateMessageInput[]) {
    if (!(await this.getEnrollmentForUser(userId, enrollmentId))) return [];
    const rows: Database["public"]["Tables"]["learning_messages"]["Insert"][] = messages.map((message) => ({
      id: createId("learning-message"),
      session_id: sessionId,
      enrollment_id: enrollmentId,
      role: message.role,
      blocks_json: message.blocks as Json,
      agent_run_id: message.agentRunId ?? null,
      created_at: nowIso(),
    }));
    if (rows.length === 0) return [];
    const result = await getSupabaseAdminClient().from("learning_messages").insert(rows).select();
    dbError(result.error, "append learning messages");
    return (result.data ?? []).map(fromDbMessage);
  }
}

let supabaseRepository: SupabaseLearningRepository | null = null;
function getSupabaseRepository() {
  if (!supabaseRepository) supabaseRepository = new SupabaseLearningRepository();
  return supabaseRepository;
}

function getConfiguredBackend(): LearningBackend | "auto" {
  const value = process.env.BRANCHMIND_CURRICULUM_BACKEND?.trim().toLowerCase();
  return value === "file" || value === "supabase" ? value : "auto";
}

export function getLearningRepository(): LearningRepository {
  const backend = getConfiguredBackend();
  if (backend === "file") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true"
    ) {
      throw new Error("File learning storage is not allowed in production.");
    }
    return fileRepository;
  }
  if (backend === "supabase") {
    requireSupabaseServerConfig();
    return getSupabaseRepository();
  }
  if (process.env.NODE_ENV === "production") {
    requireSupabaseServerConfig();
    return getSupabaseRepository();
  }
  return fileRepository;
}
