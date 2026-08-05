// fetchWebPage tool for the CurriculumBuilderAgent (spec §3.6/§11.2).
// Restrictions enforced HERE (not by the prompt):
// - only URLs that appeared in this run's search results may be fetched — the
//   runner passes the run's seenUrls set (spec §3.6 "只允许抓取搜索结果中
//   出现过的 URL"); anything else is rejected WITHOUT calling the fetcher;
// - the SSRF rules proper (https only, no private/loopback/metadata hosts,
//   redirect re-validation, size/MIME/timeout caps) live in SafeWebFetcher,
//   which every implementation — including the mock — applies.
//
// A single page failing marks only that source failed; the runner continues
// with the others (spec §15.5). Budget exhaustion propagates and fails the
// run. Excerpt persistence goes through the injected persistExcerpts sink
// (default: the real SourceContentService saveSourceChunks) — the runner
// injects a buffering sink because curriculum_sources rows only exist after
// the draft version is persisted, and flushes the buffered excerpts right
// after saving the draft.

import { z } from "zod";
import type { AgentBudgetTracker } from "@/lib/agent-runtime/agent-budget";
import { toolError, toolOk, type ToolResult } from "@/lib/agents/curriculum-builder/tools/tool-result";
import { saveSourceChunks } from "@/lib/research/source-chunk-service";
import {
  SafeWebFetchError,
  type SafeFetchedPage,
  type SafeWebFetcher,
} from "@/lib/research/safe-web-fetcher";
import { canonicalizeUrl } from "@/lib/research/source-normalizer";

export const fetchWebPageToolInputSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
  // The source clientId the excerpts belong to. Server-side source ids are
  // assigned at draft persistence time.
  sourceId: z.string().trim().min(1).max(120),
});
export type FetchWebPageToolInput = z.infer<typeof fetchWebPageToolInputSchema>;

export type FetchWebPageToolData = {
  page: SafeFetchedPage;
  chunkCount: number;
};

export type PersistExcerptsSink = (input: {
  sourceId: string;
  content: string;
  fetchedAt?: string;
}) => Promise<{ chunkCount: number }>;

// Default sink: the SourceContentService. Requires the curriculum_sources row
// to exist already (it returns SOURCE_NOT_FOUND otherwise), which is why the
// runner buffers instead — this default serves callers that persist sources
// before fetching (and unit tests).
export const defaultPersistExcerpts: PersistExcerptsSink = async (input) => {
  const chunks = await saveSourceChunks(input);
  return { chunkCount: chunks.length };
};

export type FetchWebPageToolDeps = {
  fetcher: SafeWebFetcher;
  budget: AgentBudgetTracker;
  // Canonical URLs returned by this run's search stage. Fetches outside this
  // set are rejected before any network/dedupe work happens.
  seenUrls: ReadonlySet<string>;
  persistExcerpts?: PersistExcerptsSink;
};

export async function executeFetchWebPageTool(
  rawInput: FetchWebPageToolInput,
  deps: FetchWebPageToolDeps,
): Promise<ToolResult<FetchWebPageToolData>> {
  const input = fetchWebPageToolInputSchema.parse(rawInput);
  const canonical = canonicalizeUrl(input.url);
  if (!canonical) {
    return toolError("WEB_FETCH_INVALID_URL", `Unparseable URL: ${input.url}`);
  }
  if (!deps.seenUrls.has(canonical)) {
    return toolError(
      "WEB_FETCH_URL_NOT_FROM_SEARCH",
      "Refusing to fetch a URL that did not appear in this run's search results.",
    );
  }

  // One fetch-attempt budget unit per call; exhaustion propagates.
  deps.budget.consumeFetch();

  let page: SafeFetchedPage;
  try {
    page = await deps.fetcher.fetch(input.url);
  } catch (error) {
    if (error instanceof SafeWebFetchError) {
      return toolError(error.code, error.message);
    }
    return toolError(
      "WEB_FETCH_FAILED",
      error instanceof Error ? error.message : "Fetching the page failed.",
    );
  }

  let chunkCount = 0;
  try {
    const persisted = await (deps.persistExcerpts ?? defaultPersistExcerpts)({
      sourceId: input.sourceId,
      content: page.content,
      fetchedAt: page.fetchedAt,
    });
    chunkCount = persisted.chunkCount;
  } catch (error) {
    return toolError(
      "SOURCE_EXCERPT_SAVE_FAILED",
      error instanceof Error ? error.message : "Saving source excerpts failed.",
    );
  }

  return toolOk({ page, chunkCount });
}
