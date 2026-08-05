// Web search abstraction for the research/curriculum agents (spec §10).
// Agents depend only on WebSearchProvider; the concrete vendor is selected via
// the WEB_SEARCH_PROVIDER env var: empty = DisabledWebSearchProvider (fail
// loudly), "mock" = deterministic fake for tests/CI/E2E, "tavily" = real HTTP
// search via the Tavily API (requires TAVILY_API_KEY).

import { MockWebSearchProvider } from "@/lib/research/mock-web-search-provider";
import { TavilyWebSearchProvider } from "@/lib/research/tavily-web-search-provider";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  domain: string;
};

export type WebSearchInput = {
  query: string;
  maxResults: number;
  locale?: string;
  recencyDays?: number;
};

export interface WebSearchProvider {
  readonly id: string;
  search(input: WebSearchInput): Promise<WebSearchResult[]>;
}

export class WebSearchError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "WebSearchError";
    this.code = code;
  }
}

// Default when no provider is configured: fail loudly instead of silently
// returning empty results, so a misconfigured environment surfaces at once.
export class DisabledWebSearchProvider implements WebSearchProvider {
  readonly id = "disabled";

  async search(): Promise<WebSearchResult[]> {
    throw new WebSearchError(
      "Web search is not configured. Set WEB_SEARCH_PROVIDER to a supported provider.",
      "WEB_SEARCH_NOT_CONFIGURED",
    );
  }
}

/** Keeps provider outages degradable while preserving an explicit disabled boundary. */
export class FallbackWebSearchProvider implements WebSearchProvider {
  readonly id: string;

  constructor(
    private readonly primary: WebSearchProvider,
    private readonly fallback: WebSearchProvider = new DisabledWebSearchProvider(),
  ) {
    this.id = primary.id;
  }

  async search(input: WebSearchInput): Promise<WebSearchResult[]> {
    try {
      return await this.primary.search(input);
    } catch (error) {
      console.warn("BranchMind web search provider degraded", {
        provider: this.primary.id,
        fallback: this.fallback.id,
        code: error instanceof WebSearchError ? error.code : "WEB_SEARCH_FAILED",
      });
      return this.fallback.search(input);
    }
  }
}

export function getWebSearchProvider(): WebSearchProvider {
  const providerId = (process.env.WEB_SEARCH_PROVIDER ?? "").trim().toLowerCase();

  if (!providerId) return new DisabledWebSearchProvider();
  if (providerId === "mock") return new MockWebSearchProvider();
  // Throws WEB_SEARCH_NOT_CONFIGURED when TAVILY_API_KEY is missing.
  if (providerId === "tavily") {
    const fallbackId = (process.env.WEB_SEARCH_FALLBACK_PROVIDER ?? "disabled").trim().toLowerCase();
    const primary = new TavilyWebSearchProvider();
    if (fallbackId !== "mock") return primary;
    return new FallbackWebSearchProvider(primary, new MockWebSearchProvider());
  }

  throw new WebSearchError(
    `WEB_SEARCH_PROVIDER "${providerId}" is not supported.`,
    "WEB_SEARCH_PROVIDER_UNSUPPORTED",
  );
}
