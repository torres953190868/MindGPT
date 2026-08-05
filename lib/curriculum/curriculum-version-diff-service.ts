import type {
  CurriculumDraft,
  CurriculumEdge,
  CurriculumModule,
  CurriculumNode,
  CurriculumSource,
} from "@/lib/curriculum/curriculum-types";

export type CurriculumDiffKind = "added" | "removed" | "changed";

export type CurriculumDiffEntry<T> = {
  key: string;
  kind: CurriculumDiffKind;
  before?: T;
  after?: T;
  changedFields?: string[];
};

export type CurriculumVersionDiff = {
  fromVersionId: string;
  againstVersionId: string;
  modules: CurriculumDiffEntry<Omit<CurriculumModule, "nodes">>[];
  nodes: CurriculumDiffEntry<CurriculumNode & { moduleClientId: string }>[];
  edges: CurriculumDiffEntry<CurriculumEdge>[];
  sources: CurriculumDiffEntry<CurriculumSource>[];
};

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function changedFields<T extends Record<string, unknown>>(before: T, after: T) {
  return Object.keys(after).filter((key) => stableJson(before[key]) !== stableJson(after[key]));
}

function diffByKey<T extends Record<string, unknown>>(
  before: T[],
  after: T[],
  beforeKeyOf: (value: T) => string,
  afterKeyOf: (value: T) => string = beforeKeyOf,
  beforeNormalize: (value: T) => Record<string, unknown> = (value) => value,
  afterNormalize: (value: T) => Record<string, unknown> = beforeNormalize,
): CurriculumDiffEntry<T>[] {
  const beforeByKey = new Map(before.map((value) => [beforeKeyOf(value), value]));
  const afterByKey = new Map(after.map((value) => [afterKeyOf(value), value]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  const entries: CurriculumDiffEntry<T>[] = [];

  for (const key of keys) {
    const previous = beforeByKey.get(key);
    const next = afterByKey.get(key);
    if (!previous && next) {
      entries.push({ key, kind: "added", after: next });
      continue;
    }
    if (previous && !next) {
      entries.push({ key, kind: "removed", before: previous });
      continue;
    }
    if (!previous || !next) continue;

    const fields = changedFields(beforeNormalize(previous), afterNormalize(next));
    if (fields.length > 0) {
      entries.push({ key, kind: "changed", before: previous, after: next, changedFields: fields });
    }
  }

  return entries;
}

function flattenNodes(draft: CurriculumDraft) {
  return draft.modules.flatMap((courseModule) =>
    courseModule.nodes.map((node) => ({
      ...node,
      moduleClientId: courseModule.clientId,
    })),
  );
}

function stableModuleKey(courseModule: CurriculumModule) {
  return `module:${courseModule.orderIndex}`;
}

function nodeStableKeys(draft: CurriculumDraft) {
  const keys = new Map<string, string>();
  for (const courseModule of draft.modules) {
    const moduleKey = stableModuleKey(courseModule);
    for (const node of courseModule.nodes) {
      keys.set(node.clientId, `${moduleKey}:node:${node.orderIndex}`);
    }
  }
  return keys;
}

function sourceStableKeys(draft: CurriculumDraft) {
  return new Map(
    draft.sources.map((source) => [source.id, source.url.trim().toLowerCase()]),
  );
}

function normalizeNodeForDiff(
  node: CurriculumNode & { moduleClientId: string },
  nodeKeys: Map<string, string>,
  sourceKeys: Map<string, string>,
) {
  return {
    ...node,
    clientId: "",
    moduleClientId: "",
    prerequisiteClientIds: node.prerequisiteClientIds
      .map((id) => nodeKeys.get(id) ?? id)
      .sort(),
    sourceIds: node.sourceIds.map((id) => sourceKeys.get(id) ?? id).sort(),
  };
}

function normalizeEdgeForDiff(edge: CurriculumEdge, nodeKeys: Map<string, string>) {
  return {
    ...edge,
    fromClientId: nodeKeys.get(edge.fromClientId) ?? edge.fromClientId,
    toClientId: nodeKeys.get(edge.toClientId) ?? edge.toClientId,
  };
}

function moduleMetadata(draft: CurriculumDraft): Omit<CurriculumModule, "nodes">[] {
  return draft.modules.map((courseModule) => ({
    clientId: courseModule.clientId,
    title: courseModule.title,
    description: courseModule.description,
    orderIndex: courseModule.orderIndex,
    required: courseModule.required,
  }));
}

function stableEdgeKey(edge: CurriculumEdge, nodeKeys: Map<string, string>) {
  return `${nodeKeys.get(edge.fromClientId) ?? edge.fromClientId}\0${nodeKeys.get(edge.toClientId) ?? edge.toClientId}\0${edge.edgeType}`;
}

/** Build a deterministic, presentation-ready summary between two versions. */
export function diffCurriculumDrafts(
  before: CurriculumDraft,
  after: CurriculumDraft,
  fromVersionId: string,
  againstVersionId: string,
): CurriculumVersionDiff {
  const beforeNodeKeys = nodeStableKeys(before);
  const afterNodeKeys = nodeStableKeys(after);
  const beforeSourceKeys = sourceStableKeys(before);
  const afterSourceKeys = sourceStableKeys(after);
  const beforeEdges = before.edges ?? [];
  const afterEdges = after.edges ?? [];
  return {
    fromVersionId,
    againstVersionId,
    // Persisted versions receive new database ids for each copy. Match by
    // structural position/content identity so deriving an unchanged version
    // does not look like a full delete-and-add operation.
    modules: diffByKey(
      moduleMetadata(before),
      moduleMetadata(after),
      (value) => `module:${value.orderIndex}`,
      (value) => `module:${value.orderIndex}`,
      (value) => ({ ...value, clientId: "" }),
      (value) => ({ ...value, clientId: "" }),
    ),
    nodes: diffByKey(
      flattenNodes(before),
      flattenNodes(after),
      (value) => beforeNodeKeys.get(value.clientId) ?? value.clientId,
      (value) => afterNodeKeys.get(value.clientId) ?? value.clientId,
      (value) => normalizeNodeForDiff(value, beforeNodeKeys, beforeSourceKeys),
      (value) => normalizeNodeForDiff(value, afterNodeKeys, afterSourceKeys),
    ),
    edges: diffByKey(
      beforeEdges,
      afterEdges,
      (edge) => stableEdgeKey(edge, beforeNodeKeys),
      (edge) => stableEdgeKey(edge, afterNodeKeys),
      (edge) => normalizeEdgeForDiff(edge, beforeNodeKeys),
      (edge) => normalizeEdgeForDiff(edge, afterNodeKeys),
    ),
    sources: diffByKey(
      before.sources,
      after.sources,
      (value) => value.url.trim().toLowerCase(),
      (value) => value.url.trim().toLowerCase(),
      (value) => ({ ...value, id: "" }),
      (value) => ({ ...value, id: "" }),
    ),
  };
}
