// Persistence for the Phase 5 exercise and assessment records. The file
// backend is intentionally kept separate from the Phase 4 learning file so
// older local data remains readable; Supabase uses the same owner-scoped
// enrollment boundary as the learning repository.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import { getLearningRepository } from "@/lib/learning/learning-repository";
import { getSupabaseAdminClient, requireSupabaseServerConfig } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  CurriculumExercise,
  CurriculumExerciseRow,
  LearningAssessment,
  LearningAssessmentRow,
} from "@/lib/learning/learning-types";

export type AssessmentBackend = "file" | "supabase";

export type CreateExerciseInput = {
  curriculumVersionId: string;
  nodeId: string;
  exerciseType: CurriculumExercise["exerciseType"];
  prompt: unknown;
  rubric: unknown;
  answer?: unknown | null;
  orderIndex?: number;
};

export type CreateAssessmentInput = {
  userId: string;
  sessionId: string;
  enrollmentId: string;
  nodeId: string;
  exerciseId?: string | null;
  assessmentType: LearningAssessment["assessmentType"];
  prompt: unknown;
  answer: unknown;
  rubric: unknown;
  score: number;
  evidence: unknown;
  answerHash: string;
  agentRunId?: string | null;
  assessmentId?: string;
};

export type CreateAssessmentResult = {
  assessment: LearningAssessment;
  created: boolean;
};

export type AssessmentRepository = {
  backend: AssessmentBackend;
  createExercise(input: CreateExerciseInput): Promise<CurriculumExercise>;
  getExercise(exerciseId: string): Promise<CurriculumExercise | null>;
  getAssessmentForOwner(userId: string, assessmentId: string): Promise<LearningAssessment | null>;
  registerGeneratedExercise(input: {
    userId: string;
    sessionId: string;
    enrollmentId: string;
    nodeId: string;
    prompt: unknown;
    rubric: unknown;
  }): Promise<LearningAssessment>;
  createAssessment(input: CreateAssessmentInput): Promise<CreateAssessmentResult>;
  listAssessments(
    userId: string,
    enrollmentId: string,
    nodeId: string,
  ): Promise<LearningAssessment[]>;
};

function nowIso() {
  return new Date().toISOString();
}

function toExercise(row: CurriculumExerciseRow): CurriculumExercise {
  return {
    id: row.id,
    curriculumVersionId: row.curriculum_version_id,
    nodeId: row.node_id,
    exerciseType: row.exercise_type,
    prompt: row.prompt_json,
    rubric: row.rubric_json,
    answer: row.answer_json,
    orderIndex: row.order_index,
    createdAt: row.created_at,
  };
}

function toAssessment(row: LearningAssessmentRow): LearningAssessment {
  return {
    id: row.id,
    sessionId: row.session_id,
    enrollmentId: row.enrollment_id,
    nodeId: row.node_id,
    exerciseId: row.exercise_id,
    assessmentType: row.assessment_type,
    prompt: row.prompt_json,
    answer: row.answer_json,
    rubric: row.rubric_json,
    score: row.score,
    evidence: row.evidence_json,
    answerHash: row.answer_hash,
    agentRunId: row.agent_run_id,
    createdAt: row.created_at,
  };
}

type AssessmentDataFile = {
  version: 1;
  exercises: CurriculumExerciseRow[];
  assessments: LearningAssessmentRow[];
};

const DATA_FILE_NAME = "branchmind-learning-assessments.json";
let writeQueue: Promise<unknown> = Promise.resolve();

