// CurriculumGraphService (spec §9.2) — pure deterministic graph operations on
// a curriculum's dependency structure. No I/O, no LLM, never throws: every
// structural problem is reported as a structured issue object and the caller
// (CurriculumValidationService) decides the severity.
//
// Semantics of direction: an edge `from -> to` means `from` is a prerequisite
// and `to` depends on it (spec §7.5). Ordering analysis (cycles, topological
// sort, prerequisite closure, orphan/unreachable detection) only considers
// `prerequisite` edges — `recommended`/`related` edges express loose
// associations and must not constrain the learning order. Structural integrity
// checks (self loops, references to unknown nodes) apply to every edge type.
//
// The "a prerequisite should appear earlier than its target" check is NOT
// hardcoded here: CurriculumValidationService derives it by composing the
// topological order with the draft's reading order.

import type {
  CurriculumDraft,
  CurriculumEdgeType,
  CurriculumImportance,
} from "@/lib/curriculum/curriculum-types";

export type CurriculumGraphNode = {
  clientId: string;
  importance: CurriculumImportance;
  orderIndex: number;
};

export type CurriculumGraphEdge = {
  fromClientId: string;
  toClientId: string;
  edgeType: CurriculumEdgeType;
};

export type CurriculumGraphIssueCode =
  | "SELF_LOOP"
  | "UNKNOWN_NODE_REFERENCE"
  | "CYCLE"
  | "ORPHANED_CORE_NODE"
  | "UNREACHABLE_CORE_NODE";

export type CurriculumGraphIssue = {
  code: CurriculumGraphIssueCode;
  message: string;
  nodeClientIds: string[];
};

// Builds the prerequisite edge list implied by each node's
// `prerequisiteClientIds` (spec §3.5). Duplicate (from, to) pairs collapse.
export function buildCurriculumEdges(draft: CurriculumDraft): CurriculumGraphEdge[] {
  const edges = new Map<string, CurriculumGraphEdge>();
  for (const courseModule of draft.modules) {
    for (const node of courseModule.nodes) {
      for (const prerequisiteClientId of node.prerequisiteClientIds) {
        const key = `${prerequisiteClientId}\0${node.clientId}\0prerequisite`;
        if (!edges.has(key)) {
          edges.set(key, {
            fromClientId: prerequisiteClientId,
            toClientId: node.clientId,
            edgeType: "prerequisite",
          });
        }
      }
    }
  }
  for (const edge of draft.edges ?? []) {
    const key = `${edge.fromClientId}\0${edge.toClientId}\0${edge.edgeType}`;
    if (!edges.has(key)) {
      edges.set(key, {
        fromClientId: edge.fromClientId,
        toClientId: edge.toClientId,
        edgeType: edge.edgeType,
      });
    }
  }
  return [...edges.values()];
}

// Deterministic node ordering used for stable iteration: orderIndex first,
// clientId as the final tie-breaker so results never depend on input order.
function compareGraphNodes(a: CurriculumGraphNode, b: CurriculumGraphNode): number {
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
}

function prerequisiteEdges(edges: CurriculumGraphEdge[]): CurriculumGraphEdge[] {
  return edges.filter((edge) => edge.edgeType === "prerequisite");
}

// Builds from -> [to...] adjacency over prerequisite edges, ignoring edges
// whose endpoints are not in the node set (those are reported separately as
// UNKNOWN_NODE_REFERENCE and must not corrupt ordering logic).
function buildAdjacency(
  nodes: CurriculumGraphNode[],
  edges: CurriculumGraphEdge[],
): Map<string, string[]> {
  const known = new Set(nodes.map((node) => node.clientId));
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.clientId, []);
  for (const edge of prerequisiteEdges(edges)) {
    if (!known.has(edge.fromClientId) || !known.has(edge.toClientId)) continue;
    if (edge.fromClientId === edge.toClientId) continue;
    adjacency.get(edge.fromClientId)!.push(edge.toClientId);
  }
  for (const successors of adjacency.values()) successors.sort();
  return adjacency;
}

