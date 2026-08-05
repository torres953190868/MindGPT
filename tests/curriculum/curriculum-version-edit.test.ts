import { describe, expect, it } from "vitest";
import { applyCurriculumVersionPatch } from "@/lib/curriculum/curriculum-version-edit-service";
import { diffCurriculumDrafts } from "@/lib/curriculum/curriculum-version-diff-service";
import { createValidCurriculumDraft } from "./fixtures";

describe("curriculum version editing", () => {
  it("applies structured module and metadata patches without mutating the source", () => {
    const source = createValidCurriculumDraft();
    const next = applyCurriculumVersionPatch(source, {
      versionLabel: "Edited v1",
      modules: {
        upsert: [
          {
            clientId: "m1",
            title: "Updated Foundations",
            description: "Updated module description.",
            orderIndex: 0,
            required: true,
          },
        ],
      },
    });

    expect(next.versionLabel).toBe("Edited v1");
    expect(next.modules[0]?.title).toBe("Updated Foundations");
    expect(source.versionLabel).not.toBe("Edited v1");
    expect(source.modules[0]?.title).toBe("Foundations");
  });

  it("removes deleted node references and prerequisite edges", () => {
    const source = createValidCurriculumDraft();
    const next = applyCurriculumVersionPatch(source, { nodes: { delete: ["n2"] } });

    expect(next.modules.flatMap((courseModule) => courseModule.nodes).map((node) => node.clientId)).toEqual([
      "n1",
      "n3",
    ]);
    expect(next.modules[1]?.nodes[0]?.prerequisiteClientIds).toEqual([]);
  });

  it("matches unchanged derived content by structural identity instead of database ids", () => {
    const before = createValidCurriculumDraft();
    const after = structuredClone(before);
    after.modules[0]!.clientId = "persisted-module-copy";
    after.modules[0]!.nodes[0]!.clientId = "persisted-node-copy";
    after.modules[0]!.nodes[1]!.clientId = "persisted-node-copy-2";
    after.modules[1]!.clientId = "persisted-module-copy-2";
    after.modules[1]!.nodes[0]!.clientId = "persisted-node-copy-3";
    after.modules[0]!.nodes[1]!.prerequisiteClientIds = ["persisted-node-copy"];
    after.modules[1]!.nodes[0]!.prerequisiteClientIds = ["persisted-node-copy-2"];

    const diff = diffCurriculumDrafts(before, after, "v2", "v1");

    expect(diff.modules).toHaveLength(0);
    expect(diff.nodes).toHaveLength(0);
    expect(diff.edges).toHaveLength(0);
    expect(diff.sources).toHaveLength(0);
  });
});