function getDataFilePath() {
  const override = process.env.BRANCHMIND_LEARNING_DATA_DIR?.trim();
  const curriculumOverride = process.env.BRANCHMIND_CURRICULUM_DATA_DIR?.trim();
  return path.join(
    override || curriculumOverride || path.join(process.cwd(), "data"),
    DATA_FILE_NAME,
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function asData(value: unknown): AssessmentDataFile {
  if (!value || typeof value !== "object") {
    return { version: 1, exercises: [], assessments: [] };
  }
  const record = value as Partial<AssessmentDataFile>;
  return {
    version: 1,
    exercises: Array.isArray(record.exercises) ? record.exercises : [],
    assessments: Array.isArray(record.assessments) ? record.assessments : [],
  };
}

async function readData() {
  try {
    return asData(JSON.parse(await readFile(getDataFilePath(), "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return asData(null);
    throw error;
  }
}

async function writeData(data: AssessmentDataFile) {
  const filePath = getDataFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function mutate<T>(mutator: (data: AssessmentDataFile) => T | Promise<T>) {
  const next = writeQueue.then(async () => {
    const data = await readData();
    const result = await mutator(data);
    await writeData(data);
    return result;
  });
  writeQueue = next.catch(() => undefined);
  return next;
}

async function assertOwnedEnrollment(userId: string, enrollmentId: string) {
  return getLearningRepository().getEnrollmentForUser(userId, enrollmentId);
}

const fileRepository: AssessmentRepository = {
  backend: "file",

  createExercise: async (input) =>
    mutate((data) => {
      const row: CurriculumExerciseRow = {
        id: createId("exercise"),
        curriculum_version_id: input.curriculumVersionId,
        node_id: input.nodeId,
        exercise_type: input.exerciseType,
        prompt_json: input.prompt,
        rubric_json: input.rubric,
        answer_json: input.answer ?? null,
        order_index: input.orderIndex ?? 0,
        created_at: nowIso(),
      };
      data.exercises.push(row);
      return toExercise(row);
    }),

  getExercise: async (exerciseId) => {
    const data = await readData();
    const row = data.exercises.find((entry) => entry.id === exerciseId);
    return row ? toExercise(row) : null;
  },

  getAssessmentForOwner: async (userId, assessmentId) => {
    const data = await readData();
    const row = data.assessments.find((entry) => entry.id === assessmentId);
    if (!row || !(await assertOwnedEnrollment(userId, row.enrollment_id))) return null;
    return toAssessment(row);
  },

  registerGeneratedExercise: async (input) =>
    mutate(async (data) => {
      if (!(await assertOwnedEnrollment(input.userId, input.enrollmentId))) {
        throw new Error("Learning enrollment was not found.");
      }
      const row: LearningAssessmentRow = {
        id: createId("assessment"),
        session_id: input.sessionId,
        enrollment_id: input.enrollmentId,
        node_id: input.nodeId,
        exercise_id: null,
        assessment_type: "exercise",
        prompt_json: input.prompt,
        answer_json: null,
        rubric_json: input.rubric,
        score: 0,
        evidence_json: { pending: true, source: "tutor_generated" },
        answer_hash: createId("pending-answer"),
        agent_run_id: null,
        created_at: nowIso(),
      };
      data.assessments.push(row);
      return toAssessment(row);
    }),

  createAssessment: async (input) =>
    mutate(async (data) => {
      if (!(await assertOwnedEnrollment(input.userId, input.enrollmentId))) {
        return { assessment: null, created: false };
      }
      const existingById = input.assessmentId
        ? data.assessments.find(
            (entry) =>
              entry.id === input.assessmentId && entry.enrollment_id === input.enrollmentId,
          )
        : undefined;
      if (input.assessmentId && !existingById) {
        throw new Error("Learning assessment was not found.");
      }
      const existing = data.assessments.find(
        (entry) =>
          entry.enrollment_id === input.enrollmentId &&
          entry.node_id === input.nodeId &&
          entry.exercise_id === (input.exerciseId ?? null) &&
          entry.answer_hash === input.answerHash &&
          entry.id !== input.assessmentId,
      );
      if (existing) return { assessment: toAssessment(existing), created: false };
      if (existingById) {
        if (existingById.answer_hash === input.answerHash && existingById.answer_json !== null) {
          return { assessment: toAssessment(existingById), created: false };
        }
        existingById.answer_json = input.answer;
        existingById.score = Math.max(0, Math.min(1, input.score));
        existingById.evidence_json = input.evidence;
        existingById.answer_hash = input.answerHash;
        return { assessment: toAssessment(existingById), created: true };
      }
      const row: LearningAssessmentRow = {
        id: createId("assessment"),
        session_id: input.sessionId,
        enrollment_id: input.enrollmentId,
        node_id: input.nodeId,
        exercise_id: input.exerciseId ?? null,
        assessment_type: input.assessmentType,
        prompt_json: input.prompt,
        answer_json: input.answer,
        rubric_json: input.rubric,
        score: Math.max(0, Math.min(1, input.score)),
        evidence_json: input.evidence,
        answer_hash: input.answerHash,
        agent_run_id: input.agentRunId ?? null,
        created_at: nowIso(),
      };
      data.assessments.push(row);
      return { assessment: toAssessment(row), created: true };
    }).then((result) => {
      if (!result.assessment) throw new Error("Learning enrollment was not found.");
      return result as CreateAssessmentResult;
    }),

  listAssessments: async (userId, enrollmentId, nodeId) => {
    if (!(await assertOwnedEnrollment(userId, enrollmentId))) return [];
    const data = await readData();
    return data.assessments
      .filter(
        (entry) =>
          entry.enrollment_id === enrollmentId &&
          entry.node_id === nodeId &&
          entry.answer_json !== null,
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map(toAssessment);
  },
};

type DbExerciseRow = Database["public"]["Tables"]["curriculum_exercises"]["Row"];
type DbAssessmentRow = Database["public"]["Tables"]["learning_assessments"]["Row"];

class SupabaseAssessmentRepository implements AssessmentRepository {
  backend: AssessmentBackend = "supabase";

  async createExercise(input: CreateExerciseInput) {
    const row: Database["public"]["Tables"]["curriculum_exercises"]["Insert"] = {
      id: createId("exercise"),
      curriculum_version_id: input.curriculumVersionId,
      node_id: input.nodeId,
      exercise_type: input.exerciseType,
      prompt_json: input.prompt as Json,
      rubric_json: input.rubric as Json,
      answer_json: (input.answer ?? null) as Json | null,
      order_index: input.orderIndex ?? 0,
      created_at: nowIso(),
    };
    const result = await getSupabaseAdminClient()
      .from("curriculum_exercises")
      .insert(row)
      .select()
      .single();
    if (result.error) throw new Error(`Supabase create exercise failed: ${result.error.message}`);
    return toExercise(result.data as DbExerciseRow);
  }

  async getExercise(exerciseId: string) {
    const result = await getSupabaseAdminClient()
      .from("curriculum_exercises")
      .select("*")
      .eq("id", exerciseId)
      .maybeSingle();
    if (result.error) throw new Error(`Supabase read exercise failed: ${result.error.message}`);
    return result.data ? toExercise(result.data as DbExerciseRow) : null;
  }

  async getAssessmentForOwner(userId: string, assessmentId: string) {
    const result = await getSupabaseAdminClient()
      .from("learning_assessments")
      .select("*")
      .eq("id", assessmentId)
      .eq("enrollment_id", (await getSupabaseAdminClient()
        .from("learning_assessments")
        .select("enrollment_id")
        .eq("id", assessmentId)
        .maybeSingle()).data?.enrollment_id ?? "")
      .maybeSingle();
    if (result.error) throw new Error(`Supabase read assessment failed: ${result.error.message}`);
    if (!result.data) return null;
    const owned = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .select("id")
      .eq("id", result.data.enrollment_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned.error) throw new Error(`Supabase read assessment enrollment failed: ${owned.error.message}`);
    return owned.data ? toAssessment(result.data as DbAssessmentRow) : null;
  }

  async registerGeneratedExercise(input: {
    userId: string;
    sessionId: string;
    enrollmentId: string;
    nodeId: string;
    prompt: unknown;
    rubric: unknown;
  }) {
    const owned = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .select("id")
      .eq("id", input.enrollmentId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (owned.error) throw new Error(`Supabase read enrollment failed: ${owned.error.message}`);
    if (!owned.data) throw new Error("Learning enrollment was not found.");

    const row: Database["public"]["Tables"]["learning_assessments"]["Insert"] = {
      id: createId("assessment"),
      session_id: input.sessionId,
      enrollment_id: input.enrollmentId,
      node_id: input.nodeId,
      exercise_id: null,
      assessment_type: "exercise",
      prompt_json: input.prompt as Json,
      answer_json: null,
      rubric_json: input.rubric as Json,
      score: 0,
      evidence_json: { pending: true, source: "tutor_generated" },
      answer_hash: createId("pending-answer"),
      agent_run_id: null,
      created_at: nowIso(),
    };
    const result = await getSupabaseAdminClient()
      .from("learning_assessments")
      .insert(row)
      .select()
      .single();
    if (result.error) throw new Error(`Supabase register generated exercise failed: ${result.error.message}`);
    return toAssessment(result.data as DbAssessmentRow);
  }

  async createAssessment(input: CreateAssessmentInput) {
    const owned = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .select("id")
      .eq("id", input.enrollmentId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (owned.error) throw new Error(`Supabase read enrollment failed: ${owned.error.message}`);
    if (!owned.data) throw new Error("Learning enrollment was not found.");

    const client = getSupabaseAdminClient();
    const exerciseId = input.exerciseId ?? null;
    const existingById = input.assessmentId
      ? await client
          .from("learning_assessments")
          .select("*")
          .eq("id", input.assessmentId)
          .eq("enrollment_id", input.enrollmentId)
          .maybeSingle()
      : { data: null, error: null };
    if (existingById.error) throw new Error(`Supabase read pending assessment failed: ${existingById.error.message}`);
    if (input.assessmentId && !existingById.data) throw new Error("Learning assessment was not found.");
    let existingQuery = client
      .from("learning_assessments")
      .select("*")
      .eq("enrollment_id", input.enrollmentId)
      .eq("node_id", input.nodeId)
      .eq("answer_hash", input.answerHash);
    existingQuery = exerciseId
      ? existingQuery.eq("exercise_id", exerciseId)
      : existingQuery.is("exercise_id", null);
    const existing = await existingQuery.maybeSingle();
    if (input.assessmentId) existingQuery = existingQuery.neq("id", input.assessmentId);
    if (existing.error) throw new Error(`Supabase read assessment failed: ${existing.error.message}`);
    if (existing.data) return { assessment: toAssessment(existing.data as DbAssessmentRow), created: false };

    if (existingById.data) {
      if (
        existingById.data.answer_hash === input.answerHash &&
        existingById.data.answer_json !== null
      ) {
        return { assessment: toAssessment(existingById.data as DbAssessmentRow), created: false };
      }
      const updated = await client
        .from("learning_assessments")
        .update({
          answer_json: input.answer as Json,
          score: Math.max(0, Math.min(1, input.score)),
          evidence_json: input.evidence as Json,
          answer_hash: input.answerHash,
        })
        .eq("id", input.assessmentId!)
        .eq("enrollment_id", input.enrollmentId)
        .select()
        .single();
      if (updated.error) throw new Error(`Supabase complete assessment failed: ${updated.error.message}`);
      return { assessment: toAssessment(updated.data as DbAssessmentRow), created: true };
    }

    const row: Database["public"]["Tables"]["learning_assessments"]["Insert"] = {
      id: createId("assessment"),
      session_id: input.sessionId,
      enrollment_id: input.enrollmentId,
      node_id: input.nodeId,
      exercise_id: exerciseId,
      assessment_type: input.assessmentType,
      prompt_json: input.prompt as Json,
      answer_json: input.answer as Json,
      rubric_json: input.rubric as Json,
      score: Math.max(0, Math.min(1, input.score)),
      evidence_json: input.evidence as Json,
      answer_hash: input.answerHash,
      agent_run_id: input.agentRunId ?? null,
      created_at: nowIso(),
    };
    const result = await client.from("learning_assessments").insert(row).select().single();
    if (result.error) {
      if (/duplicate|unique/i.test(result.error.message)) {
        let retryQuery = client
          .from("learning_assessments")
          .select("*")
          .eq("enrollment_id", input.enrollmentId)
          .eq("node_id", input.nodeId)
          .eq("answer_hash", input.answerHash);
        retryQuery = exerciseId
          ? retryQuery.eq("exercise_id", exerciseId)
          : retryQuery.is("exercise_id", null);
        const retry = await retryQuery.maybeSingle();
        if (!retry.error && retry.data) {
          return { assessment: toAssessment(retry.data as DbAssessmentRow), created: false };
        }
      }
      throw new Error(`Supabase create assessment failed: ${result.error.message}`);
    }
    return { assessment: toAssessment(result.data as DbAssessmentRow), created: true };
  }

  async listAssessments(userId: string, enrollmentId: string, nodeId: string) {
    const owned = await getSupabaseAdminClient()
      .from("learning_enrollments")
      .select("id")
      .eq("id", enrollmentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned.error) throw new Error(`Supabase read enrollment failed: ${owned.error.message}`);
    if (!owned.data) return [];
    const result = await getSupabaseAdminClient()
      .from("learning_assessments")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .eq("node_id", nodeId)
      .not("answer_json", "is", null)
      .order("created_at", { ascending: true });
    if (result.error) throw new Error(`Supabase list assessments failed: ${result.error.message}`);
    return (result.data ?? []).map((row) => toAssessment(row as DbAssessmentRow));
  }
}

let supabaseRepository: SupabaseAssessmentRepository | null = null;

function getConfiguredBackend(): AssessmentBackend | "auto" {
  const value = (
    process.env.BRANCHMIND_LEARNING_BACKEND ?? process.env.BRANCHMIND_CURRICULUM_BACKEND
  )?.trim().toLowerCase();
  return value === "file" || value === "supabase" ? value : "auto";
}

export function getAssessmentRepository(): AssessmentRepository {
  const backend = getConfiguredBackend();
  if (backend === "file") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true"
    ) {
      throw new Error("File assessment storage is not allowed in production.");
    }
    return fileRepository;
  }
  if (backend === "supabase" || process.env.NODE_ENV === "production") {
    requireSupabaseServerConfig();
    if (!supabaseRepository) supabaseRepository = new SupabaseAssessmentRepository();
    return supabaseRepository;
  }
  return fileRepository;
}
