// AgentRunRepository (spec §7.12/§7.13/§7.17 + §11.5 idempotency) —
// persistence abstraction for agent runs, steps, stream events and API
// idempotency keys. Dual backends ("file" for local dev/tests, "supabase" for
// production) selected by getAgentRunRepository() from
// BRANCHMIND_CURRICULUM_BACKEND — curriculum, learning and agent-runs share
// ONE backend switch (impact analysis D2); auto = supabase when configured,
// file outside production, supabase required in production. The file backend
// is forbidden in production unless
// BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION=true (smoke tests only).
//
// Result-union style (same as CurriculumRepository): backends return
// `{kind: ...}` results and never throw domain errors; the service layer
// (agent-run-service.ts) maps them to AgentError with HTTP semantics.
//
// Atomicity:
// - File backend: every read-modify-write runs inside the per-process write
//   queue and the queued mutator computes the full next state before the
//   temp-file + rename swap, so precondition checks (idempotency key reuse,
//   one-active-run-per-curriculum, status transitions) hold per process and a
//   failed mutation persists nothing.
// - Supabase backend: idempotency key reuse and the one-active-run invariant
//   are backed by unique constraints (the partial unique index
//   agent_runs_one_active_per_curriculum_idx included); status transitions
//   use conditional UPDATEs (`where status in (...)`) so a lost race reads
//   back as "invalid-status" instead of corrupting state.
//
// File backend notes:
// - Persists to data/branchmind-agent-runs.json as
//   { version: 1, runs, steps, events, idempotencyKeys }.
// - BRANCHMIND_AGENT_RUNS_DATA_DIR overrides the data directory (tests).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBudgetLimits, AgentRunUsage } from "@/lib/agent-runtime/agent-budget";
import type {
  AgentRunDto,
  AgentRunEventDto,
  AgentRunEventRow,
  AgentRunOutput,
  AgentRunRow,
  AgentRunStatus,
  AgentStepDto,
  AgentStepRow,
  AgentStepStatus,
  AgentStepType,
  AgentType,
  IdempotencyKeyRow,
  IdempotencyRecordDto,
} from "@/lib/agent-runtime/agent-run-types";
import { ACTIVE_AGENT_RUN_STATUSES } from "@/lib/agent-runtime/agent-run-types";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";
import { createId } from "@/lib/ids";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
  requireSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Public contract.
// ---------------------------------------------------------------------------

export type AgentRunBackend = "file" | "supabase";

export type CreateAgentRunRecord = {
  agentType: AgentType;
  userId: string;
  projectId?: string | null;
  curriculumId?: string | null;
  curriculumVersionId?: string | null;
  enrollmentId?: string | null;
  idempotencyKey: string;
  input: unknown;
  budget: AgentBudgetLimits;
  modelProvider?: string | null;
  modelId?: string | null;
};

export type ListAgentRunsOptions = {
  sinceIso?: string;
  untilIso?: string;
  agentType?: AgentType;
  limit?: number;
};

export type CreateRunResult =
  | { kind: "created"; run: AgentRunDto }
  | { kind: "idempotent-replay"; run: AgentRunDto }
  | { kind: "active-run-conflict"; run: AgentRunDto };

export type RunTransitionResult =
  | { kind: "updated"; run: AgentRunDto }
  | { kind: "not-found" }
  | { kind: "invalid-status"; status: AgentRunStatus };

export type ResumeRunTransitionResult =
  | RunTransitionResult
  | { kind: "idempotency-key-conflict" }
  | { kind: "active-run-conflict"; run: AgentRunDto };

export type FinishRunPatch = {
  status: "succeeded" | "failed" | "cancelled";
  output?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  usage?: AgentRunUsage | null;
};

export type RecordStepInput = {
  runId: string;
  stepNumber: number;
  stage: string;
  stepType: AgentStepType;
  toolName?: string | null;
  input: unknown;
  output?: unknown | null;
  status: AgentStepStatus;
  durationMs: number;
  usage?: unknown | null;
  error?: unknown | null;
};

export type RecordStepResult =
  | { kind: "inserted"; step: AgentStepDto }
  | { kind: "run-not-found" }
  | { kind: "duplicate-step" };

export type AppendEventResult =
  | { kind: "inserted"; event: AgentRunEventDto }
  | { kind: "run-not-found" }
  | { kind: "duplicate-seq" };

export type SaveIdempotencyRecordInput = {
  userId: string;
  endpoint: string;
  key: string;
  statusCode: number;
  response: unknown;
};

