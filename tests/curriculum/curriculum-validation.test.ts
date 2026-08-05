// Blocking vs advisory grading and overall verdicts for
// CurriculumValidationService (spec §9.3 / §15.1-15.2).

import { describe, expect, it } from "vitest";
import {
  CURRICULUM_THRESHOLDS,
  validateCurriculumDraft,
} from "@/lib/curriculum/curriculum-validation-service";
import { createValidCurriculumDraft } from "./fixtures";

describe("validateCurriculumDraft", () => {
  it("accepts a fully valid draft with zero warnings", () => {
    const result = validateCurriculumDraft(createValidCurriculumDraft());
    expect(result.warnings).toEqual([]);
    expect(result.blockingCount).toBe(0);
    expect(result.advisoryCount).toBe(0);
    expect(result.valid).toBe(true);
    // Rubric score slots stay empty until Phase 2's independent LLM scoring.
    expect(result.coverageScore).toBeUndefined();
    expect(result.sequenceScore).toBeUndefined();
    expect(result.prerequisiteScore).toBeUndefined();
    expect(result.sourceQualityScore).toBeUndefined();
    expect(result.difficultyFitScore).toBeUndefined();
  });

  it("blocks when a core node has no supporting source", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[0].sourceIds = [];
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "CORE_NODE_WITHOUT_SOURCE" &&
          warning.severity === "blocking" &&
          warning.nodeClientId === "n1",
      ),
    ).toBe(true);
  });

  it("advises when the course has too few independent sources but stays valid", () => {
    const draft = createValidCurriculumDraft();
    // Two sources of two distinct types keep module coverage and source-type
    // diversity intact, isolating the FEW_SOURCES advisory.
    draft.sources = draft.sources.slice(0, 2);
    for (const courseModule of draft.modules) {
      for (const node of courseModule.nodes) {
        node.sourceIds = node.sourceIds.filter((sourceId) => ["s1", "s2"].includes(sourceId));
      }
    }
    draft.modules[1].nodes[0].sourceIds = ["s1", "s2"];
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(true);
    expect(result.blockingCount).toBe(0);
    expect(
      result.warnings.some(
        (warning) => warning.code === "FEW_SOURCES" && warning.severity === "advisory",
      ),
    ).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "FEW_SOURCE_TYPES")).toBe(false);
  });

  it("advises when all sources share a single type", () => {
    const draft = createValidCurriculumDraft();
    for (const source of draft.sources) source.sourceType = "textbook";
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some(
        (warning) => warning.code === "FEW_SOURCE_TYPES" && warning.severity === "advisory",
      ),
    ).toBe(true);
  });

  it("advises when a required module is backed by fewer than two sources", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[1].nodes[0].sourceIds = ["s3"];
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "CORE_MODULE_SOURCE_SUPPORT" &&
          warning.severity === "advisory" &&
          warning.moduleClientId === "m2",
      ),
    ).toBe(true);
  });

  it("blocks on a circular dependency reported by the graph service", () => {
    const draft = createValidCurriculumDraft();
    // n2 <-> n3 cycle: n3 already depends on n2, so make n2 depend on n3.
    draft.modules[0].nodes[1].prerequisiteClientIds = ["n1", "n3"];
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "CYCLE" && warning.severity === "blocking",
      ),
    ).toBe(true);
    // n2 and n3 are core and blocked by the cycle.
    expect(
      result.warnings.filter((warning) => warning.code === "UNREACHABLE_CORE_NODE"),
    ).toHaveLength(2);
  });

  it("advises on duplicate node titles within one module", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[1].title = draft.modules[0].nodes[0].title;
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "DUPLICATE_NODE_TITLE_IN_MODULE" && warning.severity === "advisory",
      ),
    ).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "DUPLICATE_NODE_TITLE")).toBe(false);
  });

  it("blocks on the exact same node title across different modules", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[1].nodes[0].title = draft.modules[0].nodes[0].title;
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "DUPLICATE_NODE_TITLE" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("blocks on duplicate module orderIndex", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[1].orderIndex = draft.modules[0].orderIndex;
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "DUPLICATE_ORDER_INDEX" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("blocks on duplicate node orderIndex within a module", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[1].orderIndex = draft.modules[0].nodes[0].orderIndex;
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "DUPLICATE_ORDER_INDEX" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("advises when a prerequisite appears later than its target in reading order", () => {
    const draft = createValidCurriculumDraft();
    // Swap the reading order of n1 and n2 inside module m1: n2 still depends
    // on n1, so the dependency now points backwards.
    draft.modules[0].nodes[0].orderIndex = 5;
    draft.modules[0].nodes[1].orderIndex = 0;
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some(
        (warning) => warning.code === "PREREQUISITE_ORDER" && warning.severity === "advisory",
      ),
    ).toBe(true);
  });

  it("valid mirrors blockingCount === 0", () => {
    const validResult = validateCurriculumDraft(createValidCurriculumDraft());
    expect(validResult.valid).toBe(validResult.blockingCount === 0);

    const invalid = createValidCurriculumDraft();
    invalid.modules[1].nodes[0].sourceIds = [];
    const invalidResult = validateCurriculumDraft(invalid);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.valid).toBe(invalidResult.blockingCount === 0);
  });
});

describe("CURRICULUM_THRESHOLDS", () => {
  it("matches the spec §3.9 step 6 values", () => {
    expect(CURRICULUM_THRESHOLDS).toEqual({
      coverageScore: 0.8,
      sequenceScore: 0.8,
      prerequisiteScore: 0.9,
      sourceQualityScore: 0.75,
      difficultyFitScore: 0.8,
    });
  });
});
