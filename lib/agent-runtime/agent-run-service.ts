// Agent run service (spec §7.12/§7.13/§7.17, §8.11/§8.12) — the semantic API
// runners and routes use. Maps repository result unions to AgentError with
// HTTP semantics (404 not-found, 409 conflicts), mirroring the
// requireOwnedDocument / *ForOwner patterns of the RAG and curriculum layers.
// Persistence itself lives in agent-run-repository.ts (dual file/supabase
// backends behind getAgentRunRepository()).

import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { summarizeTelemetryValue } from "@/lib/agent-runtime/agent-usage";
import { incrementDailyAgentUsage } from "@/lib/server/ai-usage";
import {
  getAgentRunRepository,
  type CreateAgentRunRecord,
  type FinishRunPatch,
  type RecordStepInput,
  type ResumeRunTransitionResult,
  type RunTransitionResult,
} from "@/lib/agent-runtime/agent-run-repository";
import type {
  AgentRunDto,
  AgentRunEventDto,
  AgentStageCheckpoint,
  AgentStepDto,
  AgentType,
} from "@/lib/agent-runtime/agent-run-types";
import { ACTIVE_AGENT_RUN_STATUSES } from "@/lib/agent-runtime/agent-run-types";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";

function runNotFound(runId: string): never {
  throw new AgentError(`Agent run ${runId} was not found.`, {
    code: "AGENT_RUN_NOT_FOUND",
    expose: true,
    status: 404,
  });
}

function runConflict(message: string, details?: unknown): never {
  throw new AgentError(message, {
    code: "AGENT_RUN_CONFLICT",
    expose: true,
    status: 409,
    details,
  });
}

function mapTransition(runId: string, result: RunTransitionResult): AgentRunDto {
  if (result.kind === "updated") return result.run;
  if (result.kind === "not-found") runNotFound(runId);
  return runConflict(`Agent run ${runId} cannot transition from status "${result.status}".`, {
    status: result.status,
  });
}

// Creates a run. A reused idempotency key returns the existing run
// (created: false) instead of failing (spec §11.5); an active (queued or
// running) run for the same curriculum is a 409 conflict (spec §7.12).
export async function createRun(
  input: CreateAgentRunRecord,
): Promise<{ run: AgentRunDto; created: boolean }> {
  const result = await getAgentRunRepository().createRun(input);
  if (result.kind === "created") return { run: result.run, created: true };
  if (result.kind === "idempotent-replay") return { run: result.run, created: false };
  return runConflict(
    `Curriculum ${input.curriculumId} already has an active agent run (${result.run.id}).`,
    { activeRunId: result.run.id },
  );
}

// queued -> running.
export async function startRun(runId: string): Promise<AgentRunDto> {
  return mapTransition(runId, await getAgentRunRepository().startRun(runId));
}

// Persists one completed step (spec §7.13) and advances the run's stage
// pointer. Duplicate (run_id, step_number) is a 409 — step numbers come from
// the runner's own counter, so a duplicate indicates a runner bug or replay.
export async function completeStep(input: RecordStepInput): Promise<AgentStepDto> {
  const result = await getAgentRunRepository().recordStep({
    ...input,
    input: summarizeTelemetryValue(input.input),
    output: summarizeTelemetryValue(input.output),
    error: summarizeTelemetryValue(input.error),
  });
  if (result.kind === "inserted") return result.step;
  if (result.kind === "run-not-found") runNotFound(input.runId);
  return runConflict(
    `Agent run ${input.runId} already has step ${input.stepNumber}.`,
    { stepNumber: input.stepNumber },
  );
}

// Checkpoints a finished stage (spec §2.2: artifacts land immediately after
// every successful stage, never batched to the end): artifacts merge into
// output_json.checkpoints and resume_from_stage advances to `stage`.
export async function checkpointStage(
  runId: string,
  stage: string,
  artifacts: unknown,
): Promise<AgentRunDto> {
  const run = await getAgentRunRepository().checkpointRun(
    runId,
    stage,
    artifacts,
    new Date().toISOString(),
  );
  if (!run) runNotFound(runId);
  return run;
}

// Terminal transition (any non-terminal -> succeeded/failed/cancelled). A
// re-finish with the same terminal status replays the run (covers the
// cancel-API vs runner safe-point race); a different terminal status is 409.
export async function finishRun(runId: string, patch: FinishRunPatch): Promise<AgentRunDto> {
  const before = await getAgentRunRepository().getRunById(runId);
  const run = mapTransition(runId, await getAgentRunRepository().finishRun(runId, patch));
  if (before && ACTIVE_AGENT_RUN_STATUSES.includes(before.status) && run.status !== before.status) {
    await incrementDailyAgentUsage({
      userId: run.userId,
      tokens: run.usage?.totalTokens ?? 0,
      runsCount: 1,
    });
  }
  return run;
}

