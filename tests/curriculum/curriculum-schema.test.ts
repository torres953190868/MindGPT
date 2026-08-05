// Spec §15.1 — CurriculumDraft schema and business-rule rejection tests.

import { describe, expect, it } from "vitest";
import {
  CURRICULUM_LIMITS,
  curriculumDraftSchema,
  type CurriculumDraft,
} from "@/lib/curriculum/curriculum-types";
import { validateCurriculumDraft } from "@/lib/curriculum/curriculum-validation-service";
import {
  createCurriculumModule,
  createCurriculumNode,
  createValidCurriculumDraft,
} from "./fixtures";

function rawDraft(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createValidCurriculumDraft())) as Record<string, unknown>;
}

function warningCodes(draft: CurriculumDraft): string[] {
  return validateCurriculumDraft(draft).warnings.map((warning) => warning.code);
}

describe("curriculumDraftSchema", () => {
  it("rejects a draft with missing required fields", () => {
    expect(curriculumDraftSchema.safeParse({}).success).toBe(false);

    const raw = rawDraft();
    delete raw.title;
    expect(curriculumDraftSchema.safeParse(raw).success).toBe(false);
  });

  it("turns schema violations into blocking warnings", () => {
    const result = validateCurriculumDraft({} as CurriculumDraft);
    expect(result.valid).toBe(false);
    expect(result.blockingCount).toBeGreaterThan(0);
    expect(result.warnings.every((warning) => warning.code === "SCHEMA_ERROR")).toBe(true);
  });

  it("rejects non-positive estimatedMinutes", () => {
    for (const minutes of [0, -15]) {
      const raw = rawDraft();
      (raw.modules as Array<{ nodes: Array<{ estimatedMinutes: number }> }>)[0].nodes[0]
        .estimatedMinutes = minutes;
      expect(curriculumDraftSchema.safeParse(raw).success).toBe(false);

      const result = validateCurriculumDraft(raw as CurriculumDraft);
      expect(result.valid).toBe(false);
      expect(result.warnings.some((warning) => warning.code === "SCHEMA_ERROR")).toBe(true);
    }
  });

  it("rejects difficulty outside the 1-5 range", () => {
    for (const difficulty of [0, 6]) {
      const raw = rawDraft();
      (raw.modules as Array<{ nodes: Array<{ difficulty: number }> }>)[0].nodes[0].difficulty =
        difficulty;
      expect(curriculumDraftSchema.safeParse(raw).success).toBe(false);
    }
  });

  it("rejects illegal enum values", () => {
    const withNodeType = rawDraft();
    (withNodeType.modules as Array<{ nodes: Array<{ nodeType: string }> }>)[0].nodes[0].nodeType =
      "wizardry";
    expect(curriculumDraftSchema.safeParse(withNodeType).success).toBe(false);

    const withImportance = rawDraft();
    (
      withImportance.modules as Array<{ nodes: Array<{ importance: string }> }>
    )[0].nodes[0].importance = "mandatory";
    expect(curriculumDraftSchema.safeParse(withImportance).success).toBe(false);

    const withSourceType = rawDraft();
    (withSourceType.sources as Array<{ sourceType: string }>)[0].sourceType = "blog";
    expect(curriculumDraftSchema.safeParse(withSourceType).success).toBe(false);
  });

  it("accepts the minimal valid fixture draft", () => {
    expect(curriculumDraftSchema.safeParse(createValidCurriculumDraft()).success).toBe(true);
  });
});

describe("validateCurriculumDraft business rules", () => {
  it("rejects duplicate clientIds", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[1].nodes[0].clientId = "n1";
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "DUPLICATE_CLIENT_ID" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("rejects prerequisites pointing at unknown nodes", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[1].prerequisiteClientIds = ["ghost_node"];
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "UNKNOWN_PREREQUISITE" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("rejects sourceIds pointing at unknown sources", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[0].sourceIds = ["ghost_source"];
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "UNKNOWN_SOURCE" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("rejects drafts exceeding the maximum total node count", () => {
    const modules = Array.from({ length: 6 }, (_, moduleIndex) =>
      createCurriculumModule({
        clientId: `big_m${moduleIndex}`,
        title: `Big Module ${moduleIndex}`,
        orderIndex: moduleIndex,
        required: false,
        nodes: Array.from({ length: CURRICULUM_LIMITS.maxNodesPerModule }, (_, nodeIndex) =>
          createCurriculumNode({
            clientId: `big_n${moduleIndex}_${nodeIndex}`,
            title: `Big Node ${moduleIndex}-${nodeIndex}`,
            importance: "optional",
            orderIndex: nodeIndex,
          }),
        ),
      }),
    );
    const draft = { ...createValidCurriculumDraft(), modules };
    expect(modules.flatMap((module) => module.nodes).length).toBeGreaterThan(
      CURRICULUM_LIMITS.maxNodesTotal,
    );
    // The per-collection caps pass schema validation; the cross-module total
    // is caught by the business layer.
    expect(curriculumDraftSchema.safeParse(draft).success).toBe(true);
    const result = validateCurriculumDraft(draft);
    expect(result.valid).toBe(false);
    expect(
      result.warnings.some(
        (warning) => warning.code === "TOO_MANY_NODES" && warning.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("does not report graph-level unknown-reference duplicates for bad prerequisites", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[1].prerequisiteClientIds = ["ghost_node"];
    expect(warningCodes(draft)).not.toContain("UNKNOWN_NODE_REFERENCE");
  });
});
