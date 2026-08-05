// Shared types for the agent runtime (spec §7.12/§7.13/§7.17). Row types are
// snake_case (persisted verbatim by the file backend, mapped onto Supabase
// rows); DTOs are camelCase and form the service's public contract. Pure
// types, no I/O — safe to import from both server and test code.

import type { AgentBudgetLimits, AgentRunUsage } from "@/lib/agent-runtime/agent-budget";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";

// ---------------------------------------------------------------------------
// Enums.
// ---------------------------------------------------------------------------

export type AgentType = "curriculum_builder" | "tutor";

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type AgentStepType = "model" | "tool" | "validation" | "persistence";

export type AgentStepStatus = "succeeded" | "failed";

export const ACTIVE_AGENT_RUN_STATUSES: readonly AgentRunStatus[] = ["queued", "running"];

export const TERMINAL_AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export function isTerminalAgentRunStatus(status: AgentRunStatus) {
  return TERMINAL_AGENT_RUN_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Run output structure (agent_runs.output_json). Stage artifacts are merged
// into `checkpoints` as each stage completes (spec §2.2: checkpoint after
// every successful stage); `result` is the final output set by finishRun.
// ---------------------------------------------------------------------------

export type AgentStageCheckpoint = {
  artifacts: unknown;
  completedAt: string;
};

export type AgentRunOutput = {
  checkpoints: Record<string, AgentStageCheckpoint>;
  result?: unknown;
};

// ---------------------------------------------------------------------------
// Row shapes.
// ---------------------------------------------------------------------------

export type AgentRunRow = {
  id: string;
  agent_type: AgentType;
  user_id: string;
  project_id: string | null;
  curriculum_id: string | null;
  curriculum_version_id: string | null;
  enrollment_id: string | null;
  idempotency_key: string;
  status: AgentRunStatus;
  current_stage: string | null;
  resume_from_stage: string | null;
  model_provider: string | null;
  model_id: string | null;
  input_json: unknown;
  output_json: AgentRunOutput | null;
  budget_json: AgentBudgetLimits;
  usage_json: AgentRunUsage | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

export type AgentStepRow = {
  id: string;
  run_id: string;
  step_number: number;
  stage: string;
  step_type: AgentStepType;
  tool_name: string | null;
  input_json: unknown;
  output_json: unknown | null;
  status: AgentStepStatus;
  duration_ms: number;
  usage_json: unknown | null;
  error_json: unknown | null;
  created_at: string;
};

export type AgentRunEventRow = {
  id: string;
  run_id: string;
  seq: number;
  event_json: CurriculumStreamEvent;
  created_at: string;
};

export type IdempotencyKeyRow = {
  id: string;
  user_id: string;
  endpoint: string;
  key: string;
  response_json: unknown | null;
  status_code: number | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// DTOs (camelCase public contract).
// ---------------------------------------------------------------------------

export type AgentRunDto = {
  id: string;
  agentType: AgentType;
  userId: string;
  projectId: string | null;
  curriculumId: string | null;
  curriculumVersionId: string | null;
  enrollmentId: string | null;
  idempotencyKey: string;
  status: AgentRunStatus;
  currentStage: string | null;
  resumeFromStage: string | null;
  modelProvider: string | null;
  modelId: string | null;
  input: unknown;
  output: AgentRunOutput | null;
  budget: AgentBudgetLimits;
  usage: AgentRunUsage | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type AgentStepDto = {
  id: string;
  runId: string;
  stepNumber: number;
  stage: string;
  stepType: AgentStepType;
  toolName: string | null;
  input: unknown;
  output: unknown | null;
  status: AgentStepStatus;
  durationMs: number;
  usage: unknown | null;
  error: unknown | null;
  createdAt: string;
};

export type AgentRunEventDto = {
  id: string;
  runId: string;
  seq: number;
  event: CurriculumStreamEvent;
  createdAt: string;
};

export type IdempotencyRecordDto = {
  id: string;
  userId: string;
  endpoint: string;
  key: string;
  response: unknown | null;
  statusCode: number | null;
  createdAt: string;
};
