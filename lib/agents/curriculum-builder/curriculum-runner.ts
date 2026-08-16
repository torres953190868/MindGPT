// CurriculumBuilderAgent controlled state machine (spec §3.8 / §3.9).
// Explicit pipeline stages + checkpoints + repair loop. The LLM is used as a
// structured-output worker, not as an unconstrained autonomous agent.
//
// Implementation notes:
// - Each successful stage is checkpointed (agent_runs.output_json.checkpoints)
//   immediately; never batched to the end (spec §2.2).
// - Resume hydrates artifacts from checkpoints and continues from the first
//   missing stage; completed stages are not re-executed. Budget consumption
//   is likewise rehydrated from the persisted step rows so run-level budget
//   caps hold across queue invocations (each invocation builds a fresh
//   tracker).
// - Repair loops consume repair budget, clear downstream checkpoints, and route
//   back to searching/extracting_concepts/building_graph based on warning codes.
// - Cancellation aborts in-flight model calls via a per-execution watcher
//   polling the repository (shared state, so cross-process cancels are seen
//   too); the stage safe-point check stays as the fallback.
// - Source excerpts are buffered in memory and flushed after the draft version
//   is persisted, when source clientIds can be mapped to server ids.
// - All model/tool/validation/persistence steps are recorded via
//   agent-run-service.completeStep.
// - Independent unit work inside a stage (query batch, source fetch batch,
//   per-module node synthesis) runs with bounded concurrency; results merge
//   in input order so checkpoints and drafts match the serial pipeline.
// - Fetched pages with prompt-injection signals are quarantined: they stay in
//   checkpoints (marked, auditable) but their content is excluded from the
//   extraction model input. The UNTRUSTED_WEB_CONTENT prompt wrapping stays
//   as the second layer.
//
// D6 (mock convergence): when AI_MOCK_MODE is on and no dependencies are
// injected, the runner wires a MockModelAdapter with a built-in script, a
// MockWebSearchProvider and a MockSafeWebFetcher so the entire state machine
// runs end-to-end without network or real model calls.

import { AgentBudgetTracker, CURRICULUM_AGENT_BUDGET, type AgentRunUsage } from "@/lib/agent-runtime/agent-budget";
import { AgentError, isAgentError } from "@/lib/agent-runtime/agent-errors";
import { createModelCallUsage, hashTelemetryText } from "@/lib/agent-runtime/agent-usage";
import type { RecordStepInput } from "@/lib/agent-runtime/agent-run-repository";
import {
  appendEvent,
  checkpointStage,
  completeStep,
  createRun,
  finishRun,
  getRun,
  invalidateCheckpoints,
  isRunCancelled,
  listRunEvents,
  listRunSteps,
  resumeRun,
  startRun,
} from "@/lib/agent-runtime/agent-run-service";
import type { AgentRunDto, AgentStepDto } from "@/lib/agent-runtime/agent-run-types";
import {
  AgentEventSequencer,
  type CurriculumRunStage,
  type CurriculumStreamEvent,
  type CurriculumStreamEventInput,
} from "@/lib/agent-runtime/stream-events";
import {
  buildMockCurriculumScript,
} from "@/lib/agents/curriculum-builder/mock-curriculum-script";
import {
  conceptExtractionSchema,
  curriculumSkeletonSchema,
  curriculumValidationScoreActionSchema,
  intakeNormalizationSchema,
  moduleNodesOutputSchema,
  researchPlanSchema,
  type ConceptExtraction,
  type CurriculumSkeleton,
  type CurriculumValidationScoreAction,
  type IntakeNormalization,
  type ModuleNodesOutput,
  type ResearchPlan,
} from "@/lib/agents/curriculum-builder/curriculum-builder-schema";
import {
  createDefaultProjectDocumentsSearcher,
  type ProjectDocumentsSearcher,
} from "@/lib/agents/curriculum-builder/tools/search-project-documents-tool";
import {
  executeGetExistingCurriculumTool,
  type GetExistingCurriculumToolInput,
} from "@/lib/agents/curriculum-builder/tools/get-existing-curriculum-tool";
import {
  CURRICULUM_TOOLS,
  getCurriculumToolBudgetDimension,
  type CurriculumToolDefinition,
} from "@/lib/agents/curriculum-builder/tools/tool-registry";
import type { ToolResult } from "@/lib/agents/curriculum-builder/tools/tool-result";
import {
  CURRICULUM_LIMITS,
  type CurriculumBuildRequest,
  type CurriculumDraft,
  type CurriculumModule,
  type CurriculumNode,
  type CurriculumSource,
  type StructuredWarning,
} from "@/lib/curriculum/curriculum-types";
import {
  createDraftVersionForOwner,
  getCurriculumForOwner,
  getVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import {
  validateCurriculumDraft,
  type CurriculumValidationResult,
} from "@/lib/curriculum/curriculum-validation-service";
import {
  createAgentModelAdapter,
  isAgentModelMockMode,
  MockModelAdapter,
  type AgentModelAdapter,
  type AgentModelActionRequest,
  type AgentModelUsage,
} from "@/lib/agent-runtime/model-adapter";
import { saveSourceChunks } from "@/lib/research/source-chunk-service";
import { scoreSource } from "@/lib/research/source-quality-service";
import {
  canonicalizeUrl,
  inferSourceType,
  toCurriculumSourceCandidate,
} from "@/lib/research/source-normalizer";
import { MockSafeWebFetcher } from "@/lib/research/mock-safe-web-fetcher";
import { getSafeWebFetcher, type SafeWebFetcher } from "@/lib/research/safe-web-fetcher";
import { MockWebSearchProvider } from "@/lib/research/mock-web-search-provider";
import { getWebSearchProvider, type WebSearchProvider, type WebSearchResult } from "@/lib/research/web-search-provider";
import { buildIntakeUserPrompt, buildModuleNodesUserPrompt, buildResearchPlanUserPrompt, buildSkeletonUserPrompt, buildValidationScoresUserPrompt, buildConceptExtractionUserPrompt, CURRICULUM_BUILDER_SYSTEM_PROMPT, moduleNodesModelStage } from "@/lib/agents/curriculum-builder/curriculum-builder-prompts";

// ---------------------------------------------------------------------------
// Public contracts.
// ---------------------------------------------------------------------------

export type CurriculumRunResult = {
  runId: string;
  status: "succeeded" | "failed" | "cancelled" | "continuing";
  curriculumVersionId?: string;
  validation?: CurriculumValidationResult;
  errorCode?: string;
  errorMessage?: string;
  usage: AgentRunUsage;
};

// Observation-only lifecycle hooks (the runner's observability seam).
// Payloads stay tiny — stage/task enums and usage numbers, never prompt
// text. Hooks are notified, never consulted: they cannot gate or alter
// execution, and a throwing hook is logged and swallowed (see invokeHook) so
// observability can never break the pipeline. They live in deps — the same
// place the runner reads every other behavior seam from — and public-API
// callers pass them through options.deps.
export type CurriculumRunnerHooks = {
  preStage?: (stage: CurriculumRunStage) => void | Promise<void>;
  postStage?: (
    stage: CurriculumRunStage,
    outcome: { ok: true } | { ok: false; code: string },
  ) => void | Promise<void>;
  preModelCall?: (meta: { task: string; stage: CurriculumRunStage }) => void | Promise<void>;
  postModelCall?: (
    meta: { task: string; stage: CurriculumRunStage },
    result: { ok: true; usage: AgentModelUsage } | { ok: false; code: string },
  ) => void | Promise<void>;
};

export type CurriculumRunnerDeps = {
  modelAdapter: AgentModelAdapter;
  webSearchProvider: WebSearchProvider;
  safeWebFetcher: SafeWebFetcher;
  runService: CurriculumRunService;
  curriculumService: CurriculumRunnerCurriculumService;
  sourceChunkService: { saveSourceChunks: typeof saveSourceChunks };
  projectDocumentsSearcher: ProjectDocumentsSearcher;
  existingCurriculumGetter: (
    input: GetExistingCurriculumToolInput,
  ) => ReturnType<typeof executeGetExistingCurriculumTool>;
  budget: AgentBudgetTracker;
  hooks?: CurriculumRunnerHooks;
};

export type CurriculumRunService = {
  createRun: typeof createRun;
  startRun: typeof startRun;
  completeStep: typeof completeStep;
  checkpointStage: typeof checkpointStage;
  invalidateCheckpoints: typeof invalidateCheckpoints;
  finishRun: typeof finishRun;
  appendEvent: typeof appendEvent;
  isRunCancelled: typeof isRunCancelled;
  getRun: typeof getRun;
  resumeRun: typeof resumeRun;
  listRunEvents: typeof listRunEvents;
  listRunSteps: typeof listRunSteps;
};

export type CurriculumRunnerCurriculumService = {
  getCurriculumForOwner: typeof getCurriculumForOwner;
  createDraftVersionForOwner: typeof createDraftVersionForOwner;
  getVersionForOwner: typeof getVersionForOwner;
};

export type CurriculumRunnerOptions = {
  runId?: string;
  ownerId: string;
  curriculumId: string;
  projectId?: string;
  request: CurriculumBuildRequest;
  idempotencyKey: string;
  deps?: Partial<CurriculumRunnerDeps>;
  emit?: (event: CurriculumStreamEvent) => void;
  runtimeMode?: "inline" | "queued";
  // Stage artifacts to resume from. Accepts either the persisted wrapped shape
  // (`{ artifacts, completedAt }` per stage, as stored in output_json) or
  // already-unwrapped RunnerCheckpoints; both are normalized before use.
  resumeCheckpoints?: Record<string, unknown>;
  initialEventSeq?: number;
  initialStepNumber?: number;
  accountPlan?: string | null;
  initialRepairLoops?: number;
  /** Queue workers stop after a checkpoint and publish a fresh continuation. */
  maxStagesPerInvocation?: number;
  /**
   * How often the cancel watcher polls the repository for a cancellation.
   * Between stage safe-points this is what aborts in-flight model calls.
   * Defaults to RUN_CANCEL_POLL_INTERVAL_MS; tests may lower it.
   */
  cancelPollIntervalMs?: number;
};

// ---------------------------------------------------------------------------
// Internal state and artifact types.
// ---------------------------------------------------------------------------

const STAGE_ORDER: CurriculumRunStage[] = [
  "intake",
  "planning",
  "searching",
  "fetching_sources",
  "extracting_concepts",
  "building_graph",
  "validating",
  "saving_draft",
];

// Default interval for the per-execution cancel watcher. The repository is
// shared file/Supabase state, so polling sees cross-process cancels too.
const RUN_CANCEL_POLL_INTERVAL_MS = 2_000;

// Bounded-concurrency limits for independent calls inside one stage. Kept
// small and static: every in-flight call consumes budget up front, and
// provider rate limits sit behind these same code paths.
const SEARCH_FETCH_CONCURRENCY = 3;
const MODULE_SYNTHESIS_CONCURRENCY = 3;

// Bounded-concurrency map over input indices (worker pool). Results land in
// input order regardless of completion order, so merging matches the serial
// loop exactly. The first rejection stops scheduling new items and fails the
// whole map; already in-flight siblings run to completion.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let stopped = false;
  const runWorker = async (): Promise<void> => {
    while (!stopped && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  const laneCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: laneCount }, runWorker));
  return results;
}

