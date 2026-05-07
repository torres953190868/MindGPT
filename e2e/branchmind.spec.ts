import { readFile, writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

function makeSeed() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeWorkspaceProject(seed: string) {
  const timestamp = new Date().toISOString();
  const projectId = `e2e-project-${seed}`;
  const rootNodeId = `e2e-node-root-${seed}`;

  return {
    id: projectId,
    title: `E2E Workspace ${seed}`,
    rootNodeId,
    nodes: {
      [rootNodeId]: {
        id: rootNodeId,
        projectId,
        parentId: null,
        title: "Seeded root node",
        summary: "A deterministic project imported by Playwright.",
        messages: [
          {
            id: `e2e-message-user-${seed}`,
            role: "user",
            content: "Create a stable workspace for release checks.",
            createdAt: timestamp,
          },
          {
            id: `e2e-message-assistant-${seed}`,
            role: "assistant",
            content: "The workspace is ready for deterministic E2E checks.",
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

type WorkspaceProject = ReturnType<typeof makeWorkspaceProject>;

async function importProject(page: Page, project: WorkspaceProject): Promise<WorkspaceProject> {
  const response = await page.request.post("/api/projects/import", {
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

test("navigates the project shell with stable test ids", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("home-primary-navigation")).toBeVisible();
  await expect(page.getByTestId("home-projects-link")).toBeVisible();
  await expect(page.getByTestId("home-privacy-link")).toBeVisible();
  await expect(page.getByTestId("home-terms-link")).toBeVisible();

  await page.getByTestId("home-projects-link").click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("projects-navigation")).toBeVisible();
  await expect(page.getByTestId("project-card-list")).toBeVisible();
  await expect(page.getByTestId("project-search-input")).toBeVisible();
  await expect(
    page.getByTestId("project-grid").or(page.getByTestId("project-empty-state")),
  ).toBeVisible();
});

test("loads a seeded workspace with stable test ids", async ({ page }) => {
  const sourceProject = makeWorkspaceProject(makeSeed());
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;
    await page.request.post(`/api/projects/${project.id}/nodes/stream`, {
      data: {
        parentId: "missing-node-for-route-warmup",
        mode: "continue",
        instruction: "Warm up the streaming route.",
      },
    }).catch(() => undefined);

    await page.goto(`/workspace/${project.id}`);

    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("workspace-header")).toContainText(project.title);
    await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
    await expect(page.getByTestId("conversation-outline")).toBeVisible();
    await expect(page.getByTestId("conversation-outline-item")).toHaveCount(1);
    await expect(page.getByTestId("mind-map-canvas")).toBeVisible();
    await expect(page.getByTestId("branch-node-card")).toHaveCount(1);
    await expect(page.getByTestId("node-detail-panel")).toBeVisible();
    await expect(page.getByTestId("conversation-history")).toBeVisible();
    await expect(page.getByTestId("conversation-message")).toHaveCount(2);
    await expect(page.getByTestId("message-composer")).toBeVisible();
    await expect(page.getByTestId("message-instruction-input")).toBeVisible();
    await expect(page.getByTestId("send-message-button")).toBeVisible();

    await page.getByTestId("collapse-workspace-sidebar-button").click();
    await expect(page.getByTestId("expand-workspace-sidebar-button")).toBeVisible();
    await expect(page.getByTestId("conversation-outline")).toHaveCount(0);

    await page.getByTestId("expand-workspace-sidebar-button").click();
    await expect(page.getByTestId("conversation-outline")).toBeVisible();

    await page.getByTestId("collapse-node-detail-panel-button").click();
    await expect(page.getByTestId("expand-node-detail-panel-button")).toBeVisible();
    await expect(page.getByTestId("conversation-history")).toHaveCount(0);

    await page.getByTestId("expand-node-detail-panel-button").click();
    await expect(page.getByTestId("conversation-history")).toBeVisible();
  } finally {
    if (projectIdToDelete) {
      await page.request.delete(`/api/projects/${projectIdToDelete}`).catch(() => undefined);
    }
  }
});

test("streams a node reply into a draft child node", async ({ page }) => {
  const sourceProject = makeWorkspaceProject(`streaming-${makeSeed()}`);
  const instruction = "Stream a child answer for this workspace.";
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("message-instruction-input").fill(instruction);
    await page.getByTestId("send-message-button").click();

    await expect(page.getByTestId("branch-node-card")).toHaveCount(2);
    await expect(page.getByTestId("node-streaming-status")).toBeVisible();
    await expect(page.getByTestId("streaming-assistant-response")).toBeVisible();
    await expect(page.getByTestId("message-streaming-status")).toBeVisible();
    await expect(page.getByTestId("conversation-message")).toHaveCount(2);

    await expect(page.getByTestId("conversation-history")).toContainText(
      `Instruction received: ${instruction}`,
    );
    await expect(page.getByTestId("conversation-message")).toHaveCount(2);
    await expect(page.getByTestId("conversation-message").first()).toContainText(
      instruction,
    );
    await expect(page.getByTestId("message-streaming-status")).toHaveCount(0);
    await expect(page.getByTestId("streaming-assistant-response")).toHaveCount(0);
  } finally {
    if (projectIdToDelete) {
      await page.request.delete(`/api/projects/${projectIdToDelete}`).catch(() => undefined);
    }
  }
});

test("imports wrapper and legacy JSON, rejects invalid JSON, and exports without owner data", async ({
  page,
}, testInfo) => {
  const seed = makeSeed();
  const wrapperProject = makeWorkspaceProject(`wrapper-${seed}`);
  const legacyProject = makeWorkspaceProject(`legacy-${seed}`);
  const wrapperPath = testInfo.outputPath("branchmind-wrapper-import.json");
  const legacyPath = testInfo.outputPath("branchmind-legacy-import.json");
  const invalidPath = testInfo.outputPath("branchmind-invalid-import.json");

  await writeFile(
    wrapperPath,
    JSON.stringify({
      schemaVersion: 1,
      product: "BranchMind",
      exportedAt: new Date().toISOString(),
      project: wrapperProject,
    }),
  );
  await writeFile(legacyPath, JSON.stringify({ projects: [legacyProject] }));
  await writeFile(invalidPath, JSON.stringify({ project: { id: "not-enough" } }));

  try {
    await page.goto("/projects");
    const importInput = page.getByTestId("project-import-json-input");

    await importInput.setInputFiles(invalidPath);
    await expect(page.getByTestId("project-import-error-alert")).toContainText(
      "Choose a BranchMind project JSON export.",
    );

    await importInput.setInputFiles(wrapperPath);
    await expect(page.getByTestId("project-import-status")).toContainText(
      "Imported 1 of 1 project(s).",
    );
    const wrapperCard = page
      .getByTestId("project-card")
      .filter({ hasText: wrapperProject.title });
    await expect(wrapperCard).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await wrapperCard.getByTestId("export-project-json-button").click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exportedJson = await readFile(downloadPath!, "utf8");
    expect(exportedJson).toContain('"product": "BranchMind"');
    expect(exportedJson).not.toContain("ownerSessionId");
    expect(exportedJson).not.toContain("owner_session_id");
    expect(exportedJson).not.toContain("branchmind_session");

    await importInput.setInputFiles(legacyPath);
    await expect(page.getByTestId("project-import-status")).toContainText(
      "Imported 1 of 1 project(s).",
    );
    await expect(
      page.getByTestId("project-card").filter({ hasText: legacyProject.title }),
    ).toBeVisible();
  } finally {
    const response = await page.request.get("/api/projects").catch(() => null);
    const data = response ? await response.json().catch(() => null) : null;
    const projects = Array.isArray(data?.projects) ? data.projects : [];

    await Promise.all(
      projects
        .filter(
          (project: WorkspaceProject) =>
            project.title === wrapperProject.title || project.title === legacyProject.title,
        )
        .map((project: WorkspaceProject) =>
          page.request.delete(`/api/projects/${project.id}`).catch(() => undefined),
        ),
    );
  }
});

test("key pages do not overflow mobile and tablet widths", async ({ page }) => {
  const sourceProject = makeWorkspaceProject(`responsive-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    for (const viewport of [
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(viewport);

      for (const path of ["/", "/projects", `/workspace/${project.id}`]) {
        await page.goto(path);
        await expect(page.locator("main").first()).toBeVisible();
        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));

        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    }
  } finally {
    if (projectIdToDelete) {
      await page.request.delete(`/api/projects/${projectIdToDelete}`).catch(() => undefined);
    }
  }
});
