import { readFile, writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import type { Project } from "@/lib/types";

test.describe.configure({ mode: "serial" });

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
            content:
              "## Workspace ready\n\nThe workspace is **ready** for deterministic E2E checks.\n\n- Stable selectors\n- Markdown rendering",
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

function makeWorkspaceTreeProject(seed: string): WorkspaceProject {
  const project = makeWorkspaceProject(`tree-${seed}`);
  const timestamp = project.createdAt;
  const rootNode = project.nodes[project.rootNodeId];
  const basicsNodeId = `e2e-node-basics-${seed}`;
  const gradientNodeId = `e2e-node-gradient-${seed}`;
  const toolsNodeId = `e2e-node-tools-${seed}`;

  return {
    ...project,
    title: `E2E Outline ${seed}`,
    nodes: {
      [project.rootNodeId]: {
        ...rootNode,
        title: "Machine Learning Map",
        summary: "Root outline node for sidebar tree checks.",
        children: [basicsNodeId, toolsNodeId],
      },
      [basicsNodeId]: {
        id: basicsNodeId,
        projectId: project.id,
        parentId: project.rootNodeId,
        title: "Machine Learning Basics",
        summary: "Parent outline item with a nested child.",
        messages: [],
        children: [gradientNodeId],
        position: { x: 120, y: 410 },
        branchType: "continue",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      [gradientNodeId]: {
        id: gradientNodeId,
        projectId: project.id,
        parentId: basicsNodeId,
        title: "Gradient Descent Details",
        summary: "Nested child found through outline search.",
        messages: [],
        children: [],
        position: { x: 120, y: 700 },
        branchType: "continue",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      [toolsNodeId]: {
        id: toolsNodeId,
        projectId: project.id,
        parentId: project.rootNodeId,
        title: "Programming Tools",
        summary: "Sibling outline item without children.",
        messages: [],
        children: [],
        position: { x: 510, y: 410 },
        branchType: "branch",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
}

function getNodeByTitle(project: WorkspaceProject, title: string) {
  const node = Object.values(project.nodes).find((item) => item.title === title);
  if (!node) throw new Error(`Expected node titled "${title}" in imported project.`);
  return node;
}

function getOutlineRow(page: Page, nodeId: string) {
  return page.locator(`[data-testid="conversation-outline-row"][data-node-id="${nodeId}"]`);
}

function getOutlineToggle(page: Page, nodeId: string) {
  return page.locator(`[data-testid="conversation-outline-toggle"][data-node-id="${nodeId}"]`);
}

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
      headers: API_MUTATION_HEADERS,
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
    await expect(page.getByTestId("conversation-message-content")).toHaveCount(2);
    const assistantMessage = page.getByTestId("conversation-message").last();
    await expect(
      assistantMessage.getByRole("heading", { level: 2, name: "Workspace ready" }),
    ).toBeVisible();
    await expect(assistantMessage.locator("strong")).toHaveText("ready");
    await expect(assistantMessage.locator("li")).toHaveCount(2);
    await expect(page.getByTestId("message-composer")).toBeVisible();
    await expect(page.getByTestId("message-instruction-input")).toBeVisible();
    await expect(page.getByTestId("send-message-button")).toBeVisible();
    const mindMapCanvas = page.getByTestId("mind-map-canvas");

    await page.getByTestId("collapse-workspace-sidebar-button").click();
    await expect(page.getByTestId("workspace-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("conversation-outline")).toHaveCount(0);
    await expect(mindMapCanvas.getByTestId("expand-workspace-sidebar-button")).toBeVisible();

    await mindMapCanvas.getByTestId("expand-workspace-sidebar-button").click();
    await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
    await expect(page.getByTestId("conversation-outline")).toBeVisible();

    if (test.info().project.name === "chromium") {
      await expect(page.getByTestId("resize-workspace-sidebar")).toBeVisible();
    }

    await page.getByTestId("collapse-node-detail-panel-button").click();
    await expect(page.getByTestId("node-detail-panel")).toHaveCount(0);
    await expect(page.getByTestId("conversation-history")).toHaveCount(0);
    await expect(mindMapCanvas.getByTestId("expand-node-detail-panel-button")).toBeVisible();

    await mindMapCanvas.getByTestId("expand-node-detail-panel-button").click();
    await expect(page.getByTestId("node-detail-panel")).toBeVisible();
    await expect(page.getByTestId("conversation-history")).toBeVisible();
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("copies, edits, and retries conversation messages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Clipboard message actions are covered once.");

  const sourceProject = makeWorkspaceProject(`actions-${makeSeed()}`);
  const editedInstruction = "Edited prompt from message actions.";
  let projectIdToDelete: string | null = null;

  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: E2E_BASE_URL,
    });
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    const userMessage = page.getByTestId("conversation-message").first();
    await userMessage.getByLabel("Copy user message").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Create a stable workspace for release checks.");

    await userMessage.getByLabel("Edit user message").click();
    await page.getByTestId("message-edit-input").fill(editedInstruction);
    await page.getByTestId("save-message-edit-button").click();
    await expect(page.getByTestId("message-streaming-status")).toBeVisible();
    await expect(userMessage).toContainText(editedInstruction);
    await expect(page.getByTestId("conversation-history")).toContainText(
      `Instruction received: ${editedInstruction}`,
      { timeout: 12_000 },
    );
    await expect(page.getByTestId("message-streaming-status")).toHaveCount(0);
    await expect(page.getByTestId("workspace-header")).toContainText(editedInstruction);

    const assistantMessage = page.getByTestId("conversation-message").last();
    await assistantMessage.getByLabel("Copy assistant message").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`Instruction received: ${editedInstruction}`);

    await assistantMessage.getByLabel("Retry assistant response").click();
    await expect(page.getByTestId("message-streaming-status")).toBeVisible();
    await expect(page.getByTestId("conversation-history")).toContainText(
      `Instruction received: ${editedInstruction}`,
      { timeout: 12_000 },
    );
    await expect(page.getByTestId("message-streaming-status")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("conversation-message").first()).toContainText(
      editedInstruction,
    );
    await expect(page.getByTestId("conversation-history")).toContainText(
      `Instruction received: ${editedInstruction}`,
    );
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("adds the latest AI reply to editable project notes and persists it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Project notes persistence is covered once.");

  const sourceProject = makeWorkspaceProject(`notes-${makeSeed()}`);
  const manualNote = "Manual note line for autosave.";
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("node-detail-notes-button").click();

    const notesInput = page.getByTestId("project-notes-input");
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await page.getByTestId("add-latest-ai-reply-note-button").click();

    await expect(notesInput).toHaveValue(/## Seeded root node/);
    await expect(notesInput).toHaveValue(/The workspace is \*\*ready\*\*/);
    await expect(page.getByTestId("project-notes-save-status")).toContainText("Saved", {
      timeout: 5_000,
    });

    await page.getByTestId("project-notes-preview-button").click();
    const notesPreview = page.getByTestId("project-notes-preview");
    await expect(page.getByTestId("project-notes-preview-content")).toBeVisible();
    await expect(
      notesPreview.getByRole("heading", { level: 2, name: "Seeded root node" }),
    ).toBeVisible();
    await expect(
      notesPreview.getByRole("heading", { level: 2, name: "Workspace ready" }),
    ).toBeVisible();
    await expect(notesPreview.locator("strong")).toHaveText("ready");
    await expect(notesPreview.locator("li")).toHaveCount(2);
    await expect(page.getByTestId("conversation-message-content")).toHaveCount(2);

    await page.getByTestId("project-notes-edit-button").click();
    const notesValue = await notesInput.inputValue();
    await notesInput.fill(`${notesValue}\n\n${manualNote}`);
    await expect(page.getByTestId("project-notes-save-status")).toContainText("Saved", {
      timeout: 5_000,
    });

    await page.reload();
    await page.getByTestId("node-detail-notes-button").click();
    await expect(page.getByTestId("project-notes-input")).toHaveValue(new RegExp(manualNote));
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("toggles the project notes side window from the node detail header", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The side-window toggle is a desktop behavior.");

  const sourceProject = makeWorkspaceProject(`notes-toggle-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/workspace/${project.id}`);
    const notesButton = page.getByTestId("node-detail-notes-button");

    await expect(notesButton).toHaveAttribute("aria-expanded", "false");
    await notesButton.click();
    await expect(notesButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();

    const notesWindow = page.getByTestId("project-notes-window");
    const notesResizeHandle = page.getByTestId("resize-project-notes-panel");
    await expect(notesResizeHandle).toBeVisible();
    const notesWidthBefore = await notesWindow.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    const handleBox = await notesResizeHandle.boundingBox();
    if (!handleBox) throw new Error("Expected the project notes resize handle to be measurable.");

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 140, handleBox.y + handleBox.height / 2, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(() => notesWindow.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(notesWidthBefore + 80);
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await notesButton.click();
    await expect(notesButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);

    await notesButton.click();
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await page.getByTestId("collapse-node-detail-panel-button").click();
    await expect(page.getByTestId("node-detail-panel")).toHaveCount(0);
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("shows project notes as a mobile drawer without horizontal overflow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "The drawer interaction is covered on mobile.");

  const sourceProject = makeWorkspaceProject(`notes-mobile-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("node-detail-notes-button").click();

    await expect(page.getByTestId("project-notes-window")).toBeVisible();
    await expect(page.getByTestId("project-notes-drawer-backdrop")).toBeVisible();
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await expect(page.getByTestId("resize-project-notes-panel")).toBeHidden();
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);

    await page.getByTestId("node-detail-notes-button").click();
    await page.getByTestId("project-notes-drawer-backdrop").click({ position: { x: 6, y: 6 } });
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);

    await page.getByTestId("node-detail-notes-button").click();
    await page.getByTestId("close-project-notes-button").click();
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("shows the workspace sidebar as a collapsible tree outline", async ({ page }) => {
  const sourceProject = makeWorkspaceTreeProject(makeSeed());
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;
    const root = project.nodes[project.rootNodeId];
    const basics = getNodeByTitle(project, "Machine Learning Basics");
    const gradient = getNodeByTitle(project, "Gradient Descent Details");

    await page.goto(`/workspace/${project.id}`);

    await expect(page.getByTestId("conversation-outline-row")).toHaveCount(4);
    await expect(getOutlineRow(page, root.id)).toHaveAttribute("data-depth", "0");
    await expect(getOutlineRow(page, basics.id)).toHaveAttribute("data-depth", "1");
    await expect(getOutlineRow(page, gradient.id)).toHaveAttribute("data-depth", "2");

    await getOutlineToggle(page, basics.id).click();
    await expect(getOutlineRow(page, gradient.id)).toHaveCount(0);
    await expect(page.getByTestId("branch-node-card")).toHaveCount(4);

    await getOutlineToggle(page, basics.id).click();
    await expect(getOutlineRow(page, gradient.id)).toBeVisible();

    await getOutlineRow(page, gradient.id).getByTestId("conversation-outline-item").click();
    await expect(page.getByTestId("node-detail-panel")).toContainText(
      "Gradient Descent Details",
    );

    await getOutlineToggle(page, basics.id).click();
    await expect(getOutlineRow(page, gradient.id)).toHaveCount(0);

    await page.getByTestId("node-search-input").fill("Gradient");
    await expect(getOutlineRow(page, basics.id)).toBeVisible();
    await expect(getOutlineRow(page, gradient.id)).toBeVisible();

    await page.getByTestId("node-search-input").fill("");
    await expect(getOutlineRow(page, gradient.id)).toHaveCount(0);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
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
    await page.request.post(`/api/projects/${project.id}/nodes/stream`, {
      headers: API_MUTATION_HEADERS,
      data: {
        parentId: "missing-node-for-route-warmup",
        mode: "continue",
        instruction: "Warm up the streaming route.",
      },
    }).catch(() => undefined);

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
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
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
          page.request
            .delete(`/api/projects/${project.id}`, { headers: API_MUTATION_HEADERS })
            .catch(() => undefined),
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
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});
