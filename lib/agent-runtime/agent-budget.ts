// Agent budget enforcement (spec §11.4 / §11.6). Budgets are HARD limits: any
// dimension crossing its cap throws AgentError(AGENT_BUDGET_EXHAUSTED), which
// terminates the run; the runner persists the reason. The tracker is pure
// in-memory (one instance per run execution) and unit-testable — persistence
// of the final usage lives in agent_runs.usage_json via snapshot().
//
// "1 Agent Step = 1 model round-trip" (spec §11.4): a single round-trip may
// batch several tool calls, which is why searches/fetches/sources have their
// own counters next to the step counter.

import { AgentError } from "@/lib/agent-runtime/agent-errors";
import {
  aggregateModelCallUsage,
  type ModelCallUsage,
} from "@/lib/agent-runtime/agent-usage";

export type AgentBudgetLimits = {
  maxAgentSteps: number;
  maxTotalTokens: number;
  // Optional dimensions; an absent limit means "unbounded" for that
  // dimension. maxSourceSearches (tutor) aliases maxSearchQueries, and
  // maxRuntimeMs (tutor) applies to both runtime modes.
  maxSearchQueries?: number;
  maxSourceSearches?: number;
  maxFetchedPages?: number;
  maxRepairLoops?: number;
  maxSources?: number;
  maxRetriesPerStage?: number;
  maxOutputTokensPerCall?: number;
  maxRuntimeMsInline?: number;
  maxRuntimeMsQueued?: number;
  maxRuntimeMs?: number;
};

// Spec §11.4, verbatim numbers. 1 Agent Step = 1 model round-trip; a single
// round-trip may batch multiple tool calls.
export const CURRICULUM_AGENT_BUDGET: AgentBudgetLimits = {
  maxAgentSteps: 40,
  maxSearchQueries: 10,
  maxFetchedPages: 20,
  maxRepairLoops: 2,
  maxSources: 30,
  maxRetriesPerStage: 2,
  maxOutputTokensPerCall: 8_000,
  maxTotalTokens: 400_000,
  // inline mode is bound by the function execution limit; the queued mode
  // (reusing the RAG queue pipeline) may run longer.
  maxRuntimeMsInline: 240_000,
  maxRuntimeMsQueued: 600_000,
};

// Spec §11.4, verbatim numbers. The tutor's 6-step
// read-course → read-state → pick-node → read-materials → teach → assess flow
// gets headroom for follow-up questions and assessment.
export const TUTOR_AGENT_BUDGET: AgentBudgetLimits = {
  maxAgentSteps: 8,
  maxSourceSearches: 3,
  maxTotalTokens: 60_000,
  maxRuntimeMs: 90_000,
  maxOutputTokensPerCall: 6_000,
};

// Usage totals written to agent_runs.usage_json (and summarized into daily
// usage by the quota layer, spec §11.6).
export type AgentRunUsage = {
  agentSteps: number;
  searchQueries: number;
  fetchedPages: number;
  repairLoops: number;
  sources: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  runtimeMs: number;
  estimatedCostUsd?: number;
  modelCalls?: ModelCallUsage[];
};

export type AgentRuntimeMode = "inline" | "queued";

type BudgetDimension =
  | "maxAgentSteps"
  | "maxSearchQueries"
  | "maxFetchedPages"
  | "maxRepairLoops"
  | "maxSources"
  | "maxOutputTokensPerCall"
  | "maxTotalTokens"
  | "maxRuntimeMs";

