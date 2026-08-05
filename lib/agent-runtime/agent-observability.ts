import { getAgentRunRepository } from "@/lib/agent-runtime/agent-run-repository";
import { aggregateModelCallUsage, summarizeTelemetryValue, type ModelCallUsage } from "@/lib/agent-runtime/agent-usage";
import type { AgentRunDto, AgentRunStatus, AgentType } from "@/lib/agent-runtime/agent-run-types";

export type AgentMetrics = {
  scope: { ownerId: string };
  since: string | null;
  until: string | null;
  runCount: number;
  statusCounts: Record<AgentRunStatus, number>;
  totalDurationMs: number;
  averageDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  failureRate: number;
  topErrorCodes: Array<{ code: string; count: number }>;
};

export type AgentTrace = {
  run: {
    id: string;
    agentType: AgentType;
    status: AgentRunStatus;
    currentStage: string | null;
    modelProvider: string | null;
    modelId: string | null;
    createdAt: string;
    startedAt: string;
    finishedAt: string | null;
    usage: AgentRunDto["usage"];
    errorCode: string | null;
  };
  steps: Array<{
    id: string;
    stepNumber: number;
    stage: string;
    stepType: string;
    toolName: string | null;
    status: string;
    durationMs: number;
    usage: unknown;
    error: unknown;
  }>;
  events: Array<{ id: string; seq: number; type: string; stage?: string; code?: string; createdAt: string }>;
};

const EMPTY_STATUS_COUNTS = (): Record<AgentRunStatus, number> => ({
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
});

function durationForRun(run: AgentRunDto) {
  const started = Date.parse(run.startedAt);
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  if (Number.isFinite(started) && Number.isFinite(finished)) return Math.max(0, finished - started);
  return run.usage?.runtimeMs ?? 0;
}

function modelCallsForRun(run: AgentRunDto): ModelCallUsage[] {
  return (run.usage?.modelCalls ?? []).filter((call): call is ModelCallUsage =>
    Boolean(call && typeof call === "object" && typeof call.provider === "string" && typeof call.model === "string"),
  );
}

export async function getAgentMetricsForOwner(
  ownerId: string,
  options: { sinceIso?: string; untilIso?: string; agentType?: AgentType; limit?: number } = {},
): Promise<AgentMetrics> {
  const runs = await getAgentRunRepository().listRunsForOwner(ownerId, options);
  const statusCounts = EMPTY_STATUS_COUNTS();
  const errors = new Map<string, number>();
  let totalDurationMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;

  for (const run of runs) {
    statusCounts[run.status] += 1;
    totalDurationMs += durationForRun(run);
    const usage = run.usage;
    if (usage) {
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      totalTokens += usage.totalTokens;
      estimatedCostUsd += usage.estimatedCostUsd ?? 0;
    } else {
      const aggregate = aggregateModelCallUsage(modelCallsForRun(run));
      promptTokens += aggregate.promptTokens;
      completionTokens += aggregate.completionTokens;
      totalTokens += aggregate.totalTokens;
      estimatedCostUsd += aggregate.estimatedCostUsd;
    }
    if (run.errorCode) errors.set(run.errorCode, (errors.get(run.errorCode) ?? 0) + 1);
  }

  return {
    scope: { ownerId },
    since: options.sinceIso ?? null,
    until: options.untilIso ?? null,
    runCount: runs.length,
    statusCounts,
    totalDurationMs,
    averageDurationMs: runs.length ? totalDurationMs / runs.length : 0,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
    failureRate: runs.length ? statusCounts.failed / runs.length : 0,
    topErrorCodes: [...errors.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
      .slice(0, 10),
  };
}

export async function getAgentTraceForOwner(ownerId: string, runId: string): Promise<AgentTrace | null> {
  const repository = getAgentRunRepository();
  const run = await repository.getRunByIdForOwner(ownerId, runId);
  if (!run) return null;
  const [steps, events] = await Promise.all([
    repository.listSteps(runId),
    repository.listEventsAfter(runId, 0),
  ]);
  return {
    run: {
      id: run.id,
      agentType: run.agentType,
      status: run.status,
      currentStage: run.currentStage,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      usage: run.usage,
      errorCode: run.errorCode,
    },
    steps: steps.map((step) => ({
      id: step.id,
      stepNumber: step.stepNumber,
      stage: step.stage,
      stepType: step.stepType,
      toolName: step.toolName,
      status: step.status,
      durationMs: step.durationMs,
      usage: summarizeTelemetryValue(step.usage),
      error: summarizeTelemetryValue(step.error),
    })),
    events: events.map((entry) => {
      const event = entry.event as { type?: unknown; stage?: unknown; code?: unknown };
      return {
        id: entry.id,
        seq: entry.seq,
        type: typeof event.type === "string" ? event.type : "unknown",
        ...(typeof event.stage === "string" ? { stage: event.stage } : {}),
        ...(typeof event.code === "string" ? { code: event.code } : {}),
        createdAt: entry.createdAt,
      };
    }),
  };
}
