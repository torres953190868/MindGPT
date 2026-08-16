// Static registry of the CurriculumBuilderAgent's tools (spec §3.6). One
// place owns each tool's name, input schema, canonical executor, and the
// budget dimension a recorded call restores into on resume — the runner's
// dispatch helper and the budget-restore logic both read from here instead
// of keeping separate hardcoded lists. Tool BEHAVIOR stays in the tool
// modules (budget pre-consume, seenUrls allowlist, owner scoping); this is
// deliberately not a plugin system: no dynamic registration, no discovery,
// no env config.

import type { z } from "zod";
import {
  executeFetchWebPageTool,
  fetchWebPageToolInputSchema,
  type FetchWebPageToolDeps,
  type FetchWebPageToolInput,
  type FetchWebPageToolData,
} from "@/lib/agents/curriculum-builder/tools/fetch-web-page-tool";
import {
  executeGetExistingCurriculumTool,
  getExistingCurriculumToolInputSchema,
  type ExistingCurriculumSummary,
  type GetExistingCurriculumToolDeps,
  type GetExistingCurriculumToolInput,
} from "@/lib/agents/curriculum-builder/tools/get-existing-curriculum-tool";
import {
  executeSearchProjectDocumentsTool,
  searchProjectDocumentsToolInputSchema,
  type ProjectDocumentSnippet,
  type SearchProjectDocumentsToolDeps,
  type SearchProjectDocumentsToolInput,
} from "@/lib/agents/curriculum-builder/tools/search-project-documents-tool";
import type { ToolResult } from "@/lib/agents/curriculum-builder/tools/tool-result";
import {
  executeWebSearchTool,
  webSearchToolInputSchema,
  type WebSearchToolData,
  type WebSearchToolDeps,
  type WebSearchToolInput,
} from "@/lib/agents/curriculum-builder/tools/web-search-tool";

// The budget counter one recorded call of the tool re-consumes on restore
// (AgentBudgetConsumption field names); null = the call is budget-free.
export type CurriculumToolBudgetDimension = "searchQueries" | "fetchedPages";

export type CurriculumToolDefinition<TInput = unknown, TDeps = unknown, TData = unknown> = {
  name: string;
  inputSchema: z.ZodType<TInput>;
  budgetDimension: CurriculumToolBudgetDimension | null;
  execute: (input: TInput, deps: TDeps) => Promise<ToolResult<TData>>;
};

export const CURRICULUM_TOOLS = {
  webSearch: {
    name: "webSearch",
    inputSchema: webSearchToolInputSchema,
    budgetDimension: "searchQueries" as const,
    execute: executeWebSearchTool,
  } satisfies CurriculumToolDefinition<WebSearchToolInput, WebSearchToolDeps, WebSearchToolData>,
  fetchWebPage: {
    name: "fetchWebPage",
    inputSchema: fetchWebPageToolInputSchema,
    budgetDimension: "fetchedPages" as const,
    execute: executeFetchWebPageTool,
  } satisfies CurriculumToolDefinition<FetchWebPageToolInput, FetchWebPageToolDeps, FetchWebPageToolData>,
  searchProjectDocuments: {
    name: "searchProjectDocuments",
    inputSchema: searchProjectDocumentsToolInputSchema,
    // Budget is pre-consumed by the runner (project retrieval shares
    // maxSearchQueries with web search), so a recorded call restores one
    // search unit even though the tool itself holds no budget reference.
    budgetDimension: "searchQueries" as const,
    execute: executeSearchProjectDocumentsTool,
  } satisfies CurriculumToolDefinition<
    SearchProjectDocumentsToolInput,
    SearchProjectDocumentsToolDeps,
    { snippets: ProjectDocumentSnippet[] }
  >,
  getExistingCurriculum: {
    name: "getExistingCurriculum",
    inputSchema: getExistingCurriculumToolInputSchema,
    budgetDimension: null,
    execute: executeGetExistingCurriculumTool,
  } satisfies CurriculumToolDefinition<
    GetExistingCurriculumToolInput,
    GetExistingCurriculumToolDeps,
    { curricula: ExistingCurriculumSummary[] }
  >,
};

// The budget dimension a recorded tool step re-consumes on resume; unknown
// tool names restore nothing (same as the old hardcoded mapping).
export function getCurriculumToolBudgetDimension(toolName: string): CurriculumToolBudgetDimension | null {
  for (const tool of Object.values(CURRICULUM_TOOLS)) {
    if (tool.name === toolName) return tool.budgetDimension;
  }
  return null;
}
