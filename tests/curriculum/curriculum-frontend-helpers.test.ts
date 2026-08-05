import { describe, expect, it } from "vitest";
import {
  buildCurriculumBuildRequest,
  isCurriculumGenerationQuotaExhausted,
} from "@/components/curriculum/curriculum-form-helpers";
import {
  flattenCurriculumDiff,
  getBlockingWarningCount,
  resolveCurriculumSourceReferences,
} from "@/components/curriculum/curriculum-preview-helpers";
import type { CurriculumVersionContentResponse } from "@/lib/client/curriculum-api";
import { createValidCurriculumDraft } from "./fixtures";

describe("curriculum frontend helpers", () => {
  it("builds a generation request with the math depth and projects fields", () => {
    const request = buildCurriculumBuildRequest({
      subject: "  Linear algebra  ",
      learningGoal: "  Explain vectors  ",
      currentLevel: "intermediate",
      durationWeeks: "8",
      hoursPerWeek: "4",
      includeMathDepth: "deep",
      includeProjects: true,
    });

    expect(request).toMatchObject({
      subject: "Linear algebra",
      learningGoal: "Explain vectors",
      constraints: {
        durationWeeks: 8,
        hoursPerWeek: 4,
        includeMathDepth: "deep",
        includeProjects: true,
      },
    });
  });

  it("marks an exhausted monthly quota as non-generatable", () => {
    expect(isCurriculumGenerationQuotaExhausted({ remaining: 0 })).toBe(true);
    expect(isCurriculumGenerationQuotaExhausted({ remaining: 1 })).toBe(false);
    expect(isCurriculumGenerationQuotaExhausted({ remaining: null })).toBe(false);
    expect(isCurriculumGenerationQuotaExhausted(null)).toBe(false);
  });

  it("resolves node source ids to linkable source metadata", () => {
    const draft = createValidCurriculumDraft();

    expect(resolveCurriculumSourceReferences(["s1", "missing"], draft.sources)).toEqual([
      { id: "s1", title: "University Course", url: "https://example.edu/course" },
      { id: "missing", title: "missing", url: null },
    ]);
  });

  it("keeps diff sections and changed fields for the preview list", () => {
    const entries = flattenCurriculumDiff({
      fromVersionId: "v2",
      againstVersionId: "v1",
      modules: [{ key: "module:basics", kind: "changed", changedFields: ["title"] }],
      nodes: [{ key: "node:new", kind: "added" }],
      edges: [],
      sources: [{ key: "source:old", kind: "removed" }],
    });

    expect(entries).toEqual([
      { section: "modules", key: "module:basics", kind: "changed", changedFields: ["title"] },
      { section: "nodes", key: "node:new", kind: "added" },
      { section: "sources", key: "source:old", kind: "removed" },
    ]);
  });

  it("uses the larger of reported and materialized blocking warning counts", () => {
    const content = {
      version: {
        id: "v1",
        curriculumId: "c1",
        versionNumber: 1,
        versionLabel: "Draft",
        status: "draft",
        audience: "Beginners",
        assumptions: [],
        exclusions: [],
        conflicts: [],
        estimatedWeeks: null,
        estimatedHours: null,
        createdAt: "2026-08-05T00:00:00.000Z",
        publishedAt: null,
      },
      draft: createValidCurriculumDraft(),
      validation: {
        blockingCount: 2,
        warnings: [{ severity: "blocking" }, { severity: "blocking" }, { severity: "advisory" }],
      },
    } as CurriculumVersionContentResponse;

    expect(getBlockingWarningCount(content)).toBe(2);
  });
});
