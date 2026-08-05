import { afterEach, describe, expect, it, vi } from "vitest";
import { MockWebSearchProvider } from "@/lib/research/mock-web-search-provider";
import {
  DisabledWebSearchProvider,
  FallbackWebSearchProvider,
  getWebSearchProvider,
  WebSearchError,
  type WebSearchProvider,
  type WebSearchResult,
} from "@/lib/research/web-search-provider";

const fixtures: Record<string, WebSearchResult[]> = {
  "neural networks": [
    {
      title: "Neural Networks and Deep Learning",
      url: "https://example.com/nn-book",
      snippet: "A free online book on neural networks.",
      publishedAt: "2026-01-01T00:00:00.000Z",
      domain: "example.com",
    },
    {
      title: "CS231n Convolutional Neural Networks",
      url: "https://example.org/cs231n",
      snippet: "Stanford course notes on CNNs.",
      domain: "example.org",
    },
    {
      title: "The Neural Network Zoo",
      url: "https://example.net/nn-zoo",
      snippet: "A cheat sheet of network architectures.",
      domain: "example.net",
    },
  ],
};

describe("MockWebSearchProvider", () => {
  it("returns canned fixture results for known queries", async () => {
    const provider = new MockWebSearchProvider(fixtures);
    const results = await provider.search({
      query: "neural networks",
      maxResults: 10,
    });

    expect(results).toEqual(fixtures["neural networks"]);
  });

  it("caps fixture results at maxResults", async () => {
    const provider = new MockWebSearchProvider(fixtures);
    const results = await provider.search({
      query: "neural networks",
      maxResults: 2,
    });

    expect(results).toEqual(fixtures["neural networks"].slice(0, 2));
  });

  it("generates deterministic results for unknown queries", async () => {
    const provider = new MockWebSearchProvider();
    const first = await provider.search({
      query: "photosynthesis",
      maxResults: 5,
    });
    const second = await provider.search({
      query: "photosynthesis",
      maxResults: 5,
    });

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    for (const result of first) {
      expect(result.title).toContain("photosynthesis");
      expect(result.domain).toBe(new URL(result.url).hostname);
    }
  });

  it("caps generated results at maxResults", async () => {
    const provider = new MockWebSearchProvider();

    expect(
      await provider.search({ query: "photosynthesis", maxResults: 2 }),
    ).toHaveLength(2);
    expect(
      await provider.search({ query: "photosynthesis", maxResults: 0 }),
    ).toHaveLength(0);
  });
});

describe("DisabledWebSearchProvider", () => {
  it("fails loudly with a clear code", async () => {
    const provider: WebSearchProvider = new DisabledWebSearchProvider();

    await expect(
      provider.search({ query: "anything", maxResults: 3 }),
    ).rejects.toMatchObject({
      name: "WebSearchError",
      code: "WEB_SEARCH_NOT_CONFIGURED",
    });
  });
});

describe("FallbackWebSearchProvider", () => {
  it("uses the fallback only when the primary fails", async () => {
    const primary: WebSearchProvider = {
      id: "primary",
      search: vi.fn().mockRejectedValue(new WebSearchError("outage", "PRIMARY_DOWN")),
    };
    const fallback: WebSearchProvider = {
      id: "fallback",
      search: vi.fn().mockResolvedValue(fixtures["neural networks"]),
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const results = await new FallbackWebSearchProvider(primary, fallback).search({
      query: "neural networks",
      maxResults: 2,
    });

    expect(results).toEqual(fixtures["neural networks"]);
    expect(fallback.search).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("BranchMind web search provider degraded", {
      provider: "primary",
      fallback: "fallback",
      code: "PRIMARY_DOWN",
    });
    warning.mockRestore();
  });
});

describe("getWebSearchProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the disabled provider by default", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "");

    const provider = getWebSearchProvider();

    expect(provider).toBeInstanceOf(DisabledWebSearchProvider);
    expect(provider.id).toBe("disabled");
  });

  it("returns the mock provider when WEB_SEARCH_PROVIDER=mock", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "mock");

    const provider = getWebSearchProvider();

    expect(provider).toBeInstanceOf(MockWebSearchProvider);
    expect(provider.id).toBe("mock");
  });

  it("throws WEB_SEARCH_NOT_CONFIGURED for tavily without an API key", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "");

    expect(() => getWebSearchProvider()).toThrowError(WebSearchError);
    expect(() => getWebSearchProvider()).toThrowError(/TAVILY_API_KEY is required/);
  });

  it("wraps Tavily with the configured mock fallback", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubEnv("WEB_SEARCH_FALLBACK_PROVIDER", "mock");

    const provider = getWebSearchProvider();

    expect(provider).toBeInstanceOf(FallbackWebSearchProvider);
    expect(provider.id).toBe("tavily");
  });

  it("rejects unsupported provider ids", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "bing");

    expect(() => getWebSearchProvider()).toThrowError(WebSearchError);
    expect(() => getWebSearchProvider()).toThrowError(
      /"bing" is not supported/,
    );
  });
});
