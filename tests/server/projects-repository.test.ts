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
        summary: "Root summary",
        messages: [],
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
    const { projectRow, nodeRows } = projectToRows(project);
    const persistedProjectRow = {
      ...projectRow,
      notes: projectRow.notes ?? "",
      created_at: projectRow.created_at ?? timestamp,
      updated_at: projectRow.updated_at ?? timestamp,
    };

    expect(projectRow.notes).toBe("## Saved notes");

    const [composed] = composeProjectsFromRows(
      [persistedProjectRow],
      nodeRows.map((nodeRow) => ({
        ...nodeRow,
        parent_id: nodeRow.parent_id ?? null,
        summary: nodeRow.summary ?? "",
        position_x: nodeRow.position_x ?? 0,
        position_y: nodeRow.position_y ?? 0,
        collapsed: nodeRow.collapsed ?? false,
        child_order: nodeRow.child_order ?? 0,
        created_at: nodeRow.created_at ?? timestamp,
        updated_at: nodeRow.updated_at ?? timestamp,
      })),
      [],
    );

    expect(composed.notes).toBe("## Saved notes");
  });
});
