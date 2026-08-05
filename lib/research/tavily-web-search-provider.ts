// Tavily-backed WebSearchProvider (spec §10, decision D7 in
// docs/agent-refactor-impact.md). POSTs {api_key, query, max_results,
// search_depth: "basic"} to the Tavily search API, validates the response
// with zod, and maps entries onto WebSearchResult. Each call has its own
// AbortController timeout and one retry for transient failures (5xx, 429,
// network errors, timeouts); 4xx client errors fail immediately.
//
// Configuration: TAVILY_API_KEY (required), TAVILY_API_URL (optional
// endpoint override, mainly for tests). locale/recencyDays from
// WebSearchInput are accepted but ignored in this MVP — Tavily's "basic"
// depth has no recency filter.

import { z } from "zod";
import {
  WebSearchError,
  type WebSearchInput,
  type WebSearchProvider,
  type WebSearchResult,
} from "@/lib/research/web-search-provider";

const DEFAULT_API_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2; // initial attempt + one retry
const MAX_RESULTS_PER_QUERY = 10; // spec §3.6 webSearch limit

const tavilyResultSchema = z.object({
  title: z.string().optional(),
  url: z.string(),
  content: z.string().optional(),
  published_date: z.string().optional(),
});

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultSchema).optional(),
});

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function clampMaxResults(maxResults: number): number {
  if (!Number.isFinite(maxResults)) return 1;
  return Math.min(MAX_RESULTS_PER_QUERY, Math.max(1, Math.floor(maxResults)));
}

function toWebSearchResult(item: z.infer<typeof tavilyResultSchema>): WebSearchResult | null {
  let domain: string;
  try {
    domain = new URL(item.url).hostname.toLowerCase();
  } catch {
    return null; // Skip results with unusable URLs instead of failing the query.
  }
  if (!domain) return null;

  return {
    title: item.title?.trim() || item.url,
    url: item.url,
    snippet: item.content?.trim() || undefined,
    publishedAt: item.published_date?.trim() || undefined,
    domain,
  };
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly id = "tavily";

  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(
    options: {
      apiKey?: string;
      apiUrl?: string;
      timeoutMs?: number;
      maxAttempts?: number;
    } = {},
  ) {
    const apiKey = (options.apiKey ?? process.env.TAVILY_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new WebSearchError(
        "TAVILY_API_KEY is required when WEB_SEARCH_PROVIDER=tavily.",
        "WEB_SEARCH_NOT_CONFIGURED",
      );
    }
    this.apiKey = apiKey;
    this.apiUrl =
      (options.apiUrl ?? process.env.TAVILY_API_URL ?? "").trim() || DEFAULT_API_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  }

  async search(input: WebSearchInput): Promise<WebSearchResult[]> {
    const maxResults = clampMaxResults(input.maxResults);
    const payload = await this.postWithRetry({
      api_key: this.apiKey,
      query: input.query,
      max_results: maxResults,
      search_depth: "basic",
    });

    const parsed = tavilyResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new WebSearchError(
        "Tavily returned an unexpected response shape.",
        "WEB_SEARCH_BAD_RESPONSE",
      );
    }

    return (parsed.data.results ?? [])
      .map(toWebSearchResult)
      .filter((result): result is WebSearchResult => result !== null)
      .slice(0, maxResults);
  }

  private async postWithRetry(body: Record<string, unknown>): Promise<unknown> {
    let lastError: WebSearchError = new WebSearchError(
      "Tavily search failed.",
      "WEB_SEARCH_NETWORK_ERROR",
    );

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(this.apiUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          lastError = new WebSearchError(
            `Tavily search failed with HTTP ${response.status}.`,
            "WEB_SEARCH_HTTP_ERROR",
          );
          const retryable = response.status >= 500 || response.status === 429;
          if (retryable && attempt < this.maxAttempts) continue;
          throw lastError;
        }

        try {
          return await response.json();
        } catch {
          throw new WebSearchError(
            "Tavily returned invalid JSON.",
            "WEB_SEARCH_BAD_RESPONSE",
          );
        }
      } catch (error) {
        if (error instanceof WebSearchError) {
          // HTTP/client and response-shape errors are terminal; no retry.
          throw error;
        }
        lastError = isAbortError(error)
          ? new WebSearchError(
              `Tavily search timed out after ${this.timeoutMs}ms.`,
              "WEB_SEARCH_TIMEOUT",
            )
          : new WebSearchError(
              `Tavily search request failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              "WEB_SEARCH_NETWORK_ERROR",
            );
        if (attempt >= this.maxAttempts) throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  }
}