// Invokes a lifecycle hook without ever letting it affect the run:
// observability must not break the pipeline, so hook errors are logged and
// swallowed. With no hooks configured the closures below short-circuit on
// `deps.hooks?.`, keeping the overhead negligible.
async function invokeHook(invoke: () => void | Promise<void>): Promise<void> {
  try {
    await invoke();
  } catch (error) {
    console.warn("[curriculum-runner] runner hook failed:", error);
  }
}

// Mapping of repair target stage names to checkpoint stage keys. Used to clear
// downstream checkpoints when a repair loop routes back to an earlier stage.
const DOWNSTREAM_STAGES: Record<string, CurriculumRunStage[]> = {
  searching: ["searching", "fetching_sources", "extracting_concepts", "building_graph", "validating", "saving_draft"],
  fetching_sources: ["fetching_sources", "extracting_concepts", "building_graph", "validating", "saving_draft"],
  extracting_concepts: ["extracting_concepts", "building_graph", "validating", "saving_draft"],
  building_graph: ["building_graph", "validating", "saving_draft"],
};

export type SourceCandidate = CurriculumSource & {
  /** canonical url */
  canonicalUrl: string;
  /** raw search results that point to this source */
  searchHits: WebSearchResult[];
  /** whether this source was successfully fetched */
  fetched: boolean;
  /** fetch error code, if any */
  fetchErrorCode?: string;
  /** cleaned page content, if fetch succeeded */
  pageContent?: string;
  /** whether this source came from project documents rather than web */
  fromProjectDocuments?: boolean;
  /** injection signals crossed the detection threshold at fetch time: the
   * source stays auditable in checkpoints but its content is quarantined
   * from model inputs */
  quarantined?: boolean;
  /** signal category codes only (never matched text) */
  injectionSignals?: string[];
};

export type RunnerCheckpoints = {
  intake?: IntakeNormalization;
  planning?: ResearchPlan;
  searching?: {
    selectedSources: SourceCandidate[];
    failedQueries: Array<{ query: string; code: string; message: string }>;
  };
  fetching_sources?: {
    fetchedSources: SourceCandidate[];
    failedFetches: Array<{ url: string; code: string; message: string }>;
    bufferedExcerpts: Array<{ sourceClientId: string; content: string; fetchedAt: string }>;
    /** clientIds of quarantined sources (audit trail for resume + trace);
     * optional for checkpoints persisted before the quarantine policy */
    quarantinedSourceIds?: string[];
  };
  extracting_concepts?: ConceptExtraction;
  building_graph?: {
    draft: CurriculumDraft;
  };
  validating?: {
    validation: CurriculumValidationResult;
    scores: CurriculumValidationScoreAction;
  };
  saving_draft?: {
    curriculumVersionId: string;
  };
};

// Stage checkpoints persist per stage as { artifacts, completedAt } in
// output_json (see agent-run-repository.checkpointRun), while the pipeline
// consumes artifact fields directly. Normalize both shapes on resume; entries
// already holding plain artifacts are passed through untouched.
function unwrapStageCheckpoints(persisted: Record<string, unknown>): RunnerCheckpoints {
  const unwrapped: Record<string, unknown> = {};
  for (const [stage, entry] of Object.entries(persisted)) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "artifacts" in entry &&
      "completedAt" in entry
    ) {
      unwrapped[stage] = (entry as { artifacts: unknown }).artifacts;
    } else {
      unwrapped[stage] = entry;
    }
  }
  return unwrapped as RunnerCheckpoints;
}

// Reads the token usage persisted with a model step (usage_json holds the
// ModelCallUsage verbatim; failed model calls persist null).
function readStepTotalTokens(usage: unknown): number {
  if (usage && typeof usage === "object") {
    const totalTokens = (usage as { totalTokens?: unknown }).totalTokens;
    if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0) {
      return totalTokens;
    }
  }
  return 0;
}

