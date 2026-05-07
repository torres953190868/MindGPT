import { describe, expect, it } from "vitest";
import { createProjectExport } from "@/lib/project-export";
import type { Project } from "@/lib/types";

function makeProject(): Project {
  return {
    id: "project-export-test",
    ownerSessionId: "owner-session-should-not-export",
    title: "Export test",
    rootNodeId: "node-root-export-test",
    nodes: {
      "node-root-export-test": {
        id: "node-root-export-test",
        projectId: "project-export-test",
        parentId: null,
        title: "Root",
        summary: "Root summary",
        messages: [],
        children: [],
        position: { x: 0, y: 0 },
        branchType: "root",
        collapsed: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("project export", () => {
  it("does not include owner/session fields in JSON exports", () => {
    const exported = createProjectExport(makeProject());
    const serialized = JSON.stringify(exported);

    expect(exported.project).not.toHaveProperty("ownerSessionId");
    expect(serialized).not.toContain("owner_session_id");
    expect(serialized).not.toContain("owner-session-should-not-export");
  });
});