// Persists a stream event BEFORE it is pushed to clients (spec §7.17);
// GET /events?after=seq reads back exactly these rows (spec §8.11).
export async function appendEvent(
  runId: string,
  event: CurriculumStreamEvent,
): Promise<AgentRunEventDto> {
  const result = await getAgentRunRepository().appendEvent(event);
  if (result.kind === "inserted") return result.event;
  if (result.kind === "run-not-found") runNotFound(runId);
  return runConflict(`Agent run ${runId} already has an event with seq ${event.seq}.`, {
    seq: event.seq,
  });
}

export async function getRun(ownerId: string, runId: string): Promise<AgentRunDto> {
  const run = await getAgentRunRepository().getRunByIdForOwner(ownerId, runId);
  if (!run) runNotFound(runId);
  return run;
}

// Reconnect catch-up (spec §8.11): events with seq > afterSeq, in order.
export async function getEventsAfter(
  ownerId: string,
  runId: string,
  afterSeq: number,
): Promise<AgentRunEventDto[]> {
  await getRun(ownerId, runId);
  return getAgentRunRepository().listEventsAfter(runId, afterSeq);
}

// Internal listings for runners resuming a run (ownership already established
// by the caller): used to continue event seq / step numbering instead of
// restarting at 1 and colliding with the persisted rows.
export async function listRunEvents(runId: string, afterSeq = 0): Promise<AgentRunEventDto[]> {
  return getAgentRunRepository().listEventsAfter(runId, afterSeq);
}

export async function listRunSteps(runId: string): Promise<AgentStepDto[]> {
  return getAgentRunRepository().listSteps(runId);
}

// Any non-terminal run -> cancelled (spec §8.12); terminal runs are a 409.
export async function cancelRun(ownerId: string, runId: string): Promise<AgentRunDto> {
  const before = await getAgentRunRepository().getRunByIdForOwner(ownerId, runId);
  const result = await getAgentRunRepository().cancelRunForOwner(ownerId, runId);
  if (result.kind === "updated") {
    if (before && ACTIVE_AGENT_RUN_STATUSES.includes(before.status)) {
      await incrementDailyAgentUsage({
        userId: result.run.userId,
        tokens: result.run.usage?.totalTokens ?? 0,
        runsCount: 1,
      });
    }
    return result.run;
  }
  if (result.kind === "not-found") runNotFound(runId);
  return runConflict(`Agent run ${runId} is already finished (status "${result.status}").`, {
    status: result.status,
  });
}

export type ResumeRunResult = {
  run: AgentRunDto;
  resumeFromStage: string | null;
  // Completed-stage artifacts (output_json.checkpoints) for the runner to
  // continue from — already-finished stages must not re-run (spec §8.12).
  checkpoints: Record<string, AgentStageCheckpoint>;
};

// failed/cancelled -> queued with a fresh idempotency key (spec §8.12). Any
// other status is 409 AGENT_RESUME_NOT_ALLOWED. A retried resume with the
// same key replays the already-resumed run.
export async function resumeRun(
  ownerId: string,
  runId: string,
  newIdempotencyKey: string,
): Promise<ResumeRunResult> {
  const result: ResumeRunTransitionResult = await getAgentRunRepository().resumeRunForOwner(
    ownerId,
    runId,
    newIdempotencyKey,
  );
  if (result.kind === "updated") {
    return {
      run: result.run,
      resumeFromStage: result.run.resumeFromStage,
      checkpoints: result.run.output?.checkpoints ?? {},
    };
  }
  if (result.kind === "not-found") runNotFound(runId);
  if (result.kind === "invalid-status") {
    throw new AgentError(
      `Agent run ${runId} cannot be resumed from status "${result.status}"; only failed or cancelled runs may resume.`,
      {
        code: "AGENT_RESUME_NOT_ALLOWED",
        expose: true,
        status: 409,
        details: { status: result.status },
      },
    );
  }
  if (result.kind === "idempotency-key-conflict") {
    return runConflict("The idempotency key is already used by another agent run.");
  }
  return runConflict(
    `Curriculum already has an active agent run (${result.run.id}); cancel it before resuming.`,
    { activeRunId: result.run.id },
  );
}

// Cancellation safe-point for runners: check between stages and stop work.
export async function isRunCancelled(runId: string): Promise<boolean> {
  const run = await getAgentRunRepository().getRunById(runId);
  return run?.status === "cancelled";
}

// Quota accounting (impact analysis D5): counts runs created at/after
// sinceIso, regardless of final status — a failed generation still consumed
// model calls.
export async function countRunsByUserAndTypeSince(
  userId: string,
  agentType: AgentType,
  sinceIso: string,
): Promise<number> {
  return getAgentRunRepository().countRunsByUserAndTypeSince(userId, agentType, sinceIso);
}
