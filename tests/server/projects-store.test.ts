import { describe, expect, it } from "vitest";
import {
  getProjectsForSession,
  projectBelongsToSession,
  withProjectOwner,
} from "@/lib/server/projects-store";
import type { Project } from "@/lib/types";

function makeProject(id: string, ownerSessionId?: string): Project {
  return {
    id,
    ownerSessionId,
    title: id,
    rootNodeId: `${id}-root`,
    nodes: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("project ownership helpers", () => {
  it("marks imported projects with the current anonymous session", () => {
    const project = makeProject("project-a", "old-session");

    expect(withProjectOwner(project, "new-session")).toEqual({
      ...project,
      ownerSessionId: "new-session",
    });
    expect(project.ownerSessionId).toBe("old-session");
  });

  it("filters project access by owner session", () => {
    const owned = makeProject("owned", "session-a");
    const other = makeProject("other", "session-b");
    const unowned = makeProject("unowned");

    expect(projectBelongsToSession(owned, "session-a")).toBe(true);
    expect(projectBelongsToSession(other, "session-a")).toBe(false);
    expect(projectBelongsToSession(unowned, "session-a")).toBe(false);
    expect(getProjectsForSession([owned, other, unowned], "session-a")).toEqual([
      owned,
    ]);
  });
});