// DFS three-color cycle detection. Returns the first cycle found as a clientId
// path with the start node repeated at the end (e.g. ["a", "b", "a"]), or null
// when the prerequisite graph is acyclic. Iteration follows the deterministic
// node order, so the reported cycle is stable across runs.
export function findCycle(
  nodes: CurriculumGraphNode[],
  edges: CurriculumGraphEdge[],
): string[] | null {
  const adjacency = buildAdjacency(nodes, edges);
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (clientId: string): string[] | null => {
    state.set(clientId, "visiting");
    stack.push(clientId);
    for (const successor of adjacency.get(clientId) ?? []) {
      if (state.get(successor) === "done") continue;
      if (state.get(successor) === "visiting") {
        const cycleStart = stack.indexOf(successor);
        return [...stack.slice(cycleStart), successor];
      }
      const cycle = visit(successor);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(clientId, "done");
    return null;
  };

  for (const node of [...nodes].sort(compareGraphNodes)) {
    if (state.has(node.clientId)) continue;
    const cycle = visit(node.clientId);
    if (cycle) return cycle;
  }
  return null;
}

// Kahn's algorithm over prerequisite edges. Stable: among the currently
// available (in-degree 0) nodes the one with the lowest orderIndex is emitted
// first, with clientId as tie-breaker. Returns null when a cycle makes a full
// ordering impossible.
export function topologicalSortCurriculum(
  nodes: CurriculumGraphNode[],
  edges: CurriculumGraphEdge[],
): string[] | null {
  const adjacency = buildAdjacency(nodes, edges);
  const inDegree = new Map<string, number>();
  for (const node of nodes) inDegree.set(node.clientId, 0);
  for (const successors of adjacency.values()) {
    for (const successor of successors) {
      inDegree.set(successor, (inDegree.get(successor) ?? 0) + 1);
    }
  }

  const byClientId = new Map(nodes.map((node) => [node.clientId, node]));
  const available = nodes
    .filter((node) => inDegree.get(node.clientId) === 0)
    .sort(compareGraphNodes);
  const ordered: string[] = [];

  while (available.length > 0) {
    const next = available.shift()!;
    ordered.push(next.clientId);
    for (const successor of adjacency.get(next.clientId) ?? []) {
      const remaining = (inDegree.get(successor) ?? 0) - 1;
      inDegree.set(successor, remaining);
      if (remaining === 0) {
        const successorNode = byClientId.get(successor)!;
        // Insert keeping the available list sorted (lists stay small: nodes
        // per curriculum are capped by CURRICULUM_LIMITS.maxNodesTotal).
        let index = available.length;
        while (index > 0 && compareGraphNodes(available[index - 1], successorNode) > 0) {
          index -= 1;
        }
        available.splice(index, 0, successorNode);
      }
    }
  }

  return ordered.length === nodes.length ? ordered : null;
}

// Full transitive prerequisite closure for every node: entry X -> set of all
// clientIds that must be completed before X. Cycle members and their
// downstream nodes simply accumulate whatever is reachable; cycles themselves
// are reported by findCycle/validateCurriculumGraph.
export function computePrerequisiteSets(
  nodes: CurriculumGraphNode[],
  edges: CurriculumGraphEdge[],
): Map<string, Set<string>> {
  const adjacency = buildAdjacency(nodes, edges);
  // Reverse adjacency: node -> its direct prerequisites.
  const directPrerequisites = new Map<string, string[]>();
  for (const node of nodes) directPrerequisites.set(node.clientId, []);
  for (const [from, successors] of adjacency) {
    for (const to of successors) directPrerequisites.get(to)!.push(from);
  }

  const result = new Map<string, Set<string>>();
  for (const node of nodes) {
    const closure = new Set<string>();
    const pending = [...(directPrerequisites.get(node.clientId) ?? [])];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (closure.has(current)) continue;
      closure.add(current);
      for (const next of directPrerequisites.get(current) ?? []) {
        if (!closure.has(next)) pending.push(next);
      }
    }
    result.set(node.clientId, closure);
  }
  return result;
}

// Runs every structural check and returns all issues found. Never throws and
// never stops at the first problem, so callers can surface the full picture.
export function validateCurriculumGraph(
  nodes: CurriculumGraphNode[],
  edges: CurriculumGraphEdge[],
): CurriculumGraphIssue[] {
  const issues: CurriculumGraphIssue[] = [];
  const known = new Set(nodes.map((node) => node.clientId));

  for (const edge of edges) {
    if (edge.fromClientId === edge.toClientId) {
      issues.push({
        code: "SELF_LOOP",
        message: `Node "${edge.fromClientId}" lists itself as a ${edge.edgeType} dependency.`,
        nodeClientIds: [edge.fromClientId],
      });
    }
    if (!known.has(edge.fromClientId) || !known.has(edge.toClientId)) {
      issues.push({
        code: "UNKNOWN_NODE_REFERENCE",
        message: `Edge references an unknown node ("${edge.fromClientId}" -> "${edge.toClientId}").`,
        nodeClientIds: [edge.fromClientId, edge.toClientId].filter((id) => !known.has(id)),
      });
    }
  }

  const cycle = findCycle(nodes, edges);
  if (cycle) {
    issues.push({
      code: "CYCLE",
      message: `Circular dependency detected: ${cycle.join(" -> ")}.`,
      nodeClientIds: [...new Set(cycle)],
    });
  }

  // A core node with no prerequisite edges in either direction floats outside
  // the course structure: nothing prepares the learner for it and nothing
  // builds on it.
  const adjacency = buildAdjacency(nodes, edges);
  const inDegree = new Map<string, number>();
  for (const node of nodes) inDegree.set(node.clientId, 0);
  for (const successors of adjacency.values()) {
    for (const successor of successors) {
      inDegree.set(successor, (inDegree.get(successor) ?? 0) + 1);
    }
  }
  for (const node of nodes) {
    if (node.importance !== "core") continue;
    const outDegree = adjacency.get(node.clientId)?.length ?? 0;
    if ((inDegree.get(node.clientId) ?? 0) === 0 && outDegree === 0) {
      issues.push({
        code: "ORPHANED_CORE_NODE",
        message: `Core node "${node.clientId}" is not connected to any other node.`,
        nodeClientIds: [node.clientId],
      });
    }
  }

  // Nodes on or downstream of a cycle can never be unlocked, because their
  // transitive prerequisites are unsatisfiable. Flagging affected core nodes
  // separately from CYCLE tells the author exactly which required learning
  // outcomes the cycle blocks.
  if (cycle) {
    const cycleMembers = new Set(cycle);
    const blocked = new Set<string>(cycleMembers);
    const pending = [...cycleMembers];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const successor of adjacency.get(current) ?? []) {
        if (blocked.has(successor)) continue;
        blocked.add(successor);
        pending.push(successor);
      }
    }
    for (const node of [...nodes].sort(compareGraphNodes)) {
      if (node.importance !== "core" || !blocked.has(node.clientId)) continue;
      issues.push({
        code: "UNREACHABLE_CORE_NODE",
        message: `Core node "${node.clientId}" can never be completed because it depends on a circular dependency.`,
        nodeClientIds: [node.clientId],
      });
    }
  }

  return issues;
}
