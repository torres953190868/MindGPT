import type {
  WebSearchInput,
  WebSearchProvider,
  WebSearchResult,
} from "@/lib/research/web-search-provider";

const MOCK_DOMAINS = ["example.com", "example.org", "example.net"];
const GENERATED_RESULT_COUNT = 3;

// 32-bit FNV-1a hash so generated results are stable across runs and machines.
function hashQuery(query: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < query.length; index += 1) {
    hash ^= query.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clampMaxResults(maxResults: number) {
  return Number.isFinite(maxResults) ? Math.max(0, Math.floor(maxResults)) : 0;
}

function generateResults(query: string, limit: number): WebSearchResult[] {
  const hash = hashQuery(query);
  const count = Math.min(GENERATED_RESULT_COUNT, limit);

  return Array.from({ length: count }, (_, index) => {
    const domain = MOCK_DOMAINS[(hash + index) % MOCK_DOMAINS.length];
    return {
      title: `Mock result ${index + 1} for "${query}"`,
      url: `https://${domain}/mock-search/${hash.toString(16)}/${index + 1}`,
      snippet: `Deterministic mock snippet ${index + 1} for "${query}".`,
      domain,
    };
  });
}

// Deterministic fake provider for tests, CI, and E2E (spec §15.5: tests must
// never hit the real network). Constructor fixtures map exact query strings to
// canned results; unknown queries fall back to hash-generated results.
export class MockWebSearchProvider implements WebSearchProvider {
  readonly id = "mock";

  private readonly fixtures: Record<string, WebSearchResult[]>;

  constructor(fixtures: Record<string, WebSearchResult[]> = {}) {
    this.fixtures = fixtures;
  }

  async search(input: WebSearchInput): Promise<WebSearchResult[]> {
    const limit = clampMaxResults(input.maxResults);
    const results = this.fixtures[input.query] ?? generateResults(input.query, limit);
    return results.slice(0, limit);
  }
}
