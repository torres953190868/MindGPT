// webSearch tool for the CurriculumBuilderAgent (spec §3.6). Read-only: runs
// one provider query, dedupes the results (canonical-URL dedupe from the
// source normalizer), and consumes one search-query budget unit. Provider
// failures — including the disabled provider — degrade to
// { ok: false } so the runner can mark the query failed and continue with the
// remaining evidence (spec §15.5: search failure is degradable); only budget
// exhaustion propagates.

import { z } from "zod";
import type { AgentBudgetTracker } from "@/lib/agent-runtime/agent-budget";
import { toolError, toolOk, type ToolResult } from "@/lib/agents/curriculum-builder/tools/tool-result";
import { dedupeSearchResults } from "@/lib/research/source-normalizer";
import {
  WebSearchError,
  type WebSearchProvider,
  type WebSearchResult,
} from "@/lib/research/web-search-provider";

// Spec §3.6: at most 10 results per call.
export const WEB_SEARCH_TOOL_MAX_RESULTS = 10;

export const webSearchToolInputSchema = z.object({
  query: z.string().trim().min(1).max(300),
  maxResults: z.number().int().positive().max(WEB_SEARCH_TOOL_MAX_RESULTS).optional(),
});
export type WebSearchToolInput = z.infer<typeof webSearchToolInputSchema>;

export type WebSearchToolData = {
  query: string;
  providerId: string;
  results: WebSearchResult[];
};

export type WebSearchToolDeps = {
  provider: WebSearchProvider;
  budget: AgentBudgetTracker;
};

export async function executeWebSearchTool(
  rawInput: WebSearchToolInput,
  deps: WebSearchToolDeps,
): Promise<ToolResult<WebSearchToolData>> {
  const input = webSearchToolInputSchema.parse(rawInput);
  const maxResults = input.maxResults ?? WEB_SEARCH_TOOL_MAX_RESULTS;

  // Budget consumption happens BEFORE the provider call: a search attempt
  // costs the same whether it succeeds or fails. Budget exhaustion throws
  // AgentError(AGENT_BUDGET_EXHAUSTED), which deliberately propagates.
  deps.budget.consumeSearch();

  try {
    const results = await deps.provider.search({ query: input.query, maxResults });
    return toolOk({
      query: input.query,
      providerId: deps.provider.id,
      results: dedupeSearchResults(results),
    });
  } catch (error) {
    if (error instanceof WebSearchError) {
      return toolError(error.code, error.message);
    }
    return toolError(
      "WEB_SEARCH_FAILED",
      error instanceof Error ? error.message : "Web search failed.",
    );
  }
}
