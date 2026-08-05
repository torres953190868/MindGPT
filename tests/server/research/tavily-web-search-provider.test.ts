import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TavilyWebSearchProvider } from "@/lib/research/tavily-web-search-provider";
import { getWebSearchProvider } from "@/lib/research/web-search-provider";

const API_URL = "https://tavily.test/search";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(options: { timeoutMs?: number } = {}) {
  return new TavilyWebSearchProvider({
    apiKey: "test-key",
    apiUrl: API_URL,
    ...options,
  });
}

beforeEach(() => {
  vi.stubEnv("TAVILY_API_KEY", "test-key");
  vi.stubEnv("TAVILY_API_URL", API_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("TavilyWebSearchProvider", () => {
  it("requires an API key", () => {
    vi.stubEnv("TAVILY_API_KEY", "");

    expect(() => new TavilyWebSearchProvider()).toThrowError(/TAVILY_API_KEY is required/);
    try {
      new TavilyWebSearchProvider();
      expect.unreachable("expected the constructor to throw");
    } catch (error) {
      expect(error).toMatchObject({
        name: "WebSearchError",
        code: "WEB_SEARCH_NOT_CONFIGURED",
      });
    }
  });

  it("posts the expected request and maps results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: "CS231n Notes",
            url: "https://cs231n.github.io/convnets",
            content: "Convolutional networks course notes.",
            published_date: "2026-01-01",
          },
          {
            title: "",
            url: "https://example.com/guide?x=1",
            content: "  ",
          },
          { title: "Broken", url: "not a url" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await createProvider().search({
      query: "convolutional networks",
      maxResults: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      api_key: "test-key",
      query: "convolutional networks",
      max_results: 5,
      search_depth: "basic",
    });

    expect(results).toEqual([
      {
        title: "CS231n Notes",
        url: "https://cs231n.github.io/convnets",
        snippet: "Convolutional networks course notes.",
        publishedAt: "2026-01-01",
        domain: "cs231n.github.io",
      },
      {
        // Empty title/content fall back to the URL / undefined.
        title: "https://example.com/guide?x=1",
        url: "https://example.com/guide?x=1",
        snippet: undefined,
        publishedAt: undefined,
        domain: "example.com",
      },
    ]);
  });

  it("clamps maxResults into the provider's 1..10 range", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createProvider().search({ query: "q", maxResults: 50 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).max_results).toBe(10);
  });

  it("retries once on HTTP 500 and then fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProvider().search({ query: "q", maxResults: 3 }),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_HTTP_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors like HTTP 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProvider().search({ query: "q", maxResults: 3 }),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_HTTP_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProvider().search({ query: "q", maxResults: 3 }),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps aborts to a timeout error", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProvider({ timeoutMs: 20 }).search({ query: "q", maxResults: 3 }),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_TIMEOUT" });
    // The timeout is transient: one retry, so two attempts in total.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON and unexpected response shapes without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true, results: "nope" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProvider().search({ query: "q", maxResults: 3 }),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_BAD_RESPONSE" });
    await expect(
      createProvider().search({ query: "q", maxResults: 3 }),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_BAD_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getWebSearchProvider tavily wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the Tavily provider when configured with an API key", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-key");

    const provider = getWebSearchProvider();

    expect(provider).toBeInstanceOf(TavilyWebSearchProvider);
    expect(provider.id).toBe("tavily");
  });

  it("uses TAVILY_API_URL when the env override is set", async () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubEnv("TAVILY_API_URL", API_URL);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getWebSearchProvider().search({ query: "q", maxResults: 3 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(API_URL);
  });
});