// Rehydrates run-level budget consumption from persisted rows so caps hold
// across queue invocations (each delivery creates a fresh tracker). Step rows
// carry everything needed — no schema changes:
// - every recorded model step consumed one agent step (consumeStep runs
//   before the call, so failed calls count too); token usage is summed from
//   successful model steps (consumeTokens runs after the call, so failed
//   calls contribute no tokens);
// - tool steps re-consume one unit of the budget dimension the tool registry
//   assigns to their tool name (tools consume budget per attempt, before the
//   provider call, and every attempt records a step);
// - repair loops come from the persisted events (derived by the caller).
// Sources are not in step rows: they restore from the checkpointed searching
// artifacts. A repair-invalidated searching checkpoint loses its pre-repair
// count — accepted, since the repaired run re-selects sources anyway.
function restoreBudgetConsumption(
  budget: AgentBudgetTracker,
  steps: AgentStepDto[],
  checkpoints: RunnerCheckpoints,
  repairLoops: number,
): void {
  let agentSteps = 0;
  let totalTokens = 0;
  let searchQueries = 0;
  let fetchedPages = 0;
  for (const step of steps) {
    if (step.stepType === "model") {
      agentSteps += 1;
      totalTokens += readStepTotalTokens(step.usage);
    } else if (step.stepType === "tool" && step.toolName) {
      const dimension = getCurriculumToolBudgetDimension(step.toolName);
      if (dimension === "searchQueries") searchQueries += 1;
      else if (dimension === "fetchedPages") fetchedPages += 1;
    }
  }
  budget.restore({
    agentSteps,
    // callModel consumes totalTokens through consumeTokens, which books them
    // as promptTokens — mirror that so restored accounting matches live runs.
    promptTokens: totalTokens,
    totalTokens,
    searchQueries,
    fetchedPages,
    repairLoops,
    sources: checkpoints.searching?.selectedSources.length ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export async function runCurriculumBuilder(
  options: CurriculumRunnerOptions,
): Promise<CurriculumRunResult> {
  const deps = await resolveRunnerDeps(options.request, options.deps);
  const { runService } = deps;

  // Resolve the run: either create a new one or resume an existing run.
  let run: AgentRunDto;
  let resumeStage: CurriculumRunStage | null = null;
  let checkpoints: RunnerCheckpoints = {};
  let initialSeq = options.initialEventSeq ?? 0;
  let stepNumber = options.initialStepNumber ?? 1;
  let initialRepairLoops = options.initialRepairLoops ?? 0;

  if (options.runId) {
    const existing = await runService.getRun(options.ownerId, options.runId);
    const resumed = existing.status === "queued" || existing.status === "running"
      ? { run: existing, resumeFromStage: existing.resumeFromStage, checkpoints: existing.output?.checkpoints ?? {} }
      : await runService.resumeRun(options.ownerId, options.runId, options.idempotencyKey);
    run = resumed.run;
    resumeStage = (resumed.resumeFromStage as CurriculumRunStage | null) ?? run.resumeFromStage as CurriculumRunStage | null;
    // Persisted checkpoints are wrapped per stage as { artifacts, completedAt };
    // unwrap them before the pipeline consumes artifact fields directly.
    checkpoints = unwrapStageCheckpoints(
      options.resumeCheckpoints ?? resumed.checkpoints ?? run.output?.checkpoints ?? {},
    );
    // Continue event seq / step numbering from the persisted rows so resumed
    // runs do not collide with the (run_id, seq) / (run_id, step_number)
    // unique constraints on their first append.
    if (options.initialEventSeq === undefined) {
      const events = await runService.listRunEvents(run.id);
      initialSeq = events.reduce((max, event) => Math.max(max, event.seq), 0);
      initialRepairLoops = events.filter(
        (event) => event.event.type === "stage_started" && event.event.stage === "repairing",
      ).length;
    }
    // Steps are listed unconditionally on resume/continuation: they continue
    // step numbering AND rehydrate budget consumption into the fresh tracker
    // so run-level caps hold across queue invocations.
    const priorSteps = await runService.listRunSteps(run.id);
    if (options.initialStepNumber === undefined) {
      stepNumber = priorSteps.reduce((max, step) => Math.max(max, step.stepNumber), 0) + 1;
    }
    restoreBudgetConsumption(deps.budget, priorSteps, checkpoints, initialRepairLoops);
  } else {
    const created = await runService.createRun({
      agentType: "curriculum_builder",
      userId: options.ownerId,
      projectId: options.projectId ?? null,
      curriculumId: options.curriculumId,
      curriculumVersionId: null,
      enrollmentId: null,
      idempotencyKey: options.idempotencyKey,
      input: options.request,
      budget: deps.budget.limits,
    });
    run = created.run;
  }

  if (run.status === "queued") run = await runService.startRun(run.id);

  const sequencer = new AgentEventSequencer(run.id, { initialSeq });

  async function emitEvent(eventInput: CurriculumStreamEventInput): Promise<void> {
    const event = sequencer.next(eventInput);
    await runService.appendEvent(run.id, event);
    options.emit?.(event);
  }

  if (initialSeq === 0) await emitEvent({ type: "run_started" });

  // One abort controller per execution: the cancel watcher aborts in-flight
  // model calls on cancellation instead of waiting for the next stage
  // safe-point (which stays as-is).
  const executionAbort = new AbortController();
  const cancelWatcher = setInterval(() => {
    runService.isRunCancelled(run.id).then(
      (cancelled) => {
        if (cancelled) executionAbort.abort();
      },
      // A polling failure must not fail the run.
      () => undefined,
    );
  }, options.cancelPollIntervalMs ?? RUN_CANCEL_POLL_INTERVAL_MS);

  try {
    const result = await executePipeline({
      run,
      request: options.request,
      ownerId: options.ownerId,
      curriculumId: options.curriculumId,
      projectId: options.projectId,
      deps,
      checkpoints,
      resumeStage,
      emitEvent,
      runtimeMode: options.runtimeMode ?? "inline",
      accountPlan: options.accountPlan ?? null,
      initialRepairLoops,
      stepCounter: { value: stepNumber },
      maxStagesPerInvocation: options.maxStagesPerInvocation,
      cancelSignal: executionAbort.signal,
    });
    return result;
  } catch (error) {
    const agentError = isAgentError(error)
      ? error
      : new AgentError(error instanceof Error ? error.message : String(error), {
          code: "AGENT_STAGE_FAILED",
          status: 500,
        });

    // Cancellation is reported as a clean terminal state, not a failure.
    if (agentError.code === "AGENT_RUN_CANCELLED") {
      await emitEvent({ type: "run_cancelled" });
      await runService.finishRun(run.id, {
        status: "cancelled",
  
        usage: deps.budget.snapshot(),
      });
      return {
        runId: run.id,
        status: "cancelled",
        errorCode: agentError.code,
        errorMessage: agentError.message,
        usage: deps.budget.snapshot(),
      };
    }

    await emitEvent({
      type: "run_failed",
      code: agentError.code,
      message: agentError.message,
    });
    await runService.finishRun(run.id, {
      status: "failed",
      errorCode: agentError.code,
      errorMessage: agentError.message,

      usage: deps.budget.snapshot(),
    });
    return {
      runId: run.id,
      status: "failed",
      errorCode: agentError.code,
      errorMessage: agentError.message,
      usage: deps.budget.snapshot(),
    };
  } finally {
    clearInterval(cancelWatcher);
  }
}

// ---------------------------------------------------------------------------
// Dependency resolution.
// ---------------------------------------------------------------------------

async function resolveRunnerDeps(
  request: CurriculumBuildRequest,
  overrides?: Partial<CurriculumRunnerDeps>,
): Promise<CurriculumRunnerDeps> {
  const mockMode = isAgentModelMockMode();

  const modelAdapter =
    overrides?.modelAdapter ??
    (mockMode
      ? createAgentModelAdapter({ mockScript: buildMockCurriculumScript(request) })
      : createAgentModelAdapter());

  const webSearchProvider =
    overrides?.webSearchProvider ?? (mockMode ? new MockWebSearchProvider() : getWebSearchProvider());

  const safeWebFetcher =
    overrides?.safeWebFetcher ?? (mockMode ? new MockSafeWebFetcher() : getSafeWebFetcher());

  const budget = overrides?.budget ?? new AgentBudgetTracker(CURRICULUM_AGENT_BUDGET);

  return {
    modelAdapter,
    webSearchProvider,
    safeWebFetcher,
    budget,
    hooks: overrides?.hooks,
    runService: overrides?.runService ?? buildDefaultRunService(),
    curriculumService: overrides?.curriculumService ?? {
      getCurriculumForOwner,
      createDraftVersionForOwner,
      getVersionForOwner,
    },
    sourceChunkService: overrides?.sourceChunkService ?? { saveSourceChunks },
    projectDocumentsSearcher: overrides?.projectDocumentsSearcher ?? createDefaultProjectDocumentsSearcher(),
    existingCurriculumGetter:
      overrides?.existingCurriculumGetter ?? ((input) => executeGetExistingCurriculumTool(input)),
  };
}

function buildDefaultRunService(): CurriculumRunService {
  return {
    createRun,
    startRun,
    completeStep,
    checkpointStage,
    invalidateCheckpoints,
    finishRun,
    appendEvent,
    isRunCancelled,
    getRun,
    resumeRun,
    listRunEvents,
    listRunSteps,
  };
}

// ---------------------------------------------------------------------------
// Pipeline orchestration.
// ---------------------------------------------------------------------------

type PipelineContext = {
  run: AgentRunDto;
  request: CurriculumBuildRequest;
  ownerId: string;
  curriculumId: string;
  projectId?: string;
  deps: CurriculumRunnerDeps;
  checkpoints: RunnerCheckpoints;
  resumeStage: CurriculumRunStage | null;
  emitEvent: (eventInput: CurriculumStreamEventInput) => Promise<void>;
  runtimeMode: "inline" | "queued";
  accountPlan: string | null;
  initialRepairLoops: number;
  stepCounter: { value: number };
  // Blocking validation feedback from the previous pass. It is supplied to
  // the regenerated graph so a repair is an informed correction, not merely
  // a second attempt at the same prompt.
  repairFeedback?: StructuredWarning[];
  maxStagesPerInvocation?: number;
  // Aborted by the cancel watcher when the run is cancelled; forwarded into
  // model calls so in-flight requests stop instead of burning tokens.
  cancelSignal: AbortSignal;
};

async function executePipeline(ctx: PipelineContext): Promise<CurriculumRunResult> {
  const { deps, run, emitEvent, checkpoints, resumeStage } = ctx;
  const { runService, budget } = deps;
  // A repair may use up the source-selection budget in the first pass. Keep
  // successfully fetched evidence available so the repaired graph cannot be
  // rebuilt with an empty `sources` array solely because the budget is spent.
  let repairFallbackFetchedSources: SourceCandidate[] = [];

  // Determine the first stage to execute. If resuming, skip completed stages.
  let startIndex = 0;
  if (resumeStage) {
    const idx = STAGE_ORDER.indexOf(resumeStage);
    if (idx >= 0) startIndex = idx;
  }

  let repairLoops = ctx.initialRepairLoops;
  let i = startIndex;
  let completedStages = 0;

  while (i < STAGE_ORDER.length) {
    const stage = STAGE_ORDER[i];

    // Safe-point cancellation check.
    if (await runService.isRunCancelled(run.id)) {
      throw new AgentError("Run was cancelled by the user.", {
        code: "AGENT_RUN_CANCELLED",
        status: 200,
        expose: true,
      });
    }

    // Skip completed stages when resuming, except a failed validation. A
    // validation checkpoint with `valid: false` is repair feedback, never a
    // completed result; queued workers must re-run it after rebuilding the
    // graph rather than proceeding to saving_draft with the stale failure.
    const existingCheckpoint = checkpoints[stage as keyof RunnerCheckpoints];
    const isFailedValidation =
      stage === "validating" &&
      Boolean(
        existingCheckpoint &&
          !(existingCheckpoint as { validation?: CurriculumValidationResult }).validation?.valid,
      );
    if (existingCheckpoint && repairLoops === 0 && !isFailedValidation) {
      i += 1;
      continue;
    }
    if (isFailedValidation) {
      delete checkpoints.validating;
      await runService.invalidateCheckpoints(run.id, ["validating", "saving_draft"]);
    }

    budget.assertWithinRuntime(ctx.runtimeMode);
    await emitEvent({ type: "stage_started", stage });

    let stageResult: RunnerCheckpoints[keyof RunnerCheckpoints] | undefined;
    // postStage(ok:false) fires only when the stage body itself throws; the
    // post-repair-budget failure below happens after the validating stage
    // already completed (ok:true fired), so it is not re-reported as one.
    let postStageNotified = false;
    try {
      await invokeHook(() => deps.hooks?.preStage?.(stage));
      switch (stage) {
        case "intake":
          stageResult = await runIntakeStage(ctx);
          break;
        case "planning":
          stageResult = await runPlanningStage(ctx);
          break;
        case "searching":
          stageResult = await runSearchingStage(ctx);
          break;
        case "fetching_sources":
          stageResult = await runFetchingSourcesStage(
            ctx,
            checkpoints.searching?.selectedSources ?? [],
            repairFallbackFetchedSources,
          );
          break;
        case "extracting_concepts":
          stageResult = await runExtractingConceptsStage(ctx, checkpoints);
          break;
        case "building_graph":
          stageResult = await runBuildingGraphStage(ctx, checkpoints);
          break;
        case "validating":
          stageResult = await runValidatingStage(ctx, checkpoints);
          break;
        case "saving_draft":
          stageResult = await runSavingDraftStage(ctx, checkpoints);
          break;
        default:
          throw new AgentError(`Unknown pipeline stage: ${stage}`, { code: "AGENT_STAGE_FAILED", status: 500 });
      }

      checkpoints[stage as keyof RunnerCheckpoints] = stageResult as never;
      await runService.checkpointStage(run.id, stage, stageResult);
      completedStages += 1;
      postStageNotified = true;
      await invokeHook(() => deps.hooks?.postStage?.(stage, { ok: true }));

      // Repair loop handling for validating stage.
      if (stage === "validating") {
        const validationStage = stageResult as { validation: CurriculumValidationResult; scores: CurriculumValidationScoreAction };
        if (!validationStage.validation.valid && repairLoops < (deps.budget.limits.maxRepairLoops ?? 0)) {
          const repairTarget = pickRepairTarget(validationStage.validation.warnings);
          if (repairTarget && DOWNSTREAM_STAGES[repairTarget]) {
            repairLoops += 1;
            deps.budget.consumeRepair();
            await emitEvent({ type: "stage_started", stage: "repairing" });
            repairFallbackFetchedSources = checkpoints.fetching_sources?.fetchedSources ?? repairFallbackFetchedSources;
            ctx.repairFeedback = validationStage.validation.warnings.filter(
              (warning) => warning.severity === "blocking",
            );
            // Clear downstream checkpoints so those stages re-run with feedback.
            for (const clearStage of DOWNSTREAM_STAGES[repairTarget]) {
              delete checkpoints[clearStage as keyof RunnerCheckpoints];
            }
            await runService.invalidateCheckpoints(run.id, DOWNSTREAM_STAGES[repairTarget]);
            const targetIndex = STAGE_ORDER.indexOf(repairTarget as CurriculumRunStage);
            if (targetIndex >= 0) {
              i = targetIndex;
              continue;
            }
          }
        }
        if (!validationStage.validation.valid) {
          throw new AgentError(
            `Validation failed after ${repairLoops} repair loops: ${validationStage.validation.blockingCount} blocking issues remain.`,
            { code: "AGENT_STAGE_FAILED", status: 422, expose: true },
          );
        }
      }
    } catch (error) {
      if (!postStageNotified) {
        await invokeHook(() =>
          deps.hooks?.postStage?.(stage, {
            ok: false,
            code: isAgentError(error) ? error.code : "UNKNOWN",
          }),
        );
      }
      throw error;
    }

    // A queue delivery owns only one checkpointable stage.  This keeps every
    // function invocation comfortably below Vercel's execution deadline;
    // the next delivery reloads checkpoints and continues deterministically.
    if (ctx.maxStagesPerInvocation && completedStages >= ctx.maxStagesPerInvocation) {
      return { runId: run.id, status: "continuing", usage: deps.budget.snapshot() };
    }

    i += 1;
  }

  const finalCheckpoints = checkpoints as RunnerCheckpoints;
  const versionId = finalCheckpoints.saving_draft?.curriculumVersionId;
  const usage = deps.budget.snapshot();

  await emitEvent({ type: "run_completed", curriculumVersionId: versionId! });
  await runService.finishRun(run.id, {
    status: "succeeded",
    usage,
  });

  return {
    runId: run.id,
    status: "succeeded",
    curriculumVersionId: versionId,
    validation: finalCheckpoints.validating?.validation,
    usage,
  };
}

function pickRepairTarget(warnings: StructuredWarning[]): string | null {
  // Prefer the earliest stage that can address the blocking warnings.
  // Codes must stay aligned with curriculum-validation-service.ts.
  const codes = new Set(warnings.map((w) => w.code));
  if (
    codes.has("FEW_SOURCES") ||
    codes.has("FEW_SOURCE_TYPES") ||
    codes.has("CORE_MODULE_SOURCE_SUPPORT") ||
    codes.has("CORE_NODE_WITHOUT_SOURCE")
  ) {
    return "searching";
  }
  if (codes.has("EXTRACTION_QUALITY") || codes.has("DUPLICATE_CONCEPTS")) {
    return "extracting_concepts";
  }
  if (
    codes.has("CYCLE") ||
    codes.has("UNKNOWN_PREREQUISITE") ||
    codes.has("PREREQUISITE_ORDER") ||
    codes.has("ORPHANED_CORE_NODE") ||
    codes.has("UNREACHABLE_CORE_NODE")
  ) {
    return "building_graph";
  }
  if (
    codes.has("DUPLICATE_CLIENT_ID") ||
    codes.has("DUPLICATE_NODE_TITLE") ||
    codes.has("DUPLICATE_ORDER_INDEX") ||
    codes.has("SCHEMA_ERROR")
  ) {
    return "building_graph";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stage implementations.
// ---------------------------------------------------------------------------

async function runIntakeStage(ctx: PipelineContext): Promise<IntakeNormalization> {
  const { request, accountPlan } = ctx;
  return callModel<IntakeNormalization>(
    ctx,
    {
      task: "curriculum_research",
      systemPrompt: CURRICULUM_BUILDER_SYSTEM_PROMPT,
      contextMessages: [{ role: "user", content: buildIntakeUserPrompt(request) }],
      actionSchema: intakeNormalizationSchema,
      maxOutputTokens: 2_000,
      accountPlan,
    },
    "intake",
  );
}

async function runPlanningStage(ctx: PipelineContext): Promise<ResearchPlan> {
  const { request, accountPlan, deps, ownerId } = ctx;
  // The injectable getter stands in for the tool's default executor (test
  // seam); name/schema/budget mapping still come from the registry.
  const existing = await dispatchCurriculumTool(
    ctx,
    "planning",
    CURRICULUM_TOOLS.getExistingCurriculum,
    { ownerId, subject: request.subject },
    {},
    { execute: (input) => deps.existingCurriculumGetter(input) },
  );
  return callModel<ResearchPlan>(
    ctx,
    {
      task: "curriculum_research",
      systemPrompt: CURRICULUM_BUILDER_SYSTEM_PROMPT,
      contextMessages: [
        {
          role: "user",
          content: buildResearchPlanUserPrompt({
            request,
            intake: ctx.checkpoints.intake!,
            existingCurricula: existing.ok ? JSON.stringify(existing.data.curricula) : "",
            maxQueries: ctx.deps.budget.remainingSearches,
          }),
        },
      ],
      actionSchema: researchPlanSchema,
      maxOutputTokens: 2_000,
      accountPlan,
    },
    "planning",
  );
}

async function runSearchingStage(ctx: PipelineContext): Promise<RunnerCheckpoints["searching"]> {
  const { deps, request, emitEvent } = ctx;
  const { webSearchProvider, budget } = deps;
  const plan = ctx.checkpoints.planning;
  if (!plan) throw new AgentError("Planning checkpoint missing.", { code: "AGENT_STAGE_FAILED", status: 500 });

  // Queries are independent, so the batch runs with bounded concurrency.
  // Events and tool steps may interleave across the batch (seqs stay
  // monotonic via the central sequencer); hits are merged in input order
  // afterwards, keeping source selection identical to the serial loop.
  const outcomes = await mapWithConcurrency(
    plan.queries.slice(0, budget.remainingSearches),
    SEARCH_FETCH_CONCURRENCY,
    async (item) => {
      await emitEvent({ type: "search_started", query: item.query });

      const result = await dispatchCurriculumTool(
        ctx,
        "searching",
        CURRICULUM_TOOLS.webSearch,
        { query: item.query, maxResults: 10 },
        { provider: webSearchProvider, budget },
      );
      await emitEvent({
        type: "search_completed",
        query: item.query,
        resultCount: result.ok ? result.data.results.length : 0,
      });
      return { item, result };
    },
  );

  const selectedSources = new Map<string, SourceCandidate>();
  const failedQueries: Array<{ query: string; code: string; message: string }> = [];

  // Merge in input order: the first query to surface a URL owns the candidate
  // and equal quality scores keep query order, exactly like the serial loop.
  for (const { item, result } of outcomes) {
    if (!result.ok) {
      failedQueries.push({ query: item.query, code: result.code, message: result.message });
      continue;
    }

    for (const hit of result.data.results) {
      const canonical = canonicalizeUrl(hit.url);
      if (!canonical) continue;
      if (request.sourcePreferences?.excludedDomains?.some((domain) => canonical.includes(domain))) {
        continue;
      }
      if (selectedSources.has(canonical)) {
        selectedSources.get(canonical)!.searchHits.push(hit);
        continue;
      }
      const { score } = scoreSource({
        url: canonical,
        sourceType: inferSourceType(canonical),
        publishedAt: hit.publishedAt,
        snippet: hit.snippet,
      });
      const candidate = toCurriculumSourceCandidate(hit, {
        fetchedAt: new Date().toISOString(),
        qualityScore: score,
      });
      selectedSources.set(canonical, {
        ...candidate,
        canonicalUrl: canonical,
        searchHits: [hit],
        fetched: false,
      });
    }
  }

  // Sort by quality score and cap to maxSources budget.
  const sorted = Array.from(selectedSources.values())
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, budget.remainingSources);

  // Assign deterministic clientIds in selection order. These ids are only
  // used inside the draft until persistence rewrites them to server ids; a
  // stable scheme lets mock scripts and tests reference src-1, src-2, ...
  // without depending on createId randomness.
  for (let i = 0; i < sorted.length; i += 1) {
    const source = sorted[i];
    source.id = `src-${i + 1}`;
    budget.consumeSource();
    await emitEvent({
      type: "source_selected",
      source: {
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        sourceType: source.sourceType,
        qualityScore: source.qualityScore,
      },
    });
  }

  return { selectedSources: sorted, failedQueries };
}

async function runFetchingSourcesStage(
  ctx: PipelineContext,
  selectedSources: SourceCandidate[],
  fallbackFetchedSources: SourceCandidate[] = [],
): Promise<RunnerCheckpoints["fetching_sources"]> {
  const { deps } = ctx;
  const { safeWebFetcher, budget } = deps;
  const seenUrls = new Set(selectedSources.map((s) => s.canonicalUrl));
  // The serial loop stopped once the fetch budget ran out; pre-slicing is
  // equivalent because every dispatched fetch consumes exactly one budget
  // unit (runner-selected URLs always pass the tool's URL/seenUrls checks).
  const fetchableSources = selectedSources.slice(0, Math.max(0, budget.remainingFetches));

  // Fetches are independent and run with bounded concurrency; tool steps may
  // interleave, while outcomes merge in source order so the checkpoint
  // artifacts match the serial loop.
  const outcomes = await mapWithConcurrency(fetchableSources, SEARCH_FETCH_CONCURRENCY, async (source) => {
    // Buffered per source (not into a shared array) so the merged excerpt
    // list below stays in source order.
    let excerpt: { sourceClientId: string; content: string; fetchedAt: string } | undefined;
    const result = await dispatchCurriculumTool(
      ctx,
      "fetching_sources",
      CURRICULUM_TOOLS.fetchWebPage,
      { url: source.url, sourceId: source.id },
      {
        fetcher: safeWebFetcher,
        budget,
        seenUrls,
        persistExcerpts: async (input) => {
          // Buffer until draft persistence maps source clientIds to server ids.
          excerpt = {
            sourceClientId: source.id,
            content: input.content,
            fetchedAt: input.fetchedAt ?? new Date().toISOString(),
          };
          return { chunkCount: 1 };
        },
      },
      {
        // Step rows record page metadata only, never the fetched content.
        recordOutput: (fetchResult) =>
          fetchResult.ok
            ? {
                page: { title: fetchResult.data.page.title, url: fetchResult.data.page.url, truncated: fetchResult.data.page.truncated },
                chunkCount: fetchResult.data.chunkCount,
              }
            : { error: { code: fetchResult.code, message: fetchResult.message } },
      },
    );
    return { source, result, excerpt };
  });

  const fetchedSources: SourceCandidate[] = [];
  const failedFetches: Array<{ url: string; code: string; message: string }> = [];
  const bufferedExcerpts: Array<{ sourceClientId: string; content: string; fetchedAt: string }> = [];

  for (const { source, result, excerpt } of outcomes) {
    if (!result.ok) {
      failedFetches.push({ url: source.url, code: result.code, message: result.message });
      source.fetchErrorCode = result.code;
      continue;
    }

    source.fetched = true;
    source.pageContent = result.data.page.content;
    // Enforced injection policy (defense in depth on top of the
    // UNTRUSTED_WEB_CONTENT wrapping): the detector fires categorically, so
    // any signal quarantines the source — it stays auditable here but its
    // content is excluded from the extraction model input.
    if (result.data.page.injectionSignals?.length) {
      source.quarantined = true;
      source.injectionSignals = result.data.page.injectionSignals;
    }
    if (excerpt) bufferedExcerpts.push(excerpt);
    fetchedSources.push(source);
  }

  if (fetchedSources.length === 0 && fallbackFetchedSources.length > 0) {
    return {
      fetchedSources: fallbackFetchedSources,
      failedFetches,
      // Excerpts were already buffered during the original fetch; avoiding a
      // duplicate flush also keeps source-chunk persistence idempotent.
      bufferedExcerpts: [],
      quarantinedSourceIds: [],
    };
  }

  return {
    fetchedSources,
    failedFetches,
    bufferedExcerpts,
    quarantinedSourceIds: fetchedSources.flatMap((source) => (source.quarantined ? [source.id] : [])),
  };
}

async function runExtractingConceptsStage(
  ctx: PipelineContext,
  checkpoints: RunnerCheckpoints,
): Promise<ConceptExtraction> {
  const { accountPlan } = ctx;
  const fetching = checkpoints.fetching_sources;
  if (!fetching) throw new AgentError("Fetching_sources checkpoint missing.", { code: "AGENT_STAGE_FAILED", status: 500 });

  const projectDocumentExcerpts: Array<{ id: string; excerpt: string }> = [];
  for (const item of (checkpoints.planning?.queries ?? []).slice(0, 3)) {
    if (!ctx.projectId || ctx.deps.budget.remainingSearches <= 0) break;
    // Project retrieval shares maxSearchQueries with web search as a hard cap.
    ctx.deps.budget.consumeSearch();
    const input = { projectId: ctx.projectId, query: item.query, topK: 5 };
    const result = await dispatchCurriculumTool(
      ctx,
      "extracting_concepts",
      CURRICULUM_TOOLS.searchProjectDocuments,
      input,
      { ownerId: ctx.ownerId, searcher: ctx.deps.projectDocumentsSearcher },
    );
    if (!result.ok) continue;
    projectDocumentExcerpts.push(
      ...result.data.snippets.map((snippet) => ({
        id: `project-document:${snippet.documentId}:${snippet.chunkId}`,
        excerpt: snippet.excerpt,
      })),
    );
  }

  // Quarantined sources (injection signals detected at fetch time) stay in
  // the checkpoint for audit, but their content never reaches the model. If
  // everything is quarantined the prompt simply gets no sources — the
  // existing validation/repair loop handles the outcome.
  const usableSources = fetching.fetchedSources.filter((source) => !source.quarantined);

  const contextMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: buildConceptExtractionUserPrompt({
        request: ctx.request,
        intake: checkpoints.intake!,
        sources: usableSources.map((source) => ({
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          qualityScore: source.qualityScore,
          excerpt: source.pageContent ?? "",
        })),
        projectDocumentExcerpts,
      }),
    },
  ];

  return callModel<ConceptExtraction>(
    ctx,
    {
      task: "curriculum_research",
      systemPrompt: CURRICULUM_BUILDER_SYSTEM_PROMPT,
      contextMessages,
      actionSchema: conceptExtractionSchema,
      maxOutputTokens: 8_000,
      accountPlan,
    },
    "extracting_concepts",
  );
}

async function runBuildingGraphStage(
  ctx: PipelineContext,
  checkpoints: RunnerCheckpoints,
): Promise<{ draft: CurriculumDraft }> {
  const { request, accountPlan } = ctx;
  const intake = checkpoints.intake;
  const fetching = checkpoints.fetching_sources;
  const extraction = checkpoints.extracting_concepts;
  if (!intake || !fetching || !extraction) {
    throw new AgentError("Missing upstream checkpoints for building_graph.", { code: "AGENT_STAGE_FAILED", status: 500 });
  }

  // 1. Synthesize skeleton.
  const skeletonAction = await callModel<CurriculumSkeleton>(
    ctx,
    {
      task: "curriculum_synthesis",
      systemPrompt: CURRICULUM_BUILDER_SYSTEM_PROMPT,
      contextMessages: [
        {
          role: "user",
          content: buildSkeletonUserPrompt({
            request,
            intake,
          concepts: extraction,
            sources: fetching.fetchedSources.map((source) => ({
              id: source.id,
              title: source.title,
              sourceType: source.sourceType,
              qualityScore: source.qualityScore,
              url: source.url,
            })),
            repairFeedback: ctx.repairFeedback,
          }),
        },
      ],
      actionSchema: curriculumSkeletonSchema,
      maxOutputTokens: 4_000,
      accountPlan,
    },
    "building_graph",
  );

  // A very short learning budget cannot support a sprawling outline. Keeping
  // it to two modules also keeps a queued graph-building invocation bounded:
  // each module requires a separate structured model call.
  const requestedHours = (request.constraints?.durationWeeks ?? 0) * (request.constraints?.hoursPerWeek ?? 0);
  if (requestedHours > 0 && requestedHours <= 8 && skeletonAction.modules.length > 2) {
    skeletonAction.modules = skeletonAction.modules.slice(0, 2).map((courseModule, orderIndex) => ({
      ...courseModule,
      orderIndex,
    }));
  }

  // 2. Synthesize nodes per module with bounded retries per module.
  const modules: CurriculumModule[] = [];
  const nodeByClientId = new Map<string, CurriculumNode>();
  const allNodes: CurriculumNode[] = [];
  const collectModule = (
    moduleSkeleton: CurriculumSkeleton["modules"][number],
    moduleNodes: CurriculumNode[],
  ) => {
    const courseModule: CurriculumModule = {
      clientId: moduleSkeleton.clientId,
      title: moduleSkeleton.title,
      description: moduleSkeleton.description,
      orderIndex: moduleSkeleton.orderIndex,
      required: moduleSkeleton.required,
      nodes: moduleNodes,
    };
    modules.push(courseModule);
    for (const node of moduleNodes) {
      nodeByClientId.set(node.clientId, node);
      allNodes.push(node);
    }
  };

  // MockModelAdapter consumes a scripted queue, so parallel module calls
  // would make script consumption order nondeterministic; mock runs keep the
  // serial loop (and its accumulating existingNodes prompt) untouched.
  if (ctx.deps.modelAdapter instanceof MockModelAdapter) {
    for (const moduleSkeleton of skeletonAction.modules) {
      const moduleNodes = await synthesizeModuleNodes(
        ctx,
        skeletonAction,
        moduleSkeleton,
        extraction,
        fetching.fetchedSources,
        allNodes.map((node) => ({ clientId: node.clientId, title: node.title })),
      );
      collectModule(moduleSkeleton, moduleNodes);
    }
  } else {
    // Modules are synthesized with bounded concurrency and merged in skeleton
    // order. Parallel calls cannot see earlier modules' nodes (they are still
    // in flight), so existingNodes stays empty and cross-module title
    // collisions remain covered by normalizeDuplicateNodeTitles.
    const nodesPerModule = await mapWithConcurrency(
      skeletonAction.modules,
      MODULE_SYNTHESIS_CONCURRENCY,
      (moduleSkeleton) =>
        synthesizeModuleNodes(ctx, skeletonAction, moduleSkeleton, extraction, fetching.fetchedSources, []),
    );
    for (let index = 0; index < skeletonAction.modules.length; index += 1) {
      collectModule(skeletonAction.modules[index], nodesPerModule[index]);
    }
  }

  // 3. Build source lookup and validate source id references.
  const sourceByClientId = new Map(fetching.fetchedSources.map((s) => [s.id, s]));
  for (const node of allNodes) {
    node.sourceIds = node.sourceIds.filter((id) => sourceByClientId.has(id));
  }

  // 4. Validate prerequisite references point to known nodes.
  for (const node of allNodes) {
    const resolved = new Set<string>();
    for (const prereqClientId of node.prerequisiteClientIds) {
      if (nodeByClientId.has(prereqClientId)) {
        resolved.add(prereqClientId);
      }
    }
    // Also keep explicit prerequisiteClientIds already present from module nodes.
    node.prerequisiteClientIds = Array.from(resolved);
  }

  // 5. Resolve orderIndex globally if missing or duplicate.
  normalizeNodeOrder(allNodes, modules);
  // A node title is part of the reader-facing curriculum outline, but the
  // deterministic validator also requires it to be unique across modules.
  // Models commonly reuse generic labels such as "示例" or "练习" while
  // generating modules independently. Namespace only colliding labels with
  // their module title before validation so they remain meaningful to readers
  // without turning an otherwise valid graph into a failed run.
  normalizeDuplicateNodeTitles(modules);

  const draft: CurriculumDraft = {
    title: skeletonAction.title,
    subject: intake.subject,
    versionLabel: `draft-${new Date().toISOString().slice(0, 10)}`,
    audience: skeletonAction.audience,
    learningGoal: skeletonAction.learningGoal,
    estimatedWeeks: skeletonAction.estimatedWeeks,
    estimatedHours: skeletonAction.estimatedHours,
    assumptions: skeletonAction.assumptions,
    exclusions: skeletonAction.exclusions,
    modules,
    sources: fetching.fetchedSources.map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      publisher: s.publisher,
      sourceType: s.sourceType,
      retrievedAt: s.retrievedAt,
      qualityScore: s.qualityScore,
      notes: s.notes,
    })),
    conflicts: skeletonAction.conflicts,
    validation: {
      coverageScore: 0,
      sequenceScore: 0,
      prerequisiteScore: 0,
      sourceQualityScore: 0,
      difficultyFitScore: 0,
      warnings: [],
    },
  };

  return { draft };
}

