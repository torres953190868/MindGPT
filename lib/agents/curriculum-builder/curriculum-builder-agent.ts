// Facade for the CurriculumBuilderAgent (spec §3).
//
// This is the thin entry point used by API routes and tests: it wires default
// runtime dependencies (model adapter, web search, safe fetcher, run service,
// curriculum service, source chunk service, project document searcher) and
// delegates to the controlled state machine in `curriculum-runner.ts`.
//
// D6 (mock convergence): when `AI_MOCK_MODE` is on and no adapter is injected,
// the runner automatically uses a deterministic MockModelAdapter script plus
// MockWebSearchProvider/MockSafeWebFetcher so the entire generation pipeline
// runs without network or real model calls.

import { runCurriculumBuilder, type CurriculumRunResult, type CurriculumRunnerOptions } from "@/lib/agents/curriculum-builder/curriculum-runner";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";

export type GenerateCurriculumDraftInput = {
  ownerId: string;
  curriculumId: string;
  request: CurriculumBuildRequest;
  projectId?: string;
  idempotencyKey: string;
  emit?: (event: CurriculumStreamEvent) => void;
  runtimeMode?: "inline" | "queued";
  accountPlan?: string | null;
};

/**
 * Generates a curriculum draft via the controlled CurriculumBuilderAgent state
 * machine. This function is the public entry point for `/api/curricula/generate`
 * and returns once the run reaches a terminal state (succeeded/failed/cancelled).
 */
export async function generateCurriculumDraft(
  input: GenerateCurriculumDraftInput,
): Promise<CurriculumRunResult> {
  const options: CurriculumRunnerOptions = {
    ownerId: input.ownerId,
    curriculumId: input.curriculumId,
    request: input.request,
    projectId: input.projectId,
    idempotencyKey: input.idempotencyKey,
    emit: input.emit,
    runtimeMode: input.runtimeMode ?? "inline",
    accountPlan: input.accountPlan ?? null,
  };
  return runCurriculumBuilder(options);
}
