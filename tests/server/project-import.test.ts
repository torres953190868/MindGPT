import { describe, expect, it } from "vitest";
import { prepareProjectImport } from "@/lib/server/project-import";

describe("project import", () => {
  it("defaults missing legacy project notes to an empty string", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const result = prepareProjectImport({
      id: "legacy-project",
      title: "Legacy project",
      rootNodeId: "legacy-root",
      nodes: {
        "legacy-root": {
          id: "legacy-root",
          projectId: "legacy-project",
          parentId: null,
          title: "Legacy root",
          summary: "Imported without notes.",
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
    });

    expect(result.importedCount).toBe(1);
    expect(result.projects[0].notes).toBe("");
  });

  it("defaults legacy messages to empty attachments", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const result = prepareProjectImport({
      id: "legacy-project",
      title: "Legacy project",
      rootNodeId: "legacy-root",
      nodes: {
        "legacy-root": {
          id: "legacy-root",
          projectId: "legacy-project",
          parentId: null,
          title: "Legacy root",
          summary: "Imported without attachments.",
          messages: [
            {
              id: "legacy-message",
              role: "user",
              content: "Legacy prompt",
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
    });

    const rootNode = result.projects[0].nodes[result.projects[0].rootNodeId];
    expect(rootNode.messages[0].attachments).toEqual([]);
  });
});