async function synthesizeModuleNodes(
  ctx: PipelineContext,
  skeleton: CurriculumSkeleton,
  moduleSkeleton: { clientId: string; title: string; description: string; orderIndex: number; required: boolean },
  extraction: ConceptExtraction,
  sources: SourceCandidate[],
  existingNodes: Array<Pick<CurriculumNode, "clientId" | "title">>,
): Promise<CurriculumNode[]> {
  const { accountPlan, request } = ctx;
  const maxRetries = ctx.deps.budget.limits.maxRetriesPerStage ?? 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const action = await callModel<ModuleNodesOutput>(
        ctx,
        {
          task: "curriculum_synthesis",
          // Finer key than the pipeline stage ("building_graph") so mock
          // scripts route skeleton vs per-module calls without prompt markers.
          stage: moduleNodesModelStage(moduleSkeleton.clientId),
          systemPrompt: CURRICULUM_BUILDER_SYSTEM_PROMPT,
          contextMessages: [
            {
              role: "user",
              content: buildModuleNodesUserPrompt({
                request,
                intake: ctx.checkpoints.intake!,
                skeleton,
                moduleClientId: moduleSkeleton.clientId,
                concepts: extraction,
                sources: sources.map((source) => ({
                  id: source.id,
                  title: source.title,
                  sourceType: source.sourceType,
                  qualityScore: source.qualityScore,
                  url: source.url,
                })),
                existingNodes,
                repairFeedback: ctx.repairFeedback,
              }),
            },
          ],
          actionSchema: moduleNodesOutputSchema,
          maxOutputTokens: 8_000,
          accountPlan,
        },
        "building_graph",
      );
      return action.nodes;
    } catch (error) {
      // Run-terminal failures (budget exhausted, run cancelled) are not
      // retried and never converted into AGENT_INVALID_MODEL_OUTPUT: they
      // fail the stage — and the run — with their original code.
      if (
        isAgentError(error) &&
        (error.code === "AGENT_BUDGET_EXHAUSTED" || error.code === "AGENT_RUN_CANCELLED")
      ) {
        throw error;
      }
      lastError = error;
    }
  }

  throw new AgentError(
    `Module ${moduleSkeleton.clientId} node synthesis failed after ${maxRetries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { code: "AGENT_INVALID_MODEL_OUTPUT", status: 502, expose: true },
  );
}

function normalizeNodeOrder(allNodes: CurriculumNode[], modules: CurriculumModule[]) {
  let globalIndex = 0;
  for (const courseModule of modules) {
    for (const node of courseModule.nodes) {
      node.orderIndex = globalIndex;
      globalIndex += 1;
    }
  }
}

function normalizeDuplicateNodeTitles(modules: CurriculumModule[]): void {
  const occurrences = new Map<string, number>();
  for (const courseModule of modules) {
    for (const node of courseModule.nodes) {
      occurrences.set(node.title, (occurrences.get(node.title) ?? 0) + 1);
    }
  }

  const usedTitles = new Set<string>();
  for (const courseModule of modules) {
    for (const node of courseModule.nodes) {
      if ((occurrences.get(node.title) ?? 0) < 2) {
        usedTitles.add(node.title);
        continue;
      }

      const baseTitle = `${courseModule.title}：${node.title}`;
      let suffix = 1;
      let candidate = truncateTitle(baseTitle, "");
      while (usedTitles.has(candidate)) {
        suffix += 1;
        candidate = truncateTitle(baseTitle, ` (${suffix})`);
      }
      node.title = candidate;
      usedTitles.add(candidate);
    }
  }
}

function truncateTitle(baseTitle: string, suffix: string): string {
  return `${baseTitle.slice(0, CURRICULUM_LIMITS.maxTitleLength - suffix.length)}${suffix}`;
}

async function runValidatingStage(
  ctx: PipelineContext,
  checkpoints: RunnerCheckpoints,
): Promise<{ validation: CurriculumValidationResult; scores: CurriculumValidationScoreAction }> {
  const { accountPlan } = ctx;
  const draft = checkpoints.building_graph?.draft;
  if (!draft) throw new AgentError("Draft missing for validation.", { code: "AGENT_STAGE_FAILED", status: 500 });

  const validation = validateCurriculumDraft(draft);

  const draftDigest = buildDraftDigest(draft);
  const scoresAction = await callModel<CurriculumValidationScoreAction>(
    ctx,
    {
      task: "curriculum_validation",
      systemPrompt: CURRICULUM_BUILDER_SYSTEM_PROMPT,
      contextMessages: [
        {
          role: "user",
          content: buildValidationScoresUserPrompt({
            request: ctx.request,
            draftDigest,
            deterministicValidation: validation,
          }),
        },
      ],
      actionSchema: curriculumValidationScoreActionSchema,
      maxOutputTokens: 2_000,
      accountPlan,
    },
    "validating",
  );

  // Merge independent scores into the deterministic validation result.
  const mergedValidation: CurriculumValidationResult = {
    ...validation,
    coverageScore: scoresAction.coverageScore,
    sequenceScore: scoresAction.sequenceScore,
    prerequisiteScore: scoresAction.prerequisiteScore,
    sourceQualityScore: scoresAction.sourceQualityScore,
    difficultyFitScore: scoresAction.difficultyFitScore,
    independentReviewer: {
      source: "independent_reviewer",
      scores: {
        coverageScore: scoresAction.coverageScore,
        sequenceScore: scoresAction.sequenceScore,
        prerequisiteScore: scoresAction.prerequisiteScore,
        sourceQualityScore: scoresAction.sourceQualityScore,
        difficultyFitScore: scoresAction.difficultyFitScore,
      },
      rationales: scoresAction.rationales,
    },
  };

  await ctx.emitEvent({
    type: "validation_completed",
    validation: mergedValidation,
  });

  await recordValidationStep(ctx, draft, mergedValidation);
  return { validation: mergedValidation, scores: scoresAction };
}

async function runSavingDraftStage(
  ctx: PipelineContext,
  checkpoints: RunnerCheckpoints,
): Promise<{ curriculumVersionId: string }> {
  const { deps, ownerId, curriculumId, emitEvent } = ctx;
  const draft = checkpoints.building_graph?.draft;
  const validation = checkpoints.validating?.validation;
  const bufferedExcerpts = checkpoints.fetching_sources?.bufferedExcerpts ?? [];

  if (!draft || !validation) {
    throw new AgentError("Draft or validation missing for saving.", { code: "AGENT_STAGE_FAILED", status: 500 });
  }

  // Idempotency by runId: if this stage was already checkpointed, reuse.
  if (checkpoints.saving_draft?.curriculumVersionId) {
    return { curriculumVersionId: checkpoints.saving_draft.curriculumVersionId };
  }

  const version = await deps.curriculumService.createDraftVersionForOwner(
    ownerId,
    curriculumId,
    draft,
    { agentRunId: ctx.run.id, validation },
  );

  // Flush buffered excerpts now that we have server source ids.
  const savedDraft = version.draft;
  const sourceUrlToId = new Map(savedDraft.sources.map((s) => [canonicalizeUrl(s.url), s.id]));
  for (const excerpt of bufferedExcerpts) {
    // Find the original fetched source by matching clientId to url.
    const originalSource = checkpoints.fetching_sources?.fetchedSources.find((s) => s.id === excerpt.sourceClientId);
    // Quarantined sources stay in draft.sources for audit, but their content
    // is never persisted as retrievable chunks (it would otherwise resurface
    // in tutor prompts via course-source retrieval).
    if (!originalSource || originalSource.quarantined) continue;
    const serverSourceId = sourceUrlToId.get(canonicalizeUrl(originalSource.url));
    if (!serverSourceId) continue;
    await deps.sourceChunkService.saveSourceChunks({
      sourceId: serverSourceId,
      content: excerpt.content,
      fetchedAt: excerpt.fetchedAt,
    });
  }

  await recordPersistenceStep(ctx, "createDraftVersion", { versionId: version.version.id });
  await emitEvent({ type: "draft_saved", curriculumVersionId: version.version.id });

  return { curriculumVersionId: version.version.id };
}

// ---------------------------------------------------------------------------
// Model / tool / validation / persistence step helpers.
// ---------------------------------------------------------------------------

async function callModel<T>(
  ctx: PipelineContext,
  request: AgentModelActionRequest<T>,
  stage: CurriculumRunStage,
): Promise<T> {
  const { deps } = ctx;
  const { modelAdapter, budget } = deps;

  budget.consumeStep();
  const hookMeta = { task: request.task, stage };
  await invokeHook(() => deps.hooks?.preModelCall?.(hookMeta));
  const start = Date.now();
  let result: Awaited<ReturnType<AgentModelAdapter["completeAction"]>>;
  try {
    // The execution-wide cancel signal lets an abort reach the in-flight
    // fetch (call sites do not pass their own signal). An explicit
    // request.stage (per-module synthesis) overrides the pipeline stage key.
    result = await modelAdapter.completeAction({ stage, ...request, signal: ctx.cancelSignal });
  } catch (error) {
    const duration = Date.now() - start;
    await invokeHook(() =>
      deps.hooks?.postModelCall?.(hookMeta, {
        ok: false,
        code: isAgentError(error) ? error.code : "UNKNOWN",
      }),
    );
    await recordModelStep(ctx, stage, request.task, request.contextMessages, error as Error, duration);
    throw error;
  }
  const duration = Date.now() - start;
  budget.consumeTokens(result.usage.totalTokens);
  const callUsage = createModelCallUsage({
    provider: result.provider,
    model: result.model,
    ...result.usage,
    cacheHitTokens: result.usage.promptCacheHitTokens,
    cacheMissTokens: result.usage.promptCacheMissTokens,
    durationMs: duration,
  });
  budget.recordModelCall(callUsage);
  await invokeHook(() => deps.hooks?.postModelCall?.(hookMeta, { ok: true, usage: result.usage }));
  await recordModelStep(ctx, stage, request.task, request.contextMessages, result.action, duration, callUsage);
  return result.action as T;
}

async function recordModelStep(
  ctx: PipelineContext,
  stage: CurriculumRunStage,
  task: string,
  contextMessages: Array<{ role: "user" | "assistant"; content: string }>,
  outputOrError: unknown,
  durationMs: number,
  usage?: AgentModelUsage | ReturnType<typeof createModelCallUsage>,
): Promise<void> {
  const isError = outputOrError instanceof Error;
  const input = { task, messagesSummary: summarizeMessages(contextMessages) };
  await recordStep(ctx, {
    stage,
    stepType: "model",
    toolName: null,
    input,
    output: isError ? null : outputOrError,
    status: isError ? "failed" : "succeeded",
    durationMs,
    usage: usage ?? null,
    error: isError
      ? { code: outputOrError instanceof AgentError ? outputOrError.code : "UNKNOWN", message: outputOrError.message }
      : null,
  });
}

// Single dispatch path for registry tools: validates the input against the
// tool's schema, times the execution, records the tool step with the measured
// duration, and returns the ToolResult. Budget pre-consume, permission checks
// and error mapping stay inside the tool modules. `options.execute`
// substitutes the executor (DI test seam); `options.recordOutput` customizes
// what lands in the step row (e.g. page metadata instead of fetched content).
async function dispatchCurriculumTool<TInput, TDeps, TData>(
  ctx: PipelineContext,
  stage: CurriculumRunStage,
  tool: CurriculumToolDefinition<TInput, TDeps, TData>,
  rawInput: unknown,
  toolDeps: TDeps,
  options: {
    execute?: (input: TInput) => Promise<ToolResult<TData>>;
    recordOutput?: (result: ToolResult<TData>) => unknown;
  } = {},
): Promise<ToolResult<TData>> {
  const input = tool.inputSchema.parse(rawInput);
  const start = Date.now();
  const result = options.execute ? await options.execute(input) : await tool.execute(input, toolDeps);
  const durationMs = Date.now() - start;
  await recordToolStep(
    ctx,
    stage,
    tool.name,
    input,
    options.recordOutput
      ? options.recordOutput(result)
      : result.ok
        ? result.data
        : { error: { code: result.code, message: result.message } },
    durationMs,
  );
  return result;
}

async function recordToolStep(
  ctx: PipelineContext,
  stage: CurriculumRunStage,
  toolName: string,
  input: unknown,
  output: unknown,
  durationMs: number,
): Promise<void> {
  const isError = output && typeof output === "object" && "error" in output;
  await recordStep(ctx, {
    stage,
    stepType: "tool",
    toolName,
    input,
    output: isError ? null : output,
    status: isError ? "failed" : "succeeded",
    durationMs,
    usage: null,
    error: isError ? (output as { error: { code: string; message: string } }).error : null,
  });
}

async function recordValidationStep(
  ctx: PipelineContext,
  draft: CurriculumDraft,
  validation: CurriculumValidationResult,
): Promise<void> {
  await recordStep(ctx, {
    stage: "validating",
    stepType: "validation",
    toolName: null,
    input: { nodeCount: countNodes(draft), sourceCount: draft.sources.length },
    output: { valid: validation.valid, blockingCount: validation.blockingCount, advisoryCount: validation.advisoryCount },
    status: validation.valid ? "succeeded" : "failed",
    durationMs: 0,
    usage: null,
    error: validation.valid
      ? null
      : { code: "CURRICULUM_VALIDATION_FAILED", message: `${validation.blockingCount} blocking issues` },
  });
}

async function recordPersistenceStep(
  ctx: PipelineContext,
  operation: string,
  output: unknown,
): Promise<void> {
  await recordStep(ctx, {
    stage: "saving_draft",
    stepType: "persistence",
    toolName: null,
    input: { operation },
    output,
    status: "succeeded",
    durationMs: 0,
    usage: null,
    error: null,
  });
}

async function recordStep(
  ctx: PipelineContext,
  partial: Omit<RecordStepInput, "runId" | "stepNumber">,
): Promise<void> {
  const { deps, run } = ctx;
  const { runService } = deps;
  const stepNumber = ctx.stepCounter.value;
  ctx.stepCounter.value += 1;
  await runService.completeStep({
    runId: run.id,
    stepNumber,
    stage: partial.stage,
    stepType: partial.stepType,
    toolName: partial.toolName ?? null,
    input: partial.input,
    output: partial.output ?? null,
    status: partial.status,
    durationMs: partial.durationMs,
    usage: partial.usage ?? null,
    error: partial.error ?? null,
  });
}

function summarizeMessages(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  return JSON.stringify(
    messages.map((message) => ({
      role: message.role,
      chars: message.content.length,
      sha256: hashTelemetryText(message.content),
    })),
  );
}

function countNodes(draft: CurriculumDraft): number {
  return draft.modules.reduce((sum, module) => sum + module.nodes.length, 0);
}

function buildDraftDigest(draft: CurriculumDraft): string {
  const lines = [
    `标题：${draft.title}`,
    `受众：${draft.audience}`,
    `目标：${draft.learningGoal}`,
    `模块数：${draft.modules.length}`,
    `节点数：${countNodes(draft)}`,
    `来源数：${draft.sources.length}`,
    ...draft.modules.map(
      (module) =>
        `模块 ${module.orderIndex + 1}：${module.title}（${module.required ? "必修" : "选修"}）- 节点：${module.nodes.map((node) => node.title).join("、")}`,
    ),
  ];
  return lines.join("\n");
}
