// CurriculumValidationService (spec §9.3) — deterministic validation of a
// CurriculumDraft: zod schema, business constraints, source coverage,
// duplicate titles, size limits, and graph integrity. Never throws; every
// problem is a structured warning, and `valid === (blockingCount === 0)`.
//
// The five rubric scores on the result are intentionally left empty in this
// phase: spec §3.9 step 6 requires them to come from an independent model
// call (the `curriculum_validation` route), which is Phase 2 work. A draft
// that fails these deterministic checks must not be saved regardless of any
// future score.

import {
  buildCurriculumEdges,
  topologicalSortCurriculum,
  validateCurriculumGraph,
  type CurriculumGraphIssueCode,
  type CurriculumGraphNode,
} from "@/lib/curriculum/curriculum-graph-service";
import {
  CURRICULUM_LIMITS,
  curriculumDraftSchema,
  type CurriculumDraft,
  type CurriculumWarningSeverity,
  type StructuredWarning,
} from "@/lib/curriculum/curriculum-types";

// Rubric score thresholds (spec §3.9 step 6). Consumed by Phase 2's
// validation-model scoring; exported here so the numbers live in one place.
export const CURRICULUM_THRESHOLDS = {
  coverageScore: 0.8,
  sequenceScore: 0.8,
  prerequisiteScore: 0.9,
  sourceQualityScore: 0.75,
  difficultyFitScore: 0.8,
} as const;

export type CurriculumValidationResult = {
  valid: boolean;
  blockingCount: number;
  advisoryCount: number;
  warnings: StructuredWarning[];
  // Optional rubric score slots reserved for Phase 2's independent LLM
  // scoring; deterministic validation never fills them.
  coverageScore?: number;
  sequenceScore?: number;
  prerequisiteScore?: number;
  sourceQualityScore?: number;
  difficultyFitScore?: number;
  independentReviewer?: {
    source: "independent_reviewer";
    scores: {
      coverageScore: number;
      sequenceScore: number;
      prerequisiteScore: number;
      sourceQualityScore: number;
      difficultyFitScore: number;
    };
    rationales: Record<string, string>;
  };
};

// Graph issue severities: a self loop, dangling reference, or cycle makes the
// structure invalid, and a core node blocked by a cycle can never be completed
// — all blocking. An orphaned core node leaves the course completable and
// flags a likely missing-dependency oversight instead — advisory.
const GRAPH_ISSUE_SEVERITY: Record<CurriculumGraphIssueCode, CurriculumWarningSeverity> = {
  SELF_LOOP: "blocking",
  UNKNOWN_NODE_REFERENCE: "blocking",
  CYCLE: "blocking",
  ORPHANED_CORE_NODE: "advisory",
  UNREACHABLE_CORE_NODE: "blocking",
};

function flattenNodes(draft: CurriculumDraft): CurriculumGraphNode[] {
  return draft.modules.flatMap((courseModule) => courseModule.nodes);
}

