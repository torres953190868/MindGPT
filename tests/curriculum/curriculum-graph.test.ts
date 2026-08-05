// Spec §15.2 — dependency graph structure tests for CurriculumGraphService.

import { describe, expect, it } from "vitest";
import {
  buildCurriculumEdges,
  computePrerequisiteSets,
  findCycle,
  topologicalSortCurriculum,
  validateCurriculumGraph,
  type CurriculumGraphEdge,
  type CurriculumGraphNode,
} from "@/lib/curriculum/curriculum-graph-service";
import type { CurriculumImportance } from "@/lib/curriculum/curriculum-types";
import { createValidCurriculumDraft } from "./fixtures";

function gnode(
  clientId: string,
  orderIndex: number,
  importance: CurriculumImportance = "optional",
): CurriculumGraphNode {
  return { clientId, orderIndex, importance };
}

function edge(fromClientId: string, toClientId: string): CurriculumGraphEdge {
  return { fromClientId, toClientId, edgeType: "prerequisite" };
}

function findCycleIssue(nodes: CurriculumGraphNode[], edges: CurriculumGraphEdge[]) {
  return validateCurriculumGraph(nodes, edges).find((issue) => issue.code === "CYCLE");
}

describe("buildCurriculumEdges", () => {
  it("derives prerequisite edges from node prerequisiteClientIds", () => {
    const edges = buildCurriculumEdges(createValidCurriculumDraft());
    expect(edges).toEqual([
      { fromClientId: "n1", toClientId: "n2", edgeType: "prerequisite" },
      { fromClientId: "n2", toClientId: "n3", edgeType: "prerequisite" },
    ]);
  });

  it("collapses duplicate prerequisite entries", () => {
    const draft = createValidCurriculumDraft();
    draft.modules[0].nodes[1].prerequisiteClientIds = ["n1", "n1"];
    expect(buildCurriculumEdges(draft)).toHaveLength(2);
  });
});

describe("validateCurriculumGraph", () => {
  it("flags self loops", () => {
    const issues = validateCurriculumGraph([gnode("a", 0)], [edge("a", "a")]);
    expect(issues.some((issue) => issue.code === "SELF_LOOP")).toBe(true);
    expect(issues.find((issue) => issue.code === "SELF_LOOP")?.nodeClientIds).toEqual(["a"]);
  });

  it("flags references to unknown nodes", () => {
    const issues = validateCurriculumGraph([gnode("a", 0)], [edge("a", "ghost")]);
    expect(issues).toEqual([
      expect.objectContaining({ code: "UNKNOWN_NODE_REFERENCE", nodeClientIds: ["ghost"] }),
    ]);
  });

  it("flags an A -> B -> A circular dependency with the cycle path", () => {
    const nodes = [gnode("a", 0), gnode("b", 1)];
    const edges = [edge("a", "b"), edge("b", "a")];
    const cycle = findCycleIssue(nodes, edges);
    expect(cycle).toBeDefined();
    expect(new Set(cycle?.nodeClientIds)).toEqual(new Set(["a", "b"]));
  });

  it("accepts multiple dependencies on one node", () => {
    const nodes = [gnode("a", 0), gnode("b", 1), gnode("c", 2), gnode("d", 3)];
    const edges = [edge("a", "d"), edge("b", "d"), edge("c", "d")];
    expect(validateCurriculumGraph(nodes, edges)).toEqual([]);
    const ordered = topologicalSortCurriculum(nodes, edges);
    expect(ordered).not.toBeNull();
    expect(ordered!.indexOf("d")).toBeGreaterThan(ordered!.indexOf("a"));
    expect(ordered!.indexOf("d")).toBeGreaterThan(ordered!.indexOf("b"));
    expect(ordered!.indexOf("d")).toBeGreaterThan(ordered!.indexOf("c"));
  });

  it("flags an orphaned core node", () => {
    const nodes = [gnode("a", 0), gnode("b", 1), gnode("x", 2, "core")];
    const issues = validateCurriculumGraph(nodes, [edge("a", "b")]);
    expect(issues).toEqual([
      expect.objectContaining({ code: "ORPHANED_CORE_NODE", nodeClientIds: ["x"] }),
    ]);
  });

  it("does not flag an optional isolated node as orphaned", () => {
    const nodes = [gnode("a", 0), gnode("b", 1), gnode("x", 2, "optional")];
    expect(validateCurriculumGraph(nodes, [edge("a", "b")])).toEqual([]);
  });

  it("flags core nodes made unreachable by a cycle", () => {
    const nodes = [gnode("a", 0), gnode("b", 1), gnode("c", 2, "core")];
    const edges = [edge("a", "b"), edge("b", "a"), edge("b", "c")];
    const issues = validateCurriculumGraph(nodes, edges);
    expect(issues.some((issue) => issue.code === "CYCLE")).toBe(true);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNREACHABLE_CORE_NODE", nodeClientIds: ["c"] }),
      ]),
    );
    // Optional downstream nodes are not escalated.
    expect(
      issues.filter((issue) => issue.code === "UNREACHABLE_CORE_NODE"),
    ).toHaveLength(1);
  });

  it("ignores recommended/related edges for ordering semantics", () => {
    const nodes = [gnode("a", 0), gnode("b", 1)];
    const edges: CurriculumGraphEdge[] = [
      { fromClientId: "a", toClientId: "b", edgeType: "recommended" },
      { fromClientId: "b", toClientId: "a", edgeType: "related" },
    ];
    expect(validateCurriculumGraph(nodes, edges)).toEqual([]);
    expect(topologicalSortCurriculum(nodes, edges)).toEqual(["a", "b"]);
  });
});