export type AgentRunRepository = {
  backend: AgentRunBackend;
  createRun: (input: CreateAgentRunRecord) => Promise<CreateRunResult>;
  getRunById: (runId: string) => Promise<AgentRunDto | null>;
  getRunByIdForOwner: (ownerId: string, runId: string) => Promise<AgentRunDto | null>;
  listRunsForOwner: (ownerId: string, options?: ListAgentRunsOptions) => Promise<AgentRunDto[]>;
  getRunByIdempotencyKey: (key: string) => Promise<AgentRunDto | null>;
  startRun: (runId: string) => Promise<RunTransitionResult>;
  finishRun: (runId: string, patch: FinishRunPatch) => Promise<RunTransitionResult>;
  cancelRunForOwner: (ownerId: string, runId: string) => Promise<RunTransitionResult>;
  resumeRunForOwner: (
    ownerId: string,
    runId: string,
    newIdempotencyKey: string,
  ) => Promise<ResumeRunTransitionResult>;
  recordStep: (input: RecordStepInput) => Promise<RecordStepResult>;
  listSteps: (runId: string) => Promise<AgentStepDto[]>;
  checkpointRun: (
    runId: string,
    stage: string,
    artifacts: unknown,
    completedAt: string,
  ) => Promise<AgentRunDto | null>;
  invalidateCheckpoints: (runId: string, stages: string[]) => Promise<AgentRunDto | null>;
  appendEvent: (event: CurriculumStreamEvent) => Promise<AppendEventResult>;
  listEventsAfter: (runId: string, afterSeq: number) => Promise<AgentRunEventDto[]>;
  countRunsByUserAndTypeSince: (
    userId: string,
    agentType: AgentType,
    sinceIso: string,
  ) => Promise<number>;
  findIdempotencyRecord: (
    userId: string,
    endpoint: string,
    key: string,
  ) => Promise<IdempotencyRecordDto | null>;
  saveIdempotencyRecord: (input: SaveIdempotencyRecordInput) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Row -> DTO mapping (shared by both backends).
// ---------------------------------------------------------------------------

function toAgentRunDto(row: AgentRunRow): AgentRunDto {
  return {
    id: row.id,
    agentType: row.agent_type,
    userId: row.user_id,
    projectId: row.project_id,
    curriculumId: row.curriculum_id,
    curriculumVersionId: row.curriculum_version_id,
    enrollmentId: row.enrollment_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    currentStage: row.current_stage,
    resumeFromStage: row.resume_from_stage,
    modelProvider: row.model_provider,
    modelId: row.model_id,
    input: row.input_json,
    output: row.output_json,
    budget: row.budget_json,
    usage: row.usage_json,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function toAgentStepDto(row: AgentStepRow): AgentStepDto {
  return {
    id: row.id,
    runId: row.run_id,
    stepNumber: row.step_number,
    stage: row.stage,
    stepType: row.step_type,
    toolName: row.tool_name,
    input: row.input_json,
    output: row.output_json,
    status: row.status,
    durationMs: row.duration_ms,
    usage: row.usage_json,
    error: row.error_json,
    createdAt: row.created_at,
  };
}

function toAgentRunEventDto(row: AgentRunEventRow): AgentRunEventDto {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    event: row.event_json,
    createdAt: row.created_at,
  };
}

function toIdempotencyRecordDto(row: IdempotencyKeyRow): IdempotencyRecordDto {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    key: row.key,
    response: row.response_json,
    statusCode: row.status_code,
    createdAt: row.created_at,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function createInitialRunUsage(): AgentRunUsage {
  return {
    agentSteps: 0,
    searchQueries: 0,
    fetchedPages: 0,
    repairLoops: 0,
    sources: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    runtimeMs: 0,
  };
}

function normalizeRunOutput(value: unknown): AgentRunOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<AgentRunOutput>;
  return {
    checkpoints:
      candidate.checkpoints && typeof candidate.checkpoints === "object"
        ? candidate.checkpoints
        : {},
    ...(candidate.result !== undefined ? { result: candidate.result } : {}),
  };
}

function mergeRunOutputResult(current: AgentRunOutput | null, result: unknown): AgentRunOutput {
  return { checkpoints: { ...(current?.checkpoints ?? {}) }, result };
}

function buildRunRow(input: CreateAgentRunRecord, timestamp: string): AgentRunRow {
  return {
    id: createId("run"),
    agent_type: input.agentType,
    user_id: input.userId,
    project_id: input.projectId ?? null,
    curriculum_id: input.curriculumId ?? null,
    curriculum_version_id: input.curriculumVersionId ?? null,
    enrollment_id: input.enrollmentId ?? null,
    idempotency_key: input.idempotencyKey,
    status: "queued",
    current_stage: null,
    resume_from_stage: null,
    model_provider: input.modelProvider ?? null,
    model_id: input.modelId ?? null,
    input_json: input.input ?? {},
    output_json: { checkpoints: {} },
    budget_json: input.budget,
    usage_json: createInitialRunUsage(),
    error_code: null,
    error_message: null,
    started_at: timestamp,
    finished_at: null,
    created_at: timestamp,
  };
}

function isActiveRun(row: AgentRunRow) {
  return ACTIVE_AGENT_RUN_STATUSES.includes(row.status);
}

function findActiveRunForCurriculum(
  runs: AgentRunRow[],
  curriculumId: string,
  excludeRunId?: string,
) {
  return (
    runs.find(
      (run) =>
        run.curriculum_id === curriculumId && run.id !== excludeRunId && isActiveRun(run),
    ) ?? null
  );
}

// Applies the finish patch to a row. `output` merges into output_json.result
// so stage checkpoints survive the final write.
function applyFinishPatch(row: AgentRunRow, patch: FinishRunPatch, timestamp: string) {
  row.status = patch.status;
  row.finished_at = timestamp;
  if (patch.output !== undefined) {
    row.output_json = mergeRunOutputResult(row.output_json, patch.output);
  }
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
  if (patch.usage !== undefined) row.usage_json = patch.usage;
}

function applyResumePatch(row: AgentRunRow, newIdempotencyKey: string, timestamp: string) {
  row.status = "queued";
  row.idempotency_key = newIdempotencyKey;
  row.error_code = null;
  row.error_message = null;
  row.finished_at = null;
  row.current_stage = null;
  row.started_at = timestamp;
}

// ---------------------------------------------------------------------------
// File backend.
// ---------------------------------------------------------------------------

const DATA_FILE_NAME = "branchmind-agent-runs.json";
let writeQueue: Promise<unknown> = Promise.resolve();

function getDataFilePath() {
  const override = process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR?.trim();
  return path.join(override || path.join(process.cwd(), "data"), DATA_FILE_NAME);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

type AgentRunDataFile = {
  version: 1;
  runs: AgentRunRow[];
  steps: AgentStepRow[];
  events: AgentRunEventRow[];
  idempotencyKeys: IdempotencyKeyRow[];
};

function normalizeDataFile(value: unknown): AgentRunDataFile {
  const entry = (value ?? {}) as Partial<AgentRunDataFile>;
  return {
    version: 1,
    runs: Array.isArray(entry.runs) ? entry.runs : [],
    steps: Array.isArray(entry.steps) ? entry.steps : [],
    events: Array.isArray(entry.events) ? entry.events : [],
    idempotencyKeys: Array.isArray(entry.idempotencyKeys) ? entry.idempotencyKeys : [],
  };
}

async function readAgentRunData(): Promise<AgentRunDataFile> {
  try {
    const content = await readFile(getDataFilePath(), "utf8");
    return normalizeDataFile(JSON.parse(content));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, runs: [], steps: [], events: [], idempotencyKeys: [] };
    }
    throw error;
  }
}

async function writeAgentRunDataNow(data: AgentRunDataFile) {
  const dataFile = getDataFilePath();
  await mkdir(path.dirname(dataFile), { recursive: true });

  const tempFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempFile, dataFile);
}