export function validateCurriculumDraft(draft: CurriculumDraft): CurriculumValidationResult {
  const warnings: StructuredWarning[] = [];
  const push = (
    code: string,
    severity: CurriculumWarningSeverity,
    message: string,
    scope?: { moduleClientId?: string; nodeClientId?: string },
  ) => {
    warnings.push({ code, severity, message, ...scope });
  };

  // 1. Zod schema: every schema violation is a blocking warning. Business
  // checks run on the parsed (trimmed, type-safe) output; when parsing fails
  // the draft shape is untrustworthy, so stop here.
  const parsed = curriculumDraftSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      push("SCHEMA_ERROR", "blocking", `${path}: ${issue.message}`);
    }
    return toResult(warnings);
  }
  const valid = parsed.data;

  // 2. clientId uniqueness across modules, nodes, and sources. clientIds are
  // builder-generated and only validated here; database ids are assigned at
  // persistence time (spec §3.9 step 7).
  const seenModuleIds = new Set<string>();
  const seenNodeIds = new Set<string>();
  const seenSourceIds = new Set<string>();
  for (const courseModule of valid.modules) {
    if (seenModuleIds.has(courseModule.clientId)) {
      push(
        "DUPLICATE_CLIENT_ID",
        "blocking",
        `Duplicate module clientId "${courseModule.clientId}".`,
        { moduleClientId: courseModule.clientId },
      );
    }
    seenModuleIds.add(courseModule.clientId);
    for (const node of courseModule.nodes) {
      if (seenNodeIds.has(node.clientId)) {
        push("DUPLICATE_CLIENT_ID", "blocking", `Duplicate node clientId "${node.clientId}".`, {
          moduleClientId: courseModule.clientId,
          nodeClientId: node.clientId,
        });
      }
      seenNodeIds.add(node.clientId);
    }
  }
  for (const source of valid.sources) {
    if (seenSourceIds.has(source.id)) {
      push("DUPLICATE_CLIENT_ID", "blocking", `Duplicate source id "${source.id}".`);
    }
    seenSourceIds.add(source.id);
  }

  // 3. Reference integrity: prerequisites must point at existing nodes,
  // sourceIds at existing sources (incl. conflict entries).
  for (const courseModule of valid.modules) {
    for (const node of courseModule.nodes) {
      for (const prerequisiteClientId of node.prerequisiteClientIds) {
        if (!seenNodeIds.has(prerequisiteClientId)) {
          push(
            "UNKNOWN_PREREQUISITE",
            "blocking",
            `Node "${node.clientId}" depends on unknown node "${prerequisiteClientId}".`,
            { moduleClientId: courseModule.clientId, nodeClientId: node.clientId },
          );
        }
      }
      for (const sourceId of node.sourceIds) {
        if (!seenSourceIds.has(sourceId)) {
          push(
            "UNKNOWN_SOURCE",
            "blocking",
            `Node "${node.clientId}" references unknown source "${sourceId}".`,
            { moduleClientId: courseModule.clientId, nodeClientId: node.clientId },
          );
        }
      }
    }
  }
  for (const conflict of valid.conflicts) {
    for (const sourceId of conflict.sourceIds) {
      if (!seenSourceIds.has(sourceId)) {
        push(
          "UNKNOWN_SOURCE",
          "blocking",
          `Conflict "${conflict.topic}" references unknown source "${sourceId}".`,
        );
      }
    }
  }

  // 4. orderIndex must be strictly increasing within its scope: no duplicates
  // among modules, and no duplicates among the nodes of one module.
  const seenModuleOrder = new Set<number>();
  for (const courseModule of valid.modules) {
    if (seenModuleOrder.has(courseModule.orderIndex)) {
      push(
        "DUPLICATE_ORDER_INDEX",
        "blocking",
        `Duplicate module orderIndex ${courseModule.orderIndex}.`,
        { moduleClientId: courseModule.clientId },
      );
    }
    seenModuleOrder.add(courseModule.orderIndex);
    const seenNodeOrder = new Set<number>();
    for (const node of courseModule.nodes) {
      if (seenNodeOrder.has(node.orderIndex)) {
        push(
          "DUPLICATE_ORDER_INDEX",
          "blocking",
          `Duplicate node orderIndex ${node.orderIndex} in module "${courseModule.clientId}".`,
          { moduleClientId: courseModule.clientId, nodeClientId: node.clientId },
        );
      }
      seenNodeOrder.add(node.orderIndex);
    }
  }

  // 5. Defensive estimatedMinutes recheck — the schema already enforces a
  // positive integer; kept so a future schema relaxation cannot silently
  // reintroduce non-positive estimates (spec §3.9 step 6).
  for (const courseModule of valid.modules) {
    for (const node of courseModule.nodes) {
      if (node.estimatedMinutes <= 0) {
        push(
          "INVALID_ESTIMATED_MINUTES",
          "blocking",
          `Node "${node.clientId}" has non-positive estimatedMinutes.`,
          { moduleClientId: courseModule.clientId, nodeClientId: node.clientId },
        );
      }
    }
  }

  // 6. Size limits. Per-collection caps live in the zod schemas; the course
  // total is a cross-module constraint and only checkable here.
  const totalNodes = flattenNodes(valid).length;
  if (totalNodes > CURRICULUM_LIMITS.maxNodesTotal) {
    push(
      "TOO_MANY_NODES",
      "blocking",
      `Draft has ${totalNodes} nodes, exceeding the limit of ${CURRICULUM_LIMITS.maxNodesTotal}.`,
    );
  }

  // 7. Duplicate titles. Within one module a repeated title is usually a
  // naming/granularity issue the author can review (advisory); the exact same
  // title appearing in different modules signals copy-paste structural
  // duplication of knowledge points (spec §3.9 "重复知识点") and blocks.
  // Comparison is exact (post-trim); fuzzy duplicate detection belongs to the
  // Phase 2 LLM rubric, not deterministic validation.
  const titleToModules = new Map<string, Set<string>>();
  for (const courseModule of valid.modules) {
    const titleToNodes = new Map<string, string[]>();
    for (const node of courseModule.nodes) {
      const bucket = titleToNodes.get(node.title) ?? [];
      bucket.push(node.clientId);
      titleToNodes.set(node.title, bucket);
      const modulesWithTitle = titleToModules.get(node.title) ?? new Set<string>();
      modulesWithTitle.add(courseModule.clientId);
      titleToModules.set(node.title, modulesWithTitle);
    }
    for (const [title, nodeClientIds] of titleToNodes) {
      if (nodeClientIds.length > 1) {
        push(
          "DUPLICATE_NODE_TITLE_IN_MODULE",
          "advisory",
          `Module "${courseModule.clientId}" has ${nodeClientIds.length} nodes titled "${title}".`,
          { moduleClientId: courseModule.clientId, nodeClientId: nodeClientIds[0] },
        );
      }
    }
  }
  for (const [title, moduleClientIds] of titleToModules) {
    if (moduleClientIds.size > 1) {
      push(
        "DUPLICATE_NODE_TITLE",
        "blocking",
        `Node title "${title}" appears in ${moduleClientIds.size} different modules.`,
      );
    }
  }

  // 8. Source coverage. Every core node must be backed by at least one source
  // (blocking); required modules should rest on at least
  // minCoreModuleSources independent sources, and the whole course on a
  // healthy mix of sources and source types (advisory, spec §3.9 step 3).
  for (const courseModule of valid.modules) {
    for (const node of courseModule.nodes) {
      if (node.importance === "core" && node.sourceIds.length === 0) {
        push(
          "CORE_NODE_WITHOUT_SOURCE",
          "blocking",
          `Core node "${node.clientId}" has no supporting source.`,
          { moduleClientId: courseModule.clientId, nodeClientId: node.clientId },
        );
      }
    }
    // "Core module" = required module; its supporting sources are the union
    // of distinct sources referenced by its nodes.
    if (courseModule.required) {
      const moduleSources = new Set<string>();
      for (const node of courseModule.nodes) {
        for (const sourceId of node.sourceIds) {
          if (seenSourceIds.has(sourceId)) moduleSources.add(sourceId);
        }
      }
      if (moduleSources.size < CURRICULUM_LIMITS.minCoreModuleSources) {
        push(
          "CORE_MODULE_SOURCE_SUPPORT",
          "advisory",
          `Required module "${courseModule.clientId}" is backed by only ${moduleSources.size} independent source(s); expected at least ${CURRICULUM_LIMITS.minCoreModuleSources}.`,
          { moduleClientId: courseModule.clientId },
        );
      }
    }
  }
  if (valid.sources.length < CURRICULUM_LIMITS.minIndependentSources) {
    push(
      "FEW_SOURCES",
      "advisory",
      `Draft uses only ${valid.sources.length} independent source(s); expected at least ${CURRICULUM_LIMITS.minIndependentSources}.`,
    );
  }
  const sourceTypes = new Set(valid.sources.map((source) => source.sourceType));
  if (sourceTypes.size < CURRICULUM_LIMITS.minSourceTypes) {
    push(
      "FEW_SOURCE_TYPES",
      "advisory",
      `Draft uses only ${sourceTypes.size} source type(s); expected at least ${CURRICULUM_LIMITS.minSourceTypes}.`,
    );
  }

  // 9. Graph integrity (CurriculumGraphService). UNKNOWN_NODE_REFERENCE is
  // skipped here because the business check above already reports the same
  // condition as UNKNOWN_PREREQUISITE with better scope.
  const graphNodes = flattenNodes(valid);
  const graphEdges = buildCurriculumEdges(valid);
  for (const issue of validateCurriculumGraph(graphNodes, graphEdges)) {
    if (issue.code === "UNKNOWN_NODE_REFERENCE") continue;
    push(issue.code, GRAPH_ISSUE_SEVERITY[issue.code], issue.message, {
      nodeClientId: issue.nodeClientIds[0],
    });
  }

  // 10. Prerequisite-before-target ordering. The graph service deliberately
  // does not hardcode this check; it is derived here by composing the
  // topological order (skipped when a cycle already blocks ordering) with the
  // draft's reading order (module orderIndex, then node orderIndex). A
  // backward-pointing dependency leaves the course completable via the
  // topological unlock order, so it is advisory rather than blocking.
  if (topologicalSortCurriculum(graphNodes, graphEdges) !== null) {
    const readingPosition = new Map<string, number>();
    let position = 0;
    for (const courseModule of [...valid.modules].sort((a, b) => a.orderIndex - b.orderIndex)) {
      for (const node of [...courseModule.nodes].sort((a, b) => a.orderIndex - b.orderIndex)) {
        readingPosition.set(node.clientId, position);
        position += 1;
      }
    }
    for (const edge of graphEdges) {
      const from = readingPosition.get(edge.fromClientId);
      const to = readingPosition.get(edge.toClientId);
      if (from !== undefined && to !== undefined && from > to) {
        push(
          "PREREQUISITE_ORDER",
          "advisory",
          `Prerequisite "${edge.fromClientId}" appears after "${edge.toClientId}" in reading order.`,
          { nodeClientId: edge.toClientId },
        );
      }
    }
  }

  return toResult(warnings);
}

function toResult(warnings: StructuredWarning[]): CurriculumValidationResult {
  const blockingCount = warnings.filter((warning) => warning.severity === "blocking").length;
  const advisoryCount = warnings.length - blockingCount;
  return {
    valid: blockingCount === 0,
    blockingCount,
    advisoryCount,
    warnings,
  };
}
