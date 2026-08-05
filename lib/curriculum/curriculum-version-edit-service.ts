import type {
  CurriculumDraft,
  CurriculumEdge,
  CurriculumModule,
  CurriculumNode,
  CurriculumSource,
  CurriculumVersionPatch,
} from "@/lib/curriculum/curriculum-types";

export class CurriculumVersionPatchError extends Error {
  code = "CURRICULUM_PATCH_INVALID";
  expose = true;
  status = 400;
}

function findNode(draft: CurriculumDraft, clientId: string) {
  for (const courseModule of draft.modules) {
    const index = courseModule.nodes.findIndex((node) => node.clientId === clientId);
    if (index >= 0) return { courseModule, index, node: courseModule.nodes[index] };
  }
  return null;
}

function withoutNodeReferences(draft: CurriculumDraft, deletedNodeIds: Set<string>) {
  for (const courseModule of draft.modules) {
    courseModule.nodes = courseModule.nodes
      .filter((node) => !deletedNodeIds.has(node.clientId))
      .map((node) => ({
        ...node,
        prerequisiteClientIds: node.prerequisiteClientIds.filter(
          (id) => !deletedNodeIds.has(id),
        ),
      }));
  }
  draft.edges = (draft.edges ?? []).filter(
    (edge) => !deletedNodeIds.has(edge.fromClientId) && !deletedNodeIds.has(edge.toClientId),
  );
}

function upsertModule(draft: CurriculumDraft, input: Omit<CurriculumModule, "nodes">) {
  const index = draft.modules.findIndex((courseModule) => courseModule.clientId === input.clientId);
  if (index >= 0) {
    draft.modules[index] = { ...draft.modules[index], ...input };
    return;
  }
  draft.modules.push({ ...input, nodes: [] });
}

function upsertNode(
  draft: CurriculumDraft,
  { moduleClientId, ...input }: CurriculumNode & { moduleClientId: string },
) {
  const targetModule = draft.modules.find(
    (courseModule) => courseModule.clientId === moduleClientId,
  );
  if (!targetModule) {
    throw new CurriculumVersionPatchError(
      `Node "${input.clientId}" references unknown module "${moduleClientId}".`,
    );
  }

  const existing = findNode(draft, input.clientId);
  if (existing) {
    existing.courseModule.nodes.splice(existing.index, 1);
  }
  targetModule.nodes.push({ ...input });
}

function upsertSource(draft: CurriculumDraft, input: CurriculumSource) {
  const index = draft.sources.findIndex((source) => source.id === input.id);
  if (index >= 0) draft.sources[index] = input;
  else draft.sources.push(input);
}

function upsertEdge(draft: CurriculumDraft, input: CurriculumEdge) {
  const edges = draft.edges ?? [];
  const index = edges.findIndex(
    (edge) =>
      edge.fromClientId === input.fromClientId &&
      edge.toClientId === input.toClientId &&
      edge.edgeType === input.edgeType,
  );
  if (index >= 0) edges[index] = input;
  else edges.push(input);
  draft.edges = edges;

  if (input.edgeType === "prerequisite") {
    const target = findNode(draft, input.toClientId)?.node;
    if (target && !target.prerequisiteClientIds.includes(input.fromClientId)) {
      target.prerequisiteClientIds.push(input.fromClientId);
    }
  }
}

function deleteEdge(draft: CurriculumDraft, input: CurriculumEdge) {
  draft.edges = (draft.edges ?? []).filter(
    (edge) =>
      !(
        edge.fromClientId === input.fromClientId &&
        edge.toClientId === input.toClientId &&
        edge.edgeType === input.edgeType
      ),
  );
  if (input.edgeType === "prerequisite") {
    const target = findNode(draft, input.toClientId)?.node;
    if (target) {
      target.prerequisiteClientIds = target.prerequisiteClientIds.filter(
        (id) => id !== input.fromClientId,
      );
    }
  }
}

/**
 * Applies a structured editor patch without performing I/O. The caller must
 * run the returned draft through the schema and deterministic validation.
 * Existing rows are addressed by the stable clientId values exposed by the
 * version read API; newly inserted rows can use any valid clientId.
 */
export function applyCurriculumVersionPatch(
  source: CurriculumDraft,
  patch: CurriculumVersionPatch,
): CurriculumDraft {
  const draft: CurriculumDraft = {
    ...source,
    modules: source.modules.map((courseModule) => ({
      ...courseModule,
      nodes: courseModule.nodes.map((node) => ({
        ...node,
        prerequisiteClientIds: [...node.prerequisiteClientIds],
        sourceIds: [...node.sourceIds],
        learningObjectives: [...node.learningObjectives],
        completionCriteria: [...node.completionCriteria],
        tags: [...node.tags],
      })),
    })),
    sources: source.sources.map((sourceItem) => ({ ...sourceItem })),
    conflicts: source.conflicts.map((conflict) => ({
      ...conflict,
      sourceIds: [...conflict.sourceIds],
    })),
    edges: (source.edges ?? []).map((edge) => ({ ...edge })),
  };

  if (patch.versionLabel !== undefined) draft.versionLabel = patch.versionLabel;
  if (patch.audience !== undefined) draft.audience = patch.audience;
  if (patch.estimatedWeeks !== undefined) draft.estimatedWeeks = patch.estimatedWeeks ?? undefined;
  if (patch.estimatedHours !== undefined) draft.estimatedHours = patch.estimatedHours ?? undefined;
  if (patch.assumptions !== undefined) draft.assumptions = patch.assumptions;
  if (patch.exclusions !== undefined) draft.exclusions = patch.exclusions;
  if (patch.conflicts !== undefined) draft.conflicts = patch.conflicts;

  if (patch.modules?.upsert) {
    for (const moduleInput of patch.modules.upsert) upsertModule(draft, moduleInput);
  }
  if (patch.modules?.delete) {
    const deletedModuleIds = new Set(patch.modules.delete);
    const deletedNodeIds = new Set(
      draft.modules
        .filter((courseModule) => deletedModuleIds.has(courseModule.clientId))
        .flatMap((courseModule) => courseModule.nodes.map((node) => node.clientId)),
    );
    draft.modules = draft.modules.filter(
      (courseModule) => !deletedModuleIds.has(courseModule.clientId),
    );
    withoutNodeReferences(draft, deletedNodeIds);
  }

  if (patch.nodes?.upsert) {
    for (const nodeInput of patch.nodes.upsert) upsertNode(draft, nodeInput);
  }
  if (patch.nodes?.delete) {
    withoutNodeReferences(draft, new Set(patch.nodes.delete));
  }

  if (patch.sources?.upsert) {
    for (const sourceInput of patch.sources.upsert) upsertSource(draft, sourceInput);
  }
  if (patch.sources?.delete) {
    const deletedSourceIds = new Set(patch.sources.delete);
    draft.sources = draft.sources.filter((source) => !deletedSourceIds.has(source.id));
    for (const courseModule of draft.modules) {
      for (const node of courseModule.nodes) {
        node.sourceIds = node.sourceIds.filter((id) => !deletedSourceIds.has(id));
      }
    }
    draft.conflicts = draft.conflicts.map((conflict) => ({
      ...conflict,
      sourceIds: conflict.sourceIds.filter((id) => !deletedSourceIds.has(id)),
    }));
  }

  if (patch.edges?.upsert) {
    for (const edgeInput of patch.edges.upsert) upsertEdge(draft, edgeInput);
  }
  if (patch.edges?.delete) {
    for (const edgeInput of patch.edges.delete) deleteEdge(draft, edgeInput);
  }

  return draft;
}
