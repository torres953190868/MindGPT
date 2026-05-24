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
    expect(result.projects[0].nodes[result.projects[0].rootNodeId].titleManuallyEdited).toBe(false);
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
    expect(rootNode.messages[0].citations).toEqual([]);
  });

  it("preserves valid message citations during import", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const result = prepareProjectImport({
      id: "citation-project",
      title: "Citation project",
      rootNodeId: "citation-root",
      nodes: {
        "citation-root": {
          id: "citation-root",
          projectId: "citation-project",
          parentId: null,
          title: "Citation root",
          summary: "Imported with citations.",
          messages: [
            {
              id: "citation-message",
              role: "assistant",
              content: "Answer [[cite:1]]",
              citations: [
                {
                  index: 1,
                  documentId: "document-import-test",
                  documentName: "source.pdf",
                  chunkId: "chunk-import-test",
                  pageStart: 4,
                  pageEnd: 4,
                  headingPath: ["Evidence"],
                  quote: "Imported citation text.",
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
    });

    const rootNode = result.projects[0].nodes[result.projects[0].rootNodeId];
    expect(rootNode.messages[0].citations).toEqual([
      expect.objectContaining({
        index: 1,
        documentId: "document-import-test",
        chunkId: "chunk-import-test",
        pageStart: 4,
      }),
    ]);
  });

  it("preserves imported manual title flags", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const result = prepareProjectImport({
      id: "manual-title-project",
      title: "Manual title project",
      rootNodeId: "manual-title-root",
      nodes: {
        "manual-title-root": {
          id: "manual-title-root",
          projectId: "manual-title-project",
          parentId: null,
          title: "Manual root",
          titleManuallyEdited: true,
          summary: "Imported manual title.",
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

    expect(result.projects[0].nodes[result.projects[0].rootNodeId].titleManuallyEdited).toBe(true);
  });
});
