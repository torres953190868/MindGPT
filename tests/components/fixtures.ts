import type { ChatMessage, MindNode, Project } from "@/lib/types";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

export function makeMessage(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id">): ChatMessage {
  return {
    role: "user",
    content: "",
    attachments: [],
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

export function makeNode(overrides: Partial<MindNode> & Pick<MindNode, "id">): MindNode {
  return {
    projectId: "project-1",
    parentId: null,
    title: `Node ${overrides.id}`,
    titleManuallyEdited: false,
    summary: "",
    messages: [],
    children: [],
    position: { x: 0, y: 0 },
    branchType: "root",
    collapsed: false,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

/** A node with one completed user → assistant exchange. */
export function makeAnsweredNode(overrides: Partial<MindNode> & Pick<MindNode, "id">): MindNode {
  return makeNode({
    messages: [
      makeMessage({ id: `${overrides.id}-user`, role: "user", content: "What is photosynthesis?" }),
      makeMessage({
        id: `${overrides.id}-assistant`,
        role: "assistant",
        content: "Plants turn light into chemical energy.",
      }),
    ],
    ...overrides,
  });
}

export function makeProject(nodes: MindNode[], overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    title: "Test project",
    notes: "",
    rootNodeId: nodes[0]?.id ?? "root",
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}
