import { expect, type Page, test } from "@playwright/test";
import type { Project } from "@/lib/types";

const E2E_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 12741}`;
const API_MUTATION_HEADERS = { Origin: E2E_BASE_URL };

function makeSeed() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeWorkspaceProject(seed: string): Project {
  const timestamp = new Date().toISOString();
  const projectId = `e2e-project-${seed}`;
  const rootNodeId = `e2e-node-root-${seed}`;

  return {
    id: projectId,
    title: `E2E Workspace ${seed}`,
    notes: "",
    rootNodeId,
    nodes: {
      [rootNodeId]: {
        id: rootNodeId,
        projectId,
        parentId: null,
        title: "Seeded root node",
        titleManuallyEdited: false,
        summary: "A deterministic project imported by Playwright.",
        messages: [
          {
            id: `e2e-message-user-${seed}`,
            role: "user",
            content: "Create a stable workspace for release checks.",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: `e2e-message-assistant-${seed}`,
            role: "assistant",
            content:
              "## Workspace ready\n\nThe workspace is **ready** for deterministic E2E checks.\n\n- Stable selectors\n- Markdown rendering",
            attachments: [],
            createdAt: timestamp,
          },
        ],
        children: [],
        position: { x: 120, y: 120 },
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

type WorkspaceProject = Project;

async function importProject(page: Page, project: WorkspaceProject): Promise<WorkspaceProject> {
  const response = await page.request.post("/api/projects/import", {
    headers: API_MUTATION_HEADERS,
    data: { projects: [project] },
  });
  expect(response.status(), await response.text()).toBe(200);

  const data = await response.json();
  const projects = Array.isArray(data.projects) ? (data.projects as WorkspaceProject[]) : [];
  const importedProject = projects.find((item) => item.title === project.title) ?? null;

  if (!importedProject) {
    throw new Error(`Imported project ${project.title} was not returned by the API.`);
  }

  return importedProject;
}

test("shows a conflict error when another tab edits the node during regeneration", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Concurrency conflict coverage runs once.");

  const sourceProject = makeWorkspaceProject(`regen-conflict-${makeSeed()}`);
  const editedNodeTitle = `Renamed in second tab ${makeSeed()}`;
  const originalAssistantExcerpt = "ready for deterministic E2E checks";
  let projectIdToDelete: string | null = null;
  let tabB: Page | null = null;

  try {
    const tabA = page;
    const project = await importProject(tabA, sourceProject);
    projectIdToDelete = project.id;

    await tabA.goto(`/workspace/${project.id}`);
    const assistantMessage = tabA.getByTestId("conversation-message").last();
    await expect(assistantMessage).toContainText(originalAssistantExcerpt);

    // Second tab in the same context shares the session cookie.
    tabB = await context.newPage();
    await tabB.goto(`/workspace/${project.id}`);
    await expect(tabB.getByTestId("edit-node-title-button")).toBeVisible();

    // Tab A starts a streaming regeneration of the latest assistant reply.
    await assistantMessage.getByLabel("重试助手回复").click();
    await expect(tabA.getByTestId("message-streaming-status")).toBeVisible();

    // While tab A is still streaming, tab B renames the same node. The title
    // PATCH is a fast non-AI mutation that bumps the server-side
    // node.updatedAt before tab A's streamed reply is saved.
    const nodePatchResponse = tabB.waitForResponse(
      (response) =>
        response.url().includes(`/api/projects/${project.id}/nodes/`) &&
        response.request().method() === "PATCH" &&
        response.ok(),
    );
    await tabB.getByTestId("edit-node-title-button").click();
    await tabB.getByTestId("node-title-edit-input").fill(editedNodeTitle);
    await tabB.getByTestId("save-node-title-edit-button").click();
    await nodePatchResponse;
    await expect(tabB.getByTestId("node-detail-panel")).toContainText(editedNodeTitle);

    // Tab A's save now hits the expectedNodeUpdatedAt conflict and rolls back.
    await expect(tabA.getByTestId("message-error-alert")).toContainText(
      "这段对话已在其他窗口中被修改，请刷新后重试。",
      { timeout: 15_000 },
    );
    await expect(tabA.getByTestId("message-streaming-status")).toHaveCount(0);
    await expect(tabA.getByTestId("conversation-message")).toHaveCount(2);
    await expect(assistantMessage).toContainText(originalAssistantExcerpt);
  } finally {
    await tabB?.close().catch(() => undefined);
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});