function enqueueAgentRunWrite<T>(operation: () => Promise<T>) {
  const nextWrite = writeQueue.then(operation, operation);
  writeQueue = nextWrite.catch(() => undefined);
  return nextWrite;
}

// Serialized read-modify-write (the file backend's transaction semantics):
// the mutator computes the full next state or throws; the file is only
// written when it succeeds.
async function mutateAgentRunData<T>(
  mutator: (data: AgentRunDataFile) => T | Promise<T>,
): Promise<T> {
  return enqueueAgentRunWrite(async () => {
    const data = await readAgentRunData();
    const result = await mutator(data);
    await writeAgentRunDataNow(data);
    return result;
  });
}

function findRun(data: AgentRunDataFile, runId: string) {
  return data.runs.find((run) => run.id === runId) ?? null;
}

function findRunForOwner(data: AgentRunDataFile, ownerId: string, runId: string) {
  return data.runs.find((run) => run.id === runId && run.user_id === ownerId) ?? null;
}

const fileRepository: AgentRunRepository = {
  backend: "file",

  createRun: async (input) => {
    return mutateAgentRunData((data): CreateRunResult => {
      const existingByKey = data.runs.find((run) => run.idempotency_key === input.idempotencyKey);
      if (existingByKey) return { kind: "idempotent-replay", run: toAgentRunDto(existingByKey) };

      if (input.curriculumId) {
        const active = findActiveRunForCurriculum(data.runs, input.curriculumId);
        if (active) return { kind: "active-run-conflict", run: toAgentRunDto(active) };
      }

      const row = buildRunRow(input, nowIso());
      data.runs.push(row);
      return { kind: "created", run: toAgentRunDto(row) };
    });
  },

  getRunById: async (runId) => {
    const data = await readAgentRunData();
    const row = findRun(data, runId);
    return row ? toAgentRunDto(row) : null;
  },

  getRunByIdForOwner: async (ownerId, runId) => {
    const data = await readAgentRunData();
    const row = findRunForOwner(data, ownerId, runId);
    return row ? toAgentRunDto(row) : null;
  },

  listRunsForOwner: async (ownerId, options = {}) => {
    const data = await readAgentRunData();
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    return data.runs
      .filter((run) => {
        if (run.user_id !== ownerId) return false;
        if (options.agentType && run.agent_type !== options.agentType) return false;
        if (options.sinceIso && run.created_at < options.sinceIso) return false;
        if (options.untilIso && run.created_at >= options.untilIso) return false;
        return true;
      })
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit)
      .map(toAgentRunDto);
  },

  getRunByIdempotencyKey: async (key) => {
    const data = await readAgentRunData();
    const row = data.runs.find((run) => run.idempotency_key === key) ?? null;
    return row ? toAgentRunDto(row) : null;
  },

  startRun: async (runId) => {
    return mutateAgentRunData((data): RunTransitionResult => {
      const row = findRun(data, runId);
      if (!row) return { kind: "not-found" };
      if (row.status !== "queued") return { kind: "invalid-status", status: row.status };
      row.status = "running";
      return { kind: "updated", run: toAgentRunDto(row) };
    });
  },

  finishRun: async (runId, patch) => {
    return mutateAgentRunData((data): RunTransitionResult => {
      const row = findRun(data, runId);
      if (!row) return { kind: "not-found" };
      if (!isActiveRun(row)) {
        // Idempotent re-finish with the same terminal status (covers the
        // cancel-API vs runner safe-point race); anything else is a conflict.
        if (row.status === patch.status) return { kind: "updated", run: toAgentRunDto(row) };
        return { kind: "invalid-status", status: row.status };
      }
      applyFinishPatch(row, patch, nowIso());
      return { kind: "updated", run: toAgentRunDto(row) };
    });
  },

  cancelRunForOwner: async (ownerId, runId) => {
    return mutateAgentRunData((data): RunTransitionResult => {
      const row = findRunForOwner(data, ownerId, runId);
      if (!row) return { kind: "not-found" };
      // Any terminal status is a 409 (spec §8.12: only non-terminal runs can
      // be cancelled).
      if (!isActiveRun(row)) return { kind: "invalid-status", status: row.status };
      row.status = "cancelled";
      row.finished_at = nowIso();
      return { kind: "updated", run: toAgentRunDto(row) };
    });
  },

  resumeRunForOwner: async (ownerId, runId, newIdempotencyKey) => {
    return mutateAgentRunData((data): ResumeRunTransitionResult => {
      const row = findRunForOwner(data, ownerId, runId);
      if (!row) return { kind: "not-found" };
      // A retried resume with the same key replays the already-resumed run.
      if (row.idempotency_key === newIdempotencyKey) {
        return { kind: "updated", run: toAgentRunDto(row) };
      }
      if (row.status !== "failed" && row.status !== "cancelled") {
        return { kind: "invalid-status", status: row.status };
      }
      const keyOwner = data.runs.find((run) => run.idempotency_key === newIdempotencyKey);
      if (keyOwner) return { kind: "idempotency-key-conflict" };
      if (row.curriculum_id) {
        const active = findActiveRunForCurriculum(data.runs, row.curriculum_id, row.id);
        if (active) return { kind: "active-run-conflict", run: toAgentRunDto(active) };
      }
      applyResumePatch(row, newIdempotencyKey, nowIso());
      return { kind: "updated", run: toAgentRunDto(row) };
    });
  },

  recordStep: async (input) => {
    return mutateAgentRunData((data): RecordStepResult => {
      const row = findRun(data, input.runId);
      if (!row) return { kind: "run-not-found" };
      const duplicate = data.steps.some(
        (step) => step.run_id === input.runId && step.step_number === input.stepNumber,
      );
      if (duplicate) return { kind: "duplicate-step" };

      const stepRow: AgentStepRow = {
        id: createId("step"),
        run_id: input.runId,
        step_number: input.stepNumber,
        stage: input.stage,
        step_type: input.stepType,
        tool_name: input.toolName ?? null,
        input_json: input.input ?? {},
        output_json: input.output ?? null,
        status: input.status,
        duration_ms: input.durationMs,
        usage_json: input.usage ?? null,
        error_json: input.error ?? null,
        created_at: nowIso(),
      };
      data.steps.push(stepRow);
      row.current_stage = input.stage;
      return { kind: "inserted", step: toAgentStepDto(stepRow) };
    });
  },

  listSteps: async (runId) => {
    const data = await readAgentRunData();
    return data.steps
      .filter((step) => step.run_id === runId)
      .sort((left, right) => left.step_number - right.step_number)
      .map(toAgentStepDto);
  },

  checkpointRun: async (runId, stage, artifacts, completedAt) => {
    return mutateAgentRunData((data) => {
      const row = findRun(data, runId);
      if (!row) return null;
      const output = row.output_json ?? { checkpoints: {} };
      output.checkpoints = {
        ...output.checkpoints,
        [stage]: { artifacts, completedAt },
      };
      row.output_json = output;
      row.resume_from_stage = stage;
      return toAgentRunDto(row);
    });
  },

  invalidateCheckpoints: async (runId, stages) => {
    return mutateAgentRunData((data) => {
      const row = findRun(data, runId);
      if (!row) return null;
      const output = row.output_json ?? { checkpoints: {} };
      for (const stage of stages) delete output.checkpoints[stage];
      row.output_json = output;
      return toAgentRunDto(row);
    });
  },

  appendEvent: async (event) => {
    return mutateAgentRunData((data): AppendEventResult => {
      const row = findRun(data, event.runId);
      if (!row) return { kind: "run-not-found" };
      const duplicate = data.events.some(
        (entry) => entry.run_id === event.runId && entry.seq === event.seq,
      );
      if (duplicate) return { kind: "duplicate-seq" };

      const eventRow: AgentRunEventRow = {
        id: createId("event"),
        run_id: event.runId,
        seq: event.seq,
        event_json: event,
        created_at: nowIso(),
      };
      data.events.push(eventRow);
      return { kind: "inserted", event: toAgentRunEventDto(eventRow) };
    });
  },

  listEventsAfter: async (runId, afterSeq) => {
    const data = await readAgentRunData();
    return data.events
      .filter((entry) => entry.run_id === runId && entry.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq)
      .map(toAgentRunEventDto);
  },

  countRunsByUserAndTypeSince: async (userId, agentType, sinceIso) => {
    const data = await readAgentRunData();
    return data.runs.filter(
      (run) =>
        run.user_id === userId && run.agent_type === agentType && run.created_at >= sinceIso,
    ).length;
  },

  findIdempotencyRecord: async (userId, endpoint, key) => {
    const data = await readAgentRunData();
    const row =
      data.idempotencyKeys.find(
        (entry) => entry.user_id === userId && entry.endpoint === endpoint && entry.key === key,
      ) ?? null;
    return row ? toIdempotencyRecordDto(row) : null;
  },

  saveIdempotencyRecord: async (input) => {
    await mutateAgentRunData((data) => {
      const existing = data.idempotencyKeys.find(
        (entry) =>
          entry.user_id === input.userId &&
          entry.endpoint === input.endpoint &&
          entry.key === input.key,
      );
      if (existing) {
        // Replace stale records; a concurrent same-key writer simply
        // overwrites with an equivalent deterministic response.
        existing.response_json = input.response;
        existing.status_code = input.statusCode;
        existing.created_at = nowIso();
        return;
      }
      data.idempotencyKeys.push({
        id: createId("idem"),
        user_id: input.userId,
        endpoint: input.endpoint,
        key: input.key,
        response_json: input.response,
        status_code: input.statusCode,
        created_at: nowIso(),
      });
    });
  },
};

