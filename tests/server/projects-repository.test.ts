import { describe, expect, it } from "vitest";
import {
  composeProjectsFromRows,
  projectToRows,
} from "@/lib/server/projects-repository";
import type { Project } from "@/lib/types";

const timestamp = "2026-01-01T00:00:00.000Z";

function makeProject(): Project {
  return {
    id: "project-repository-test",
    ownerSessionId: "owner-session",
    title: "Repository test",
    notes: "## Saved notes",
    rootNodeId: "node-root-repository-test",
    nodes: {
      "node-root-repository-test": {
        id: "node-root-repository-test",
        projectId: "project-repository-test",
        parentId: null,
        title: "Root",
        titleManuallyEdited: true,
        summary: "Root summary",
        messages: [
          {
            id: "message-with-attachment",
            role: "user",
            content: "Prompt with file",
            attachments: [
              {
                id: "attachment-repository-test",
                name: "dataset.csv",
                mimeType: "text/csv",
                size: 1024,
                createdAt: timestamp,
              },
            ],
            createdAt: timestamp,
          },
          {
            id: "message-with-citation",
            role: "assistant",
            content: "Answer with source [[cite:1]]",
            attachments: [],
            citations: [
              {
                index: 1,
                documentId: "document-repository-test",
                documentName: "source.pdf",
                chunkId: "chunk-repository-test",
                pageStart: 2,
                pageEnd: 3,
                headingPath: ["Chapter 1"],
                quote: "Repository citation text.",
              },
            ],
            createdAt: timestamp,
          },
        ],
        children: [],
        position: { x: 0, y: 0 },
        branchType: "root",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("projects repository row mapping", () => {
  it("writes and reads project notes in Supabase rows", () => {
    const project = makeProject();
    const { projectRow, nodeRows, messageRows } = projectToRows(project);
    const persistedProjectRow = {
      ...projectRow,
      notes: projectRow.notes ?? "",
      created_at: projectRow.created_at ?? timestamp,
      updated_at: projectRow.updated_at ?? timestamp,
    };

    expect(projectRow.notes).toBe("## Saved notes");
    expect(nodeRows[0].title_manually_edited).toBe(true);

    const [composed] = composeProjectsFromRows(
      [persistedProjectRow],
      nodeRows.map((nodeRow) => ({
        ...nodeRow,
        parent_id: nodeRow.parent_id ?? null,
        title_manually_edited: nodeRow.title_manually_edited ?? false,
        summary: nodeRow.summary ?? "",
        position_x: nodeRow.position_x ?? 0,
        position_y: nodeRow.position_y ?? 0,
        collapsed: nodeRow.collapsed ?? false,
        child_order: nodeRow.child_order ?? 0,
        created_at: nodeRow.created_at ?? timestamp,
        updated_at: nodeRow.updated_at ?? timestamp,
      })),
      messageRows.map((messageRow) => ({
        ...messageRow,
        attachments: messageRow.attachments ?? [],
        citations: messageRow.citations ?? [],
        sort_order: messageRow.sort_order ?? 0,
        created_at: messageRow.created_at ?? timestamp,
      })),
    );

    expect(composed.notes).toBe("## Saved notes");
    const rootNode = composed.nodes[composed.rootNodeId];
    expect(rootNode.titleManuallyEdited).toBe(true);
    expect(rootNode.messages[0].attachments).toEqual(
      project.nodes[project.rootNodeId].messages[0].attachments,
    );
    expect(rootNode.messages[1].citations).toEqual(
      project.nodes[project.rootNodeId].messages[1].citations,
    );
  });
});