describe("findCycle", () => {
  it("reports the cycle as a clientId path with the start repeated at the end", () => {
    const nodes = [gnode("a", 0), gnode("b", 1)];
    const cycle = findCycle(nodes, [edge("a", "b"), edge("b", "a")]);
    expect(cycle).toEqual(["a", "b", "a"]);
  });

  it("returns null for an acyclic graph", () => {
    const nodes = [gnode("a", 0), gnode("b", 1), gnode("c", 2)];
    expect(findCycle(nodes, [edge("a", "b"), edge("b", "c")])).toBeNull();
  });
});

describe("topologicalSortCurriculum", () => {
  it("orders a linear chain", () => {
    const nodes = [gnode("c", 2), gnode("a", 0), gnode("b", 1)];
    expect(topologicalSortCurriculum(nodes, [edge("a", "b"), edge("b", "c")])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("is stable: independent nodes are emitted by ascending orderIndex", () => {
    const nodes = [gnode("x", 5), gnode("y", 1), gnode("z", 3)];
    expect(topologicalSortCurriculum(nodes, [])).toEqual(["y", "z", "x"]);
  });

  it("breaks orderIndex ties deterministically by clientId", () => {
    const nodes = [gnode("q", 0), gnode("p", 0)];
    expect(topologicalSortCurriculum(nodes, [])).toEqual(["p", "q"]);
  });

  it("returns null when a cycle makes ordering impossible", () => {
    const nodes = [gnode("a", 0), gnode("b", 1)];
    expect(topologicalSortCurriculum(nodes, [edge("a", "b"), edge("b", "a")])).toBeNull();
  });
});

describe("computePrerequisiteSets", () => {
  it("computes the full transitive prerequisite closure", () => {
    const nodes = [gnode("a", 0), gnode("b", 1), gnode("c", 2)];
    const sets = computePrerequisiteSets(nodes, [edge("a", "b"), edge("b", "c")]);
    expect(sets.get("a")).toEqual(new Set());
    expect(sets.get("b")).toEqual(new Set(["a"]));
    expect(sets.get("c")).toEqual(new Set(["a", "b"]));
  });
});
