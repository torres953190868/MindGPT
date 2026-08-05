import { describe, expect, it } from "vitest";
import type { CurriculumSourceType } from "@/lib/curriculum/curriculum-types";
import { scoreSource } from "@/lib/research/source-quality-service";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("scoreSource base scores", () => {
  it.each([
    ["university_course", 0.85],
    ["textbook", 0.85],
    ["official_documentation", 0.8],
    ["standard", 0.75],
    ["research_paper", 0.7],
    ["industry_guide", 0.5],
    ["other", 0.35],
  ] as Array<[CurriculumSourceType, number]>)(
    "gives %s a base score of %f",
    (sourceType, expected) => {
      const { score, reasons } = scoreSource(
        { url: "https://example.com/x", sourceType },
        { now: NOW },
      );

      expect(score).toBe(expected);
      expect(reasons[0]).toContain(sourceType);
    },
  );
});

describe("scoreSource adjustments", () => {
  it("bumps academic and government domains", () => {
    expect(
      scoreSource(
        { url: "https://cs229.stanford.edu/notes", sourceType: "other" },
        { now: NOW },
      ).score,
    ).toBe(0.4); // 0.35 + 0.05
    expect(
      scoreSource(
        { url: "https://www.nist.gov/publications/x", sourceType: "other" },
        { now: NOW },
      ).score,
    ).toBe(0.4);
  });

  it("penalizes self-published platforms", () => {
    const { score, reasons } = scoreSource(
      { url: "https://medium.com/@u/post", sourceType: "industry_guide" },
      { now: NOW },
    );

    expect(score).toBe(0.45); // 0.5 - 0.05
    expect(reasons.join(" ")).toContain("self-published platform");
  });

  it("rewards recent publication dates", () => {
    const recent = scoreSource(
      {
        url: "https://example.com/x",
        sourceType: "other",
        publishedAt: "2026-01-01T00:00:00.000Z",
      },
      { now: NOW },
    );
    const stale = scoreSource(
      {
        url: "https://example.com/x",
        sourceType: "other",
        publishedAt: "2000-01-01T00:00:00.000Z",
      },
      { now: NOW },
    );

    expect(recent.score).toBe(0.4); // 0.35 + 0.05
    expect(stale.score).toBe(0.35);
  });

  it("ignores unparseable publication dates", () => {
    const { score, reasons } = scoreSource(
      { url: "https://example.com/x", sourceType: "other", publishedAt: "someday" },
      { now: NOW },
    );

    expect(score).toBe(0.35);
    expect(reasons.join(" ")).toContain("unparseable");
  });

  it("rewards having a snippet", () => {
    const withSnippet = scoreSource(
      { url: "https://example.com/x", sourceType: "other", snippet: "A guide." },
      { now: NOW },
    );

    expect(withSnippet.score).toBe(0.4); // 0.35 + 0.05
  });

  it("clamps the total at 1 and stays deterministic", () => {
    const input = {
      url: "https://cs229.stanford.edu/notes",
      sourceType: "university_course" as const,
      publishedAt: "2026-06-01T00:00:00.000Z",
      snippet: "Stanford course notes.",
    };

    const first = scoreSource(input, { now: NOW });
    const second = scoreSource(input, { now: NOW });

    expect(first.score).toBe(1); // 0.85 + 0.05 + 0.05 + 0.05, clamped at 1
    expect(first).toEqual(second);
    expect(first.score).toBeLessThanOrEqual(1);
    expect(first.reasons.length).toBeGreaterThan(2);
  });
});
