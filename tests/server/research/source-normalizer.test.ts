import { describe, expect, it } from "vitest";
import { curriculumSourceSchema } from "@/lib/curriculum/curriculum-types";
import {
  canonicalizeUrl,
  dedupeSearchResults,
  inferSourceType,
  toCurriculumSourceCandidate,
} from "@/lib/research/source-normalizer";
import type { WebSearchResult } from "@/lib/research/web-search-provider";

describe("canonicalizeUrl", () => {
  it.each([
    ["https://example.com/page#section", "https://example.com/page"],
    ["https://EXAMPLE.com/Page", "https://example.com/Page"],
    ["https://example.com:443/page", "https://example.com/page"],
    ["http://example.com:80/page", "http://example.com/page"],
    [
      "https://example.com/p?utm_source=x&utm_medium=y&real=1",
      "https://example.com/p?real=1",
    ],
    ["https://example.com/p?fbclid=abc", "https://example.com/p"],
    ["https://example.com/p?gclid=abc&UTM_campaign=c", "https://example.com/p"],
    ["https://example.com/path/", "https://example.com/path"],
    ["https://example.com/", "https://example.com/"],
    ["https://example.com", "https://example.com/"],
    ["https://example.com/?utm_source=x", "https://example.com/"],
  ])("canonicalizes %s", (input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it.each(["not a url", "ftp://example.com/file", "file:///etc/passwd", ""])(
    "returns null for %s",
    (input) => {
      expect(canonicalizeUrl(input)).toBeNull();
    },
  );
});

describe("dedupeSearchResults", () => {
  function result(url: string, title = url): WebSearchResult {
    return { title, url, domain: new URL(url).hostname };
  }

  it("dedupes by canonical url, keeping the first occurrence", () => {
    const results = dedupeSearchResults([
      result("https://example.com/page?utm_source=a", "first"),
      result("https://example.com/page#top", "second"),
      result("https://EXAMPLE.com/page/", "third"),
      result("https://other.com/page", "other"),
    ]);

    expect(results.map((entry) => entry.title)).toEqual(["first", "other"]);
  });

  it("keeps results whose urls cannot be canonicalized", () => {
    const broken: WebSearchResult = { title: "broken", url: "not a url", domain: "" };

    expect(dedupeSearchResults([broken, broken])).toHaveLength(1);
  });
});

describe("inferSourceType", () => {
  it.each([
    ["https://arxiv.org/abs/1706.03762", "research_paper"],
    ["https://doi.org/10.1000/xyz", "research_paper"],
    ["https://scholar.google.com/citations?user=x", "research_paper"],
    ["https://www.rfc-editor.org/rfc/rfc9110", "standard"],
    ["https://www.w3.org/TR/html52/", "standard"],
    ["https://cs229.stanford.edu/syllabus.html", "university_course"],
    ["https://ocw.mit.edu/courses/6-034/", "university_course"],
    ["https://www.tsinghua.edu.cn/info/1/2.htm", "university_course"],
    ["https://www.cs.ox.ac.uk/teaching/", "university_course"],
    ["https://docs.python.org/3/tutorial/", "official_documentation"],
    ["https://developer.mozilla.org/en-US/docs/Web", "official_documentation"],
    ["https://learn.microsoft.com/en-us/training/", "official_documentation"],
    ["https://example.com/docs/getting-started", "official_documentation"],
    ["https://oreilly.com/library/view/title/1/", "textbook"],
    ["https://link.springer.com/book/10.1007/978", "textbook"],
    ["https://example.com/isbn/9780134685991", "textbook"],
    ["https://medium.com/@user/post", "industry_guide"],
    ["https://example.substack.com/p/post", "industry_guide"],
    ["https://blog.example.com/post", "industry_guide"],
    ["https://example.com/blog/post", "industry_guide"],
    ["https://random-site.org/some/page", "other"],
    ["not a url", "other"],
  ])("infers %s as %s", (url, expected) => {
    expect(inferSourceType(url)).toBe(expected);
  });
});

describe("toCurriculumSourceCandidate", () => {
  it("maps a search result onto a schema-valid CurriculumSource", () => {
    const candidate = toCurriculumSourceCandidate(
      {
        title: "  CS231n Convolutional Neural Networks  ",
        url: "https://cs231n.github.io/?utm_source=x#top",
        snippet: "Course notes.",
        domain: "cs231n.github.io",
      },
      { fetchedAt: "2026-08-01T00:00:00.000Z", qualityScore: 0.9 },
    );

    expect(candidate.url).toBe("https://cs231n.github.io/");
    expect(candidate.title).toBe("CS231n Convolutional Neural Networks");
    expect(candidate.publisher).toBe("cs231n.github.io");
    expect(candidate.sourceType).toBe("other"); // github.io matches no heuristic rule
    expect(candidate.retrievedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(candidate.qualityScore).toBe(0.9);
    expect(candidate.id).toMatch(/^csrc_/);
    expect(curriculumSourceSchema.safeParse(candidate).success).toBe(true);
  });

  it("clamps the quality score and falls back to a usable title", () => {
    const candidate = toCurriculumSourceCandidate(
      { title: "   ", url: "https://example.com/x", domain: "example.com" },
      { fetchedAt: "2026-08-01T00:00:00.000Z", qualityScore: 7 },
    );

    expect(candidate.title).toBe("example.com");
    expect(candidate.qualityScore).toBe(1);
    expect(curriculumSourceSchema.safeParse(candidate).success).toBe(true);
  });
});