// ---------------------------------------------------------------------------
// Supabase backend.
// ---------------------------------------------------------------------------

type DbAgentRunRow = Database["public"]["Tables"]["agent_runs"]["Row"];
type DbAgentRunInsert = Database["public"]["Tables"]["agent_runs"]["Insert"];
type DbAgentStepRow = Database["public"]["Tables"]["agent_steps"]["Row"];
type DbAgentStepInsert = Database["public"]["Tables"]["agent_steps"]["Insert"];
type DbAgentRunEventRow = Database["public"]["Tables"]["agent_run_events"]["Row"];
type DbAgentRunEventInsert = Database["public"]["Tables"]["agent_run_events"]["Insert"];
type DbIdempotencyKeyRow = Database["public"]["Tables"]["idempotency_keys"]["Row"];
type DbIdempotencyKeyInsert = Database["public"]["Tables"]["idempotency_keys"]["Insert"];

const CONSTRAINT_RUN_IDEMPOTENCY_KEY = "agent_runs_idempotency_key_unique";
const CONSTRAINT_ONE_ACTIVE_RUN = "agent_runs_one_active_per_curriculum_idx";
const CONSTRAINT_STEP_NUMBER = "agent_steps_run_step_unique";
const CONSTRAINT_EVENT_SEQ = "agent_run_events_run_seq_unique";

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
  // Web-page text can contain malformed UTF-16 (usually a lone surrogate
  // copied from a remote document). PostgREST rejects that as an unsupported
  // Unicode escape while writing jsonb, so normalize it at the persistence
  // boundary rather than losing an entire agent checkpoint.
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "string"
        ? item.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
        : item,
    ),
  ) as Json;
}

