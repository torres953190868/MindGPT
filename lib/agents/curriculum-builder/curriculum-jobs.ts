import { handleCallback, send, type MessageMetadata, type RetryDirective } from "@vercel/queue";
import { CURRICULUM_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import { createRun, finishRun, getRun } from "@/lib/agent-runtime/agent-run-service";
import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { runCurriculumBuilder } from "@/lib/agents/curriculum-builder/curriculum-runner";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";

export const CURRICULUM_PROCESSING_TOPIC = "curriculum-processing";

export type CurriculumProcessingJob = { runId: string; ownerId: string; curriculumId: string; request: CurriculumBuildRequest; requestId: string; accountPlan: string | null };

function isJob(value: unknown): value is CurriculumProcessingJob {
  return Boolean(value) && typeof value === "object" && ["runId", "ownerId", "curriculumId", "requestId"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");
}

export async function createAndEnqueueCurriculumJob(input: Omit<CurriculumProcessingJob, "runId"> & { idempotencyKey: string }) {
  const created = await createRun({ agentType: "curriculum_builder", userId: input.ownerId, curriculumId: input.curriculumId, idempotencyKey: input.idempotencyKey, input: input.request, budget: CURRICULUM_AGENT_BUDGET });
  const job: CurriculumProcessingJob = { ...input, runId: created.run.id };
  if (created.created) await send(CURRICULUM_PROCESSING_TOPIC, job, { headers: { "x-request-id": input.requestId }, retentionSeconds: 24 * 60 * 60 });
  return created.run;
}

export async function processCurriculumJob(payload: unknown) {
  if (!isJob(payload)) throw new AgentError("Invalid curriculum queue job.", { code: "AGENT_STAGE_FAILED", status: 400, expose: true });
  const job = payload;
  const run = await getRun(job.ownerId, job.runId);
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") return;
  let result;
  try {
    result = await runCurriculumBuilder({ runId: job.runId, ownerId: job.ownerId, curriculumId: job.curriculumId, request: job.request, idempotencyKey: run.idempotencyKey, runtimeMode: "queued", accountPlan: job.accountPlan, maxStagesPerInvocation: 1 });
  } catch (error) {
    await finishRun(job.runId, {
      status: "failed",
      errorCode: error instanceof AgentError ? error.code : "AGENT_STAGE_FAILED",
      errorMessage: error instanceof Error ? error.message : "Curriculum queue worker failed.",
    });
    throw error;
  }
  if (result.status === "continuing") await send(CURRICULUM_PROCESSING_TOPIC, job, { headers: { "x-request-id": job.requestId }, retentionSeconds: 24 * 60 * 60 });
}

export function getCurriculumProcessingRetryDirective(error: unknown, metadata: MessageMetadata): RetryDirective {
  const status = Number((error as { status?: unknown })?.status);
  if (status >= 400 && status < 500 && status !== 429) return { acknowledge: true };
  if (metadata.deliveryCount >= 4) return { acknowledge: true };
  return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 10) };
}

let handler: ReturnType<typeof handleCallback<CurriculumProcessingJob>> | null = null;
export function getCurriculumProcessingQueueHandler() {
  handler ??= handleCallback<CurriculumProcessingJob>(processCurriculumJob, { visibilityTimeoutSeconds: 900, retry: getCurriculumProcessingRetryDirective });
  return handler;
}