export class AgentBudgetTracker {
  private readonly budget: AgentBudgetLimits;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private usage: Omit<AgentRunUsage, "runtimeMs"> = {
    agentSteps: 0,
    searchQueries: 0,
    fetchedPages: 0,
    repairLoops: 0,
    sources: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  private modelCalls: ModelCallUsage[] = [];

  constructor(budget: AgentBudgetLimits, options: { now?: () => number } = {}) {
    this.budget = budget;
    this.now = options.now ?? Date.now;
    this.startedAtMs = this.now();
  }

  // The configured limits (e.g. maxRetriesPerStage / maxRepairLoops) so
  // runners can align their control flow with the enforced budget.
  get limits(): Readonly<AgentBudgetLimits> {
    return this.budget;
  }

  private searchQueryLimit() {
    return this.budget.maxSearchQueries ?? this.budget.maxSourceSearches;
  }

  private runtimeLimitMs(mode: AgentRuntimeMode) {
    return (
      this.budget.maxRuntimeMs ??
      (mode === "inline" ? this.budget.maxRuntimeMsInline : this.budget.maxRuntimeMsQueued)
    );
  }

  private elapsedMs() {
    return Math.max(0, this.now() - this.startedAtMs);
  }

  private exceed(dimension: BudgetDimension, used: number, limit: number): never {
    throw new AgentError(
      `Agent budget exhausted: ${dimension} (${used}/${limit}).`,
      {
        code: "AGENT_BUDGET_EXHAUSTED",
        expose: true,
        retryable: false,
        status: 500,
        details: { dimension, used, limit },
      },
    );
  }

  private consume(dimension: BudgetDimension, amount: number, limit: number | undefined) {
    if (limit === undefined) return;
    const used = amount;
    if (used > limit) this.exceed(dimension, used, limit);
  }

  consumeStep() {
    this.usage.agentSteps += 1;
    this.consume("maxAgentSteps", this.usage.agentSteps, this.budget.maxAgentSteps);
  }

  consumeSearch() {
    this.usage.searchQueries += 1;
    this.consume("maxSearchQueries", this.usage.searchQueries, this.searchQueryLimit());
  }

  consumeFetch() {
    this.usage.fetchedPages += 1;
    this.consume("maxFetchedPages", this.usage.fetchedPages, this.budget.maxFetchedPages);
  }

  consumeRepair() {
    this.usage.repairLoops += 1;
    this.consume("maxRepairLoops", this.usage.repairLoops, this.budget.maxRepairLoops);
  }

  consumeSource() {
    this.usage.sources += 1;
    this.consume("maxSources", this.usage.sources, this.budget.maxSources);
  }

  // Prompt-side tokens of one model call.
  consumeTokens(n: number) {
    this.usage.promptTokens += n;
    this.usage.totalTokens += n;
    this.consume("maxTotalTokens", this.usage.totalTokens, this.budget.maxTotalTokens);
  }

  // Completion-side tokens of one model call; also enforces the per-call
  // output cap (a model over-producing beyond max_tokens accounting fails the
  // run instead of silently burning the total budget).
  consumeOutputTokens(n: number) {
    if (
      this.budget.maxOutputTokensPerCall !== undefined &&
      n > this.budget.maxOutputTokensPerCall
    ) {
      this.exceed("maxOutputTokensPerCall", n, this.budget.maxOutputTokensPerCall);
    }
    this.usage.completionTokens += n;
    this.usage.totalTokens += n;
    this.consume("maxTotalTokens", this.usage.totalTokens, this.budget.maxTotalTokens);
  }

  recordModelCall(call: ModelCallUsage) {
    this.modelCalls.push({ ...call });
  }

  // Runtime is checked at stage safe-points instead of being "consumed".
  assertWithinRuntime(mode: AgentRuntimeMode) {
    const limit = this.runtimeLimitMs(mode);
    if (limit === undefined) return;
    const elapsed = this.elapsedMs();
    if (elapsed > limit) this.exceed("maxRuntimeMs", elapsed, limit);
  }

  // Remaining budget getters for runners that need to cap iterations.
  get remainingSteps(): number {
    return this.budget.maxAgentSteps === undefined ? Infinity : this.budget.maxAgentSteps - this.usage.agentSteps;
  }

  get remainingSearches(): number {
    const limit = this.searchQueryLimit();
    return limit === undefined ? Infinity : limit - this.usage.searchQueries;
  }

  get remainingFetches(): number {
    return this.budget.maxFetchedPages === undefined ? Infinity : this.budget.maxFetchedPages - this.usage.fetchedPages;
  }

  get remainingSources(): number {
    return this.budget.maxSources === undefined ? Infinity : this.budget.maxSources - this.usage.sources;
  }

  // Current usage totals for agent_runs.usage_json / run telemetry.
  snapshot(): AgentRunUsage {
    const aggregate = aggregateModelCallUsage(this.modelCalls);
    return {
      ...this.usage,
      runtimeMs: this.elapsedMs(),
      ...(this.modelCalls.length > 0
        ? {
            estimatedCostUsd: aggregate.estimatedCostUsd,
            modelCalls: this.modelCalls.map((call) => ({ ...call })),
          }
        : {}),
    };
  }
}