function fromJsonObject(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isUniqueViolationOn(error: { code?: string; message: string }, constraint: string) {
  return error.code === "23505" && error.message.includes(constraint);
}

function isForeignKeyViolation(error: { code?: string; message: string }) {
  return error.code === "23503";
}

function fromDbRunRow(row: DbAgentRunRow): AgentRunRow {
  return {
    ...row,
    input_json: fromJsonObject(row.input_json),
    output_json: normalizeRunOutput(row.output_json),
    budget_json: fromJsonObject(row.budget_json) as AgentBudgetLimits,
    usage_json: row.usage_json ? (fromJsonObject(row.usage_json) as AgentRunUsage) : null,
    started_at: normalizeRowTimestamp(row.started_at),
    finished_at: row.finished_at ? normalizeRowTimestamp(row.finished_at) : null,
    created_at: normalizeRowTimestamp(row.created_at),
  };
}

function fromDbStepRow(row: DbAgentStepRow): AgentStepRow {
  return {
    ...row,
    status: row.status as AgentStepStatus,
    created_at: normalizeRowTimestamp(row.created_at),
  };
}

function fromDbEventRow(row: DbAgentRunEventRow): AgentRunEventRow {
  return {
    ...row,
    event_json: row.event_json as unknown as CurriculumStreamEvent,
    created_at: normalizeRowTimestamp(row.created_at),
  };
}

function fromDbIdempotencyRow(row: DbIdempotencyKeyRow): IdempotencyKeyRow {
  return { ...row, created_at: normalizeRowTimestamp(row.created_at) };
}

class SupabaseAgentRunRepository implements AgentRunRepository {
  backend: AgentRunBackend = "supabase";

  private async readRunById(runId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    assertNoError(error, "read agent run");
    return data ? fromDbRunRow(data) : null;
  }

  private async readRunByIdForOwner(ownerId: string, runId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", ownerId)
      .maybeSingle();
    assertNoError(error, "read agent run");
    return data ? fromDbRunRow(data) : null;
  }

  private async readActiveRunForCurriculum(curriculumId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .select("*")
      .eq("curriculum_id", curriculumId)
      .in("status", [...ACTIVE_AGENT_RUN_STATUSES])
      .limit(1)
      .maybeSingle();
    assertNoError(error, "read active agent run");
    return data ? fromDbRunRow(data) : null;
  }

  // Conditional status update: the WHERE clause carries the allowed source
  // statuses, so a lost race simply matches no row and the caller re-reads to
  // classify (not-found vs invalid-status).
  private async transitionStatus(
    runId: string,
    allowedFrom: AgentRunStatus[],
    patch: Database["public"]["Tables"]["agent_runs"]["Update"],
    ownerId?: string,
  ): Promise<RunTransitionResult> {
    let query = getSupabaseAdminClient()
      .from("agent_runs")
      .update(patch)
      .eq("id", runId)
      .in("status", allowedFrom);
    if (ownerId) query = query.eq("user_id", ownerId);
    const { data, error } = await query.select().maybeSingle();
    assertNoError(error, "update agent run status");
    if (data) return { kind: "updated", run: toAgentRunDto(fromDbRunRow(data)) };

    const current = ownerId
      ? await this.readRunByIdForOwner(ownerId, runId)
      : await this.readRunById(runId);
    if (!current) return { kind: "not-found" };
    return { kind: "invalid-status", status: current.status };
  }

  async createRun(input: CreateAgentRunRecord): Promise<CreateRunResult> {
    const row = buildRunRow(input, nowIso());
    const insert: DbAgentRunInsert = {
      ...row,
      input_json: toJson(row.input_json),
      output_json: null,
      budget_json: toJson(row.budget_json),
      usage_json: toJson(row.usage_json),
    };
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .insert(insert)
      .select()
      .maybeSingle();

    if (error) {
      if (isUniqueViolationOn(error, CONSTRAINT_RUN_IDEMPOTENCY_KEY)) {
        const existing = await this.getRunByIdempotencyKey(input.idempotencyKey);
        if (existing) return { kind: "idempotent-replay", run: existing };
      }
      if (isUniqueViolationOn(error, CONSTRAINT_ONE_ACTIVE_RUN) && input.curriculumId) {
        const active = await this.readActiveRunForCurriculum(input.curriculumId);
        if (active) return { kind: "active-run-conflict", run: toAgentRunDto(active) };
      }
      assertNoError(error, "create agent run");
    }
    if (!data) throw new Error("Supabase create agent run failed: no row returned.");
    return { kind: "created", run: toAgentRunDto(fromDbRunRow(data)) };
  }

  async getRunById(runId: string) {
    const row = await this.readRunById(runId);
    return row ? toAgentRunDto(row) : null;
  }

  async getRunByIdForOwner(ownerId: string, runId: string) {
    const row = await this.readRunByIdForOwner(ownerId, runId);
    return row ? toAgentRunDto(row) : null;
  }

  async listRunsForOwner(ownerId: string, options: ListAgentRunsOptions = {}) {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    let query = getSupabaseAdminClient()
      .from("agent_runs")
      .select("*")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (options.agentType) query = query.eq("agent_type", options.agentType);
    if (options.sinceIso) query = query.gte("created_at", options.sinceIso);
    if (options.untilIso) query = query.lt("created_at", options.untilIso);
    const { data, error } = await query;
    assertNoError(error, "list agent runs");
    return (data ?? []).map((row) => toAgentRunDto(fromDbRunRow(row)));
  }

  async getRunByIdempotencyKey(key: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    assertNoError(error, "read agent run by idempotency key");
    return data ? toAgentRunDto(fromDbRunRow(data)) : null;
  }

  async startRun(runId: string) {
    return this.transitionStatus(runId, ["queued"], { status: "running" });
  }

  async finishRun(runId: string, patch: FinishRunPatch): Promise<RunTransitionResult> {
    const current = await this.readRunById(runId);
    if (!current) return { kind: "not-found" };
    if (!isActiveRun(current)) {
      // Same-terminal-status re-finish is an idempotent replay (see the file
      // backend); a different terminal status is a real conflict.
      if (current.status === patch.status) {
        return { kind: "updated", run: toAgentRunDto(current) };
      }
      return { kind: "invalid-status", status: current.status };
    }

    const update: Database["public"]["Tables"]["agent_runs"]["Update"] = {
      status: patch.status,
      finished_at: nowIso(),
    };
    if (patch.output !== undefined) {
      update.output_json = toJson(mergeRunOutputResult(current.output_json, patch.output));
    }
    if (patch.errorCode !== undefined) update.error_code = patch.errorCode;
    if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage;
    if (patch.usage !== undefined) update.usage_json = toJson(patch.usage);

    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .update(update)
      .eq("id", runId)
      .in("status", [...ACTIVE_AGENT_RUN_STATUSES])
      .select()
      .maybeSingle();
    assertNoError(error, "finish agent run");
    if (data) return { kind: "updated", run: toAgentRunDto(fromDbRunRow(data)) };

    const after = await this.readRunById(runId);
    if (!after) return { kind: "not-found" };
    return { kind: "invalid-status", status: after.status };
  }

  async cancelRunForOwner(ownerId: string, runId: string) {
    // Any terminal status reads back as invalid-status -> 409 (spec §8.12).
    return this.transitionStatus(
      runId,
      [...ACTIVE_AGENT_RUN_STATUSES],
      { status: "cancelled", finished_at: nowIso() },
      ownerId,
    );
  }

  async resumeRunForOwner(
    ownerId: string,
    runId: string,
    newIdempotencyKey: string,
  ): Promise<ResumeRunTransitionResult> {
    const current = await this.readRunByIdForOwner(ownerId, runId);
    if (!current) return { kind: "not-found" };
    // A retried resume with the same key replays the already-resumed run.
    if (current.idempotency_key === newIdempotencyKey) {
      return { kind: "updated", run: toAgentRunDto(current) };
    }
    if (current.status !== "failed" && current.status !== "cancelled") {
      return { kind: "invalid-status", status: current.status };
    }
    const keyOwner = await this.getRunByIdempotencyKey(newIdempotencyKey);
    if (keyOwner) return { kind: "idempotency-key-conflict" };

    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .update({
        status: "queued",
        idempotency_key: newIdempotencyKey,
        error_code: null,
        error_message: null,
        finished_at: null,
        current_stage: null,
        started_at: nowIso(),
      })
      .eq("id", runId)
      .in("status", ["failed", "cancelled"])
      .select()
      .maybeSingle();

    if (error) {
      if (isUniqueViolationOn(error, CONSTRAINT_RUN_IDEMPOTENCY_KEY)) {
        return { kind: "idempotency-key-conflict" };
      }
      if (isUniqueViolationOn(error, CONSTRAINT_ONE_ACTIVE_RUN) && current.curriculum_id) {
        const active = await this.readActiveRunForCurriculum(current.curriculum_id);
        if (active) return { kind: "active-run-conflict", run: toAgentRunDto(active) };
      }
      assertNoError(error, "resume agent run");
    }
    if (data) return { kind: "updated", run: toAgentRunDto(fromDbRunRow(data)) };

    const after = await this.readRunByIdForOwner(ownerId, runId);
    if (!after) return { kind: "not-found" };
    return { kind: "invalid-status", status: after.status };
  }

  async recordStep(input: RecordStepInput): Promise<RecordStepResult> {
    const stepRow: AgentStepRow = {
      id: createId("step"),
      run_id: input.runId,
      step_number: input.stepNumber,
      stage: input.stage,
      step_type: input.stepType,
      tool_name: input.toolName ?? null,
      input_json: input.input ?? {},
      output_json: input.output ?? null,
      status: input.status,
      duration_ms: input.durationMs,
      usage_json: input.usage ?? null,
      error_json: input.error ?? null,
      created_at: nowIso(),
    };
    const insert: DbAgentStepInsert = {
      ...stepRow,
      input_json: toJson(stepRow.input_json),
      output_json: toJson(stepRow.output_json),
      usage_json: toJson(stepRow.usage_json),
      error_json: toJson(stepRow.error_json),
    };
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_steps")
      .insert(insert)
      .select()
      .maybeSingle();

    if (error) {
      if (isUniqueViolationOn(error, CONSTRAINT_STEP_NUMBER)) return { kind: "duplicate-step" };
      if (isForeignKeyViolation(error)) return { kind: "run-not-found" };
      assertNoError(error, "record agent step");
    }
    if (!data) throw new Error("Supabase record agent step failed: no row returned.");

    // Track the run's current stage best-effort; the step row is the durable
    // record and must not be rolled back by a stage-pointer failure.
    const stageUpdate = await getSupabaseAdminClient()
      .from("agent_runs")
      .update({ current_stage: input.stage })
      .eq("id", input.runId);
    if (stageUpdate.error) {
      console.error("BranchMind agent run stage pointer update failed", {
        runId: input.runId,
        message: stageUpdate.error.message,
      });
    }

    return { kind: "inserted", step: toAgentStepDto(fromDbStepRow(data)) };
  }

  async listSteps(runId: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_steps")
      .select("*")
      .eq("run_id", runId)
      .order("step_number", { ascending: true });
    assertNoError(error, "list agent steps");
    return (data ?? []).map((row) => toAgentStepDto(fromDbStepRow(row)));
  }

  async checkpointRun(runId: string, stage: string, artifacts: unknown, completedAt: string) {
    const current = await this.readRunById(runId);
    if (!current) return null;
    const output: AgentRunOutput = {
      checkpoints: {
        ...(current.output_json?.checkpoints ?? {}),
        [stage]: { artifacts, completedAt },
      },
      ...(current.output_json?.result !== undefined
        ? { result: current.output_json.result }
        : {}),
    };
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .update({ output_json: toJson(output), resume_from_stage: stage })
      .eq("id", runId)
      .select()
      .maybeSingle();
    assertNoError(error, "checkpoint agent run");
    return data ? toAgentRunDto(fromDbRunRow(data)) : null;
  }

  async invalidateCheckpoints(runId: string, stages: string[]) {
    const current = await this.readRunById(runId);
    if (!current) return null;
    const checkpoints = { ...(current.output_json?.checkpoints ?? {}) };
    for (const stage of stages) delete checkpoints[stage];
    const output: AgentRunOutput = {
      checkpoints,
      ...(current.output_json?.result !== undefined
        ? { result: current.output_json.result }
        : {}),
    };
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .update({ output_json: toJson(output) })
      .eq("id", runId)
      .select()
      .maybeSingle();
    assertNoError(error, "invalidate agent run checkpoints");
    return data ? toAgentRunDto(fromDbRunRow(data)) : null;
  }

  async appendEvent(event: CurriculumStreamEvent): Promise<AppendEventResult> {
    const insert: DbAgentRunEventInsert = {
      id: createId("event"),
      run_id: event.runId,
      seq: event.seq,
      event_json: toJson(event),
      created_at: nowIso(),
    };
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_run_events")
      .insert(insert)
      .select()
      .maybeSingle();

    if (error) {
      if (isUniqueViolationOn(error, CONSTRAINT_EVENT_SEQ)) return { kind: "duplicate-seq" };
      if (isForeignKeyViolation(error)) return { kind: "run-not-found" };
      assertNoError(error, "append agent run event");
    }
    if (!data) throw new Error("Supabase append agent run event failed: no row returned.");
    const row: DbAgentRunEventRow = data;
    return { kind: "inserted", event: toAgentRunEventDto(fromDbEventRow(row)) };
  }

  async listEventsAfter(runId: string, afterSeq: number) {
    const { data, error } = await getSupabaseAdminClient()
      .from("agent_run_events")
      .select("*")
      .eq("run_id", runId)
      .gt("seq", afterSeq)
      .order("seq", { ascending: true });
    assertNoError(error, "list agent run events");
    return (data ?? []).map((row) => toAgentRunEventDto(fromDbEventRow(row)));
  }

  async countRunsByUserAndTypeSince(userId: string, agentType: AgentType, sinceIso: string) {
    const { count, error } = await getSupabaseAdminClient()
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("agent_type", agentType)
      .gte("created_at", sinceIso);
    assertNoError(error, "count agent runs");
    return count ?? 0;
  }

  async findIdempotencyRecord(userId: string, endpoint: string, key: string) {
    const { data, error } = await getSupabaseAdminClient()
      .from("idempotency_keys")
      .select("*")
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .eq("key", key)
      .maybeSingle();
    assertNoError(error, "read idempotency record");
    return data ? toIdempotencyRecordDto(fromDbIdempotencyRow(data)) : null;
  }

  async saveIdempotencyRecord(input: SaveIdempotencyRecordInput) {
    const upsert: DbIdempotencyKeyInsert = {
      id: createId("idem"),
      user_id: input.userId,
      endpoint: input.endpoint,
      key: input.key,
      response_json: toJson(input.response),
      status_code: input.statusCode,
      created_at: nowIso(),
    };
    // Upsert on the dedup key: a stale (>24h) record is replaced; a
    // concurrent same-key writer simply overwrites with an equivalent
    // deterministic response (the unique constraint keeps it to one row).
    const { error } = await getSupabaseAdminClient()
      .from("idempotency_keys")
      .upsert(upsert, { onConflict: "user_id,endpoint,key" });
    assertNoError(error, "save idempotency record");
  }
}

const supabaseRepository = new SupabaseAgentRunRepository();

// ---------------------------------------------------------------------------
// Backend selection (same rules as getCurriculumRepository, reading the SAME
// BRANCHMIND_CURRICULUM_BACKEND switch — impact analysis D2).
// ---------------------------------------------------------------------------

function getConfiguredBackend(): AgentRunBackend | "auto" {
  const value = process.env.BRANCHMIND_CURRICULUM_BACKEND?.trim().toLowerCase();
  if (value === "file" || value === "supabase") return value;
  return "auto";
}

export function getAgentRunRepository(): AgentRunRepository {
  const backend = getConfiguredBackend();

  if (backend === "file") {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true"
    ) {
      throw new Error("File agent-run storage is not allowed in production.");
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
