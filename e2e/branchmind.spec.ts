import { readFile, writeFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ChatMessage, Project } from "@/lib/types";
import { createSyntheticPdf } from "../tests/server/rag/pdf-fixtures";

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

function makeScrollableWorkspaceProject(seed: string): WorkspaceProject {
  const project = makeWorkspaceProject(`scroll-${seed}`);
  const timestamp = project.createdAt;
  const rootNode = project.nodes[project.rootNodeId];
  const messages: ChatMessage[] = Array.from({ length: 30 }, (_, index) => {
    const messageNumber = index + 1;
    const role = index % 2 === 0 ? "user" : "assistant";
    const paragraph = Array.from(
      { length: 4 },
      (_, lineIndex) =>
        `Scrollable detail ${messageNumber}.${lineIndex + 1} keeps enough text in the panel to require an internal scroll container.`,
    ).join("\n\n");

    return {
      id: `e2e-message-scroll-${seed}-${messageNumber}`,
      role,
      content:
        role === "assistant"
          ? `## Scroll reply ${messageNumber}\n\n${paragraph}\n\n- Nested evidence\n- More evidence`
          : `Scroll prompt ${messageNumber}\n\n${paragraph}`,
      attachments: [],
      createdAt: timestamp,
    };
  });
  const notes = Array.from(
    { length: 52 },
    (_, index) =>
      `## Notebook section ${index + 1}\n\nThis saved project note is intentionally long so the editor must scroll internally instead of resizing the notes window.\n\n- Stable note row\n- Additional note row`,
  ).join("\n\n");

  return {
    ...project,
    title: `E2E Scroll Containers ${seed}`,
    notes,
    nodes: {
      ...project.nodes,
      [project.rootNodeId]: {
        ...rootNode,
        title: "Scrollable root node",
        summary: "A deterministic project with long conversation and notes content.",
        messages,
      },
    },
  };
}

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
        titleManuallyEdited: false,
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
        titleManuallyEdited: false,
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
        titleManuallyEdited: false,
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

async function expectWheelScrolls(page: Page, locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const scrollElement = element as HTMLElement;
        return scrollElement.scrollHeight - scrollElement.clientHeight;
      }),
    )
    .toBeGreaterThan(24);

  await locator.evaluate((element) => {
    (element as HTMLElement).scrollTop = 0;
  });
  const scrollTopBefore = await locator.evaluate(
    (element) => (element as HTMLElement).scrollTop,
  );

  await locator.hover();
  await page.mouse.wheel(0, 700);
  await expect
    .poll(() => locator.evaluate((element) => (element as HTMLElement).scrollTop))
    .toBeGreaterThan(scrollTopBefore + 24);
}

async function getElementWidth(locator: Locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().width);
}

async function getElementBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Expected ${label} to be measurable.`);
  return box;
}

async function dragResizeHandle(page: Page, handle: Locator, deltaX: number) {
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Expected resize handle to be measurable.");

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
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

async function getPersistedProject(page: Page, projectId: string): Promise<WorkspaceProject> {
  const response = await page.request.get("/api/projects");
  expect(response.status(), await response.text()).toBe(200);

  const data = await response.json();
  const projects = Array.isArray(data.projects) ? (data.projects as WorkspaceProject[]) : [];
  const project = projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`Expected project ${projectId} to be persisted.`);

  return project;
}

async function mockAuthSession(page: Page, session: { configured: boolean; user: null | { id: string; email: string | null } }) {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    });
  });
}

async function mockHomeModelCatalog(page: Page) {
  await page.route("**/api/chat/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        defaultSelection: {
          providerId: "deepseek",
          model: "deepseek-v4-flash",
        },
        providers: [
          {
            id: "deepseek",
            displayName: "DeepSeek",
            configured: true,
            models: ["deepseek-v4-flash"],
          },
          {
            id: "opencode-go",
            displayName: "OpenCode Go",
            configured: true,
            models: ["qwen3.6-plus", "kimi-k2.6"],
          },
        ],
      }),
    });
  });
}

test("home opens directly into a draft workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("home-hero")).toHaveCount(0);
  await expect(page.getByTestId("workspace-header")).toContainText("New workspace");
  await expect(page.getByTestId("branch-node-card")).toHaveCount(1);
  await expect(page.getByTestId("branch-node-card")).toContainText("New node");
  await expect(page.getByTestId("workspace-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("node-detail-panel")).toHaveCount(0);
  await expect(page.getByTestId("message-composer")).toHaveCount(1);
  await expect(
    page.getByTestId("branch-node-card").getByTestId("message-composer"),
  ).toBeVisible();
  await expect(page.getByTestId("message-branch-mode")).toHaveCount(0);
  await expect(page.getByTestId("node-detail-notes-button")).toHaveCount(0);
  await expect(page.getByTestId("message-instruction-input")).toHaveAttribute(
    "placeholder",
    "Start with a research question...",
  );
  await expect(page.getByTestId("send-message-button")).toContainText("Start");
  const mindMapCanvas = page.getByTestId("mind-map-canvas");
  const mapWidthWithPanelsCollapsed = await getElementWidth(mindMapCanvas);

  await expect(mindMapCanvas.getByTestId("expand-workspace-sidebar-button")).toBeVisible();
  await expect(mindMapCanvas.getByTestId("expand-node-detail-panel-button")).toBeVisible();

  await mindMapCanvas.getByTestId("expand-workspace-sidebar-button").click();
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
  await expect
    .poll(() => getElementWidth(mindMapCanvas))
    .toBeLessThan(mapWidthWithPanelsCollapsed - 120);

  await page.getByTestId("collapse-workspace-sidebar-button").click();
  await expect(page.getByTestId("workspace-sidebar")).toHaveCount(0);

  await mindMapCanvas.getByTestId("expand-node-detail-panel-button").click();
  await expect(page.getByTestId("node-detail-panel")).toBeVisible();
  await expect(
    page.getByTestId("node-detail-panel").getByTestId("message-composer"),
  ).toHaveCount(0);
  await expect(page.getByTestId("message-composer")).toHaveCount(1);

  await page.getByTestId("workspace-projects-link").click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("projects-navigation")).toBeVisible();
  await expect(page.getByTestId("project-card-list")).toBeVisible();
  await expect(page.getByTestId("project-search-input")).toBeVisible();
  await expect(
    page.getByTestId("project-grid").or(page.getByTestId("project-empty-state")),
  ).toBeVisible();
});

test("home draft workspace sidebars resize and snap like workspace", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop draft resizing is covered once.");

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");

  const mindMapCanvas = page.getByTestId("mind-map-canvas");
  const workspaceSidebar = page.getByTestId("workspace-sidebar");
  const nodeDetailPanel = page.getByTestId("node-detail-panel");

  await expect(workspaceSidebar).toHaveCount(0);
  await expect(nodeDetailPanel).toHaveCount(0);
  await mindMapCanvas.getByTestId("expand-workspace-sidebar-button").click();
  await mindMapCanvas.getByTestId("expand-node-detail-panel-button").click();
  await expect(workspaceSidebar).toBeVisible();
  await expect(nodeDetailPanel).toBeVisible();
  await expect(page.getByTestId("resize-workspace-sidebar")).toBeVisible();
  await expect(page.getByTestId("resize-node-details-panel")).toBeVisible();
  await expect(nodeDetailPanel.getByTestId("message-composer")).toHaveCount(0);

  await dragResizeHandle(page, page.getByTestId("resize-workspace-sidebar"), 430);
  await expect.poll(() => getElementWidth(workspaceSidebar)).toBeGreaterThan(560);
  await expect.poll(() => getElementWidth(mindMapCanvas)).toBeGreaterThan(219);
  await expectNoHorizontalOverflow(page);

  const wideSidebarWidth = await getElementWidth(workspaceSidebar);
  await dragResizeHandle(
    page,
    page.getByTestId("resize-workspace-sidebar"),
    -(wideSidebarWidth + 120),
  );
  await expect(workspaceSidebar).toHaveCount(0);
  await expect(mindMapCanvas.getByTestId("expand-workspace-sidebar-button")).toBeVisible();

  await mindMapCanvas.getByTestId("expand-workspace-sidebar-button").click();
  await expect(workspaceSidebar).toBeVisible();
  await expect.poll(() => getElementWidth(workspaceSidebar)).toBeGreaterThan(560);

  const detailWidthBeforeSnap = await getElementWidth(nodeDetailPanel);
  await dragResizeHandle(
    page,
    page.getByTestId("resize-node-details-panel"),
    detailWidthBeforeSnap + 120,
  );
  await expect(nodeDetailPanel).toHaveCount(0);
  await expect(mindMapCanvas.getByTestId("expand-node-detail-panel-button")).toBeVisible();

  await mindMapCanvas.getByTestId("expand-node-detail-panel-button").click();
  await expect(nodeDetailPanel).toBeVisible();
  await expect.poll(() => getElementWidth(nodeDetailPanel)).toBeGreaterThanOrEqual(300);
  await expect(page.getByTestId("node-detail-notes-button")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("home launcher restores a stored model after hydration", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Home composer controls are covered once.");

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await mockHomeModelCatalog(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "branchmind.chatModelSelection.v1",
      JSON.stringify({
        providerId: "opencode-go",
        model: "kimi-k2.6",
      }),
    );
  });

  await page.goto("/");
  await expect(page.getByTestId("chat-model-selector-button")).toContainText("Kimi K2.6");
  expect(consoleErrors.join("\n")).not.toContain("Hydration failed");
});

test("home launcher sends the selected model without model-named loading copy", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Home composer controls are covered once.");

  const seed = makeSeed();
  const instruction = `Create a model-selected project ${seed}.`;
  let syncPayload: unknown = null;
  let projectPostRequests = 0;
  let releaseSync!: () => void;
  const releaseSyncPromise = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });

  await mockHomeModelCatalog(page);
  await page.route("**/api/documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [] }),
    });
  });
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [] }),
      });
      return;
    }

    projectPostRequests += 1;
    await route.fallback();
  });
  await page.route("**/api/projects/**/sync", async (route) => {
    syncPayload = route.request().postDataJSON();
    await releaseSyncPromise;
    const payload = syncPayload as { project: Project };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ project: payload.project }),
    });
  });

  await page.goto("/");
  await expect.poll(() => projectPostRequests).toBe(0);
  await expect.poll(() => syncPayload).toBeNull();
  await page.getByTestId("chat-model-selector-button").click();
  await expect(page.getByTestId("chat-model-menu")).toBeVisible();
  await page
    .getByTestId("chat-model-option")
    .filter({ hasText: "Kimi K2.6" })
    .click();
  await page.getByTestId("message-instruction-input").fill(instruction);
  await page.getByTestId("send-message-button").click();

  await expect(page).toHaveURL(/\/workspace\/project_/);
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.getByTestId("chat-model-selector-button")).toContainText("Kimi K2.6");
  await expect(page.getByTestId("project-sync-status")).toHaveCount(0);
  await expect.poll(() => syncPayload).not.toBeNull();
  const pendingRecord = await page.evaluate(() => {
    const raw = window.localStorage.getItem("branchmind.pendingProjectSync.v1");
    return raw ? JSON.parse(raw).records?.[0] : null;
  });
  expect(pendingRecord?.project?.title).toBe(instruction);
  expect(pendingRecord?.modelSelection).toEqual({
    providerId: "opencode-go",
    model: "kimi-k2.6",
  });
  releaseSync();
});

test("home launcher keeps a failed local project sync across reload", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Failed local sync is covered once.");

  const instruction = `Keep a failed local project ${makeSeed()}.`;
  let syncRequests = 0;

  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [] }),
      });
      return;
    }

    await route.fallback();
  });
  await page.route("**/api/projects/**/sync", async (route) => {
    syncRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Delayed Supabase sync" } }),
    });
  });

  await page.goto("/");
  await page.getByTestId("message-instruction-input").fill(instruction);
  await page.getByTestId("send-message-button").click();

  await expect(page).toHaveURL(/\/workspace\/project_/);
  await expect.poll(() => syncRequests).toBe(1);
  await expect(page.getByTestId("project-sync-status")).toHaveAttribute(
    "data-status",
    "failed",
  );
  await expect(page.getByTestId("retry-project-sync-button")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect(page.locator("#workspace-title")).toContainText(instruction);
  await expect(page.getByTestId("project-sync-status")).toHaveAttribute(
    "data-status",
    "failed",
  );

  const pendingRecord = await page.evaluate(() => {
    const raw = window.localStorage.getItem("branchmind.pendingProjectSync.v1");
    return raw ? JSON.parse(raw).records?.[0] : null;
  });
  expect(pendingRecord?.project?.title).toBe(instruction);
  expect(pendingRecord?.status).toBe("failed");
});

test("home launcher opens the workspace while the initial root answer streams", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Initial streaming is covered once.");

  const instruction = `Stream the first project answer ${makeSeed()}.`;
  let projectIdToDelete: string | null = null;

  try {
    await page.goto("/");
    await page.getByTestId("message-instruction-input").fill(instruction);
    await page.getByTestId("send-message-button").click();

    await expect(page).toHaveURL(/\/workspace\/project_/);
    projectIdToDelete = new URL(page.url()).pathname.split("/").filter(Boolean).pop() ?? null;

    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("message-streaming-status")).toBeVisible();
    await expect(page.getByTestId("conversation-history")).toContainText(
      "Mock mode is enabled",
    );
    await expect(page.getByTestId("message-streaming-status")).toBeVisible();
    await expect(page.getByTestId("conversation-history")).toContainText(
      `Instruction received: ${instruction}`,
    );
    await expect(page.getByTestId("message-streaming-status")).toHaveCount(0);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => null);
    }
  }
});

test("home launcher uploads and indexes PDF attachments before creating a project", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Home PDF upload is covered once.");

  const seed = makeSeed();
  const documentId = `doc-home-upload-${seed}`;
  const instruction = `Create a PDF-attached project ${seed}.`;
  let syncPayload: unknown = null;
  let uploadRequests = 0;
  let indexRequests = 0;

  await mockHomeModelCatalog(page);
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [] }),
    });
  });
  await page.route("**/api/documents/upload", async (route) => {
    uploadRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document: {
          id: documentId,
          fileName: "home-source.pdf",
          mimeType: "application/pdf",
          status: "uploaded",
          errorMessage: null,
        },
      }),
    });
  });
  await page.route("**/api/documents/**/index", async (route) => {
    indexRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document: {
          id: documentId,
          fileName: "home-source.pdf",
          mimeType: "application/pdf",
          status: "indexed",
          errorMessage: null,
        },
      }),
    });
  });
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [] }),
      });
      return;
    }

    await route.fallback();
  });
  await page.route("**/api/projects/**/sync", async (route) => {
    syncPayload = route.request().postDataJSON();
    const payload = syncPayload as { project: Project };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ project: payload.project }),
    });
  });

  await page.goto("/");
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("add-message-attachment-button").click();
  await page.getByTestId("upload-new-file-button").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "home-source.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });

  await expect(page.getByTestId("pending-attachment-chip")).toContainText(
    "home-source.pdf",
  );
  await page.getByTestId("message-instruction-input").fill(instruction);
  await page.getByTestId("send-message-button").click();

  await expect.poll(() => syncPayload).not.toBeNull();
  const payload = syncPayload as { project: Project };
  const rootNode = payload.project.nodes[payload.project.rootNodeId];
  expect(rootNode.messages[0].content).toBe(instruction);
  expect(rootNode.messages[0].attachments).toEqual([
    expect.objectContaining({
      name: "home-source.pdf",
      mimeType: "application/pdf",
      documentId,
      documentStatus: "indexed",
    }),
  ]);
  expect(uploadRequests).toBe(1);
  expect(indexRequests).toBe(1);
});

test("home launcher selects an indexed knowledge PDF without re-uploading", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Home knowledge selection is covered once.");

  const seed = makeSeed();
  const documentId = `doc-home-knowledge-${seed}`;
  const instruction = `Create a knowledge-attached project ${seed}.`;
  let syncPayload: unknown = null;
  let uploadRequests = 0;
  let indexRequests = 0;

  await mockHomeModelCatalog(page);
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documents: [
          {
            id: documentId,
            fileName: "home-memory.pdf",
            mimeType: "application/pdf",
            pageCount: 9,
            title: "Home Memory",
            status: "indexed",
            errorMessage: null,
            updatedAt: new Date().toISOString(),
          },
          {
            id: `doc-home-pending-${seed}`,
            fileName: "home-pending.pdf",
            mimeType: "application/pdf",
            pageCount: 0,
            title: null,
            status: "indexing",
            errorMessage: null,
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    });
  });
  await page.route("**/api/documents/upload", async (route) => {
    uploadRequests += 1;
    await route.fulfill({ status: 500, body: "Unexpected upload" });
  });
  await page.route("**/api/documents/**/index", async (route) => {
    indexRequests += 1;
    await route.fulfill({ status: 500, body: "Unexpected index" });
  });
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects: [] }),
      });
      return;
    }

    await route.fallback();
  });
  await page.route("**/api/projects/**/sync", async (route) => {
    syncPayload = route.request().postDataJSON();
    const payload = syncPayload as { project: Project };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ project: payload.project }),
    });
  });

  await page.goto("/");
  await page.getByTestId("add-message-attachment-button").click();
  await expect(page.getByTestId("attachment-menu")).toBeVisible();
  await page.getByTestId("knowledge-menu-button").hover();
  await expect(page.getByTestId("knowledge-document-option")).toHaveCount(1);
  await expect(page.getByTestId("knowledge-document-menu")).not.toContainText(
    "home-pending.pdf",
  );
  await page
    .getByTestId("knowledge-document-option")
    .filter({ hasText: "Home Memory" })
    .click();
  await expect(page.getByTestId("pending-attachment-chip")).toContainText(
    "home-memory.pdf",
  );

  await page.getByTestId("message-instruction-input").fill(instruction);
  await page.getByTestId("send-message-button").click();

  await expect.poll(() => syncPayload).not.toBeNull();
  const payload = syncPayload as { project: Project };
  const rootNode = payload.project.nodes[payload.project.rootNodeId];
  expect(rootNode.messages[0].content).toBe(instruction);
  expect(rootNode.messages[0].attachments).toEqual([
    expect.objectContaining({
      name: "home-memory.pdf",
      mimeType: "application/pdf",
      size: 0,
      documentId,
      documentStatus: "indexed",
    }),
  ]);
  expect(uploadRequests).toBe(0);
  expect(indexRequests).toBe(0);
});

test("shows compact account entry on desktop and responsive mobile navigation", async ({ page }) => {
  await mockAuthSession(page, { configured: true, user: null });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("auth-email-input")).toHaveCount(0);
  const desktopSignIn = page.locator('[data-testid="account-sign-in-button"]:visible').first();
  await expect(desktopSignIn).toBeVisible();
  await expect(desktopSignIn).toHaveAttribute("href", /\/auth\/sign-in/);
  await desktopSignIn.click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.locator('[data-testid="auth-email-input"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid="auth-password-input"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid="google-sign-in-button"]:visible')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/privacy");
  await page.locator("summary").filter({ hasText: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Compliance navigation mobile" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Projects/ })).toBeVisible();
});

test("reader header home button returns to the home workspace", async ({ page }) => {
  await page.route("**/api/documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [] }),
    });
  });
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ projects: [] }),
    });
  });
  await mockHomeModelCatalog(page);

  await page.goto("/reader");

  const homeButton = page.getByTestId("reader-home-button");
  await expect(homeButton).toBeVisible();
  await expect(homeButton).toHaveAttribute("href", "/");

  await homeButton.click();
  await expect(page).toHaveURL("/");
});

test("places PDF rename and delete actions on document rows", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "PDF reader row actions are covered once.");

  const timestamp = new Date().toISOString();
  const pdfBytes = createSyntheticPdf([["Reader Row Actions", "Page one"]]);
  const makeDocument = (id: string, title: string, fileName: string) => ({
    id,
    fileName,
    mimeType: "application/pdf",
    pageCount: 1,
    title,
    status: "parsed",
    errorMessage: null,
    errorCode: null,
    errorStage: null,
    errorRequestId: null,
    updatedAt: timestamp,
  });
  let documents = [
    makeDocument("doc-row-actions-one", "First Paper", "first-paper.pdf"),
    makeDocument("doc-row-actions-two", "Second Paper", "second-paper.pdf"),
    makeDocument("doc-row-actions-three", "Third Paper", "third-paper.pdf"),
  ];
  const deletedIds: string[] = [];
  const confirmedMessages: string[] = [];

  page.on("dialog", async (dialog) => {
    confirmedMessages.push(dialog.message());
    await dialog.accept();
  });

  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, body: "Method not allowed" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents }),
    });
  });
  await page.route(/\/api\/documents\/doc-row-actions-[^/]+\/file$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from(pdfBytes),
    });
  });
  await page.route(
    /\/api\/documents\/doc-row-actions-[^/]+\/pages\/1$/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          page: {
            pageNumber: 1,
            cleanText: "Reader row actions extracted text.",
            tokenCount: 5,
          },
        }),
      });
    },
  );
  await page.route(/\/api\/documents\/doc-row-actions-[^/]+$/, async (route) => {
    const request = route.request();
    const documentId = new URL(request.url()).pathname.split("/").pop();
    const document = documents.find((item) => item.id === documentId);

    if (!document) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Document not found." }),
      });
      return;
    }

    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          document,
          sections: [
            {
              id: `${document.id}-section`,
              title: document.title,
              headingPath: [document.title],
              level: 1,
              pageStart: 1,
              pageEnd: 1,
              source: "regex",
            },
          ],
          chunkCount: 0,
        }),
      });
      return;
    }

    if (request.method() === "PATCH") {
      const payload = request.postDataJSON() as { name?: string };
      documents = documents.map((item) =>
        item.id === document.id
          ? { ...item, title: payload.name ?? item.title, updatedAt: new Date().toISOString() }
          : item,
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          document: documents.find((item) => item.id === document.id),
        }),
      });
      return;
    }

    if (request.method() === "DELETE") {
      deletedIds.push(document.id);
      documents = documents.filter((item) => item.id !== document.id);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ documents }),
      });
      return;
    }

    await route.fulfill({ status: 405, body: "Method not allowed" });
  });

  await page.setViewportSize({ width: 1210, height: 768 });
  await page.goto("/reader?document=doc-row-actions-one&page=1");

  const sidebar = page.getByTestId("pdf-documents-sidebar");
  const firstRow = sidebar.locator(
    '[data-testid="pdf-document-row"][data-document-id="doc-row-actions-one"]',
  );
  const secondRow = sidebar.locator(
    '[data-testid="pdf-document-row"][data-document-id="doc-row-actions-two"]',
  );
  const thirdRow = sidebar.locator(
    '[data-testid="pdf-document-row"][data-document-id="doc-row-actions-three"]',
  );

  await expect(firstRow).toContainText("First Paper");
  await expect(sidebar.getByLabel("Rename selected PDF")).toHaveCount(0);
  await expect(sidebar.getByLabel("Delete selected PDF")).toHaveCount(0);

  await firstRow.hover();
  await firstRow.getByTestId("rename-pdf-button").click();
  await expect(firstRow.getByRole("textbox", { name: "PDF name" })).toHaveValue(
    "First Paper",
  );
  await expect(secondRow.getByRole("textbox", { name: "PDF name" })).toHaveCount(0);
  await expect(page).toHaveURL(/document=doc-row-actions-one/);
  await firstRow.getByLabel("Cancel rename").click();

  await secondRow.hover();
  await secondRow.getByTestId("delete-pdf-button").click();
  await expect.poll(() => deletedIds).toEqual(["doc-row-actions-two"]);
  await expect(page).toHaveURL(/document=doc-row-actions-one/);
  await expect(secondRow).toHaveCount(0);
  await expect(firstRow).toContainText("First Paper");

  await firstRow.hover();
  await firstRow.getByTestId("delete-pdf-button").click();
  await expect
    .poll(() => deletedIds)
    .toEqual(["doc-row-actions-two", "doc-row-actions-one"]);
  await expect(page).toHaveURL(/document=doc-row-actions-three/);
  await expect(thirdRow).toContainText("Third Paper");
  expect(confirmedMessages.join("\n")).toContain("Second Paper");
  expect(confirmedMessages.join("\n")).toContain("First Paper");
});

test("reader opens an owned PDF at a source chunk URL", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "PDF reader rendering is covered once.");

  const document = {
    id: "doc-reader-e2e",
    fileName: "reader-source.pdf",
    mimeType: "application/pdf",
    pageCount: 2,
    title: "Reader Source",
    status: "indexed",
    errorMessage: null,
    errorCode: null,
    errorStage: null,
    errorRequestId: null,
    updatedAt: new Date().toISOString(),
  };
  const chunks = [
    {
      id: "chunk-reader-e2e",
      chunkIndex: 0,
      pageStart: 2,
      pageEnd: 2,
      headingPath: ["Chapter 2", "Evidence"],
      tokenCount: 12,
      content: "Evidence chunk from page two for source verification.",
      metadata: {},
    },
  ];
  const pdfBytes = createSyntheticPdf([
    ["Reader Source", "Page one"],
    ["Reader Source", "Page two"],
  ]);
  let queryPayload: unknown = null;
  let documentDetailsRequests = 0;

  await page.route("**/api/documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [document] }),
    });
  });
  await page.route("**/api/documents/doc-reader-e2e", async (route) => {
    documentDetailsRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document,
        sections: [
          {
            id: "section-reader-e2e-1",
            title: "Chapter 1",
            headingPath: ["Chapter 1"],
            level: 1,
            pageStart: 1,
            pageEnd: 1,
            source: "regex",
          },
          {
            id: "section-reader-e2e-2",
            title: "Chapter 2",
            headingPath: ["Chapter 2"],
            level: 1,
            pageStart: 2,
            pageEnd: 2,
            source: "regex",
          },
          {
            id: "section-reader-e2e-2-evidence",
            title: "Evidence",
            headingPath: ["Chapter 2", "Evidence"],
            level: 2,
            pageStart: 2,
            pageEnd: 2,
            source: "regex",
          },
          ...Array.from({ length: 18 }, (_, index) => ({
            id: `section-reader-e2e-extra-${index + 1}`,
            title: `Appendix ${index + 1}`,
            headingPath: [`Appendix ${index + 1}`],
            level: 1,
            pageStart: 3,
            pageEnd: 3,
            source: "regex",
          })),
        ],
        chunkCount: chunks.length,
      }),
    });
  });
  await page.route("**/api/documents/doc-reader-e2e/chunks", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chunks }),
    });
  });
  await page.route("**/api/documents/doc-reader-e2e/pages/1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        page: {
          pageNumber: 1,
          cleanText: "Page one extracted text.",
          tokenCount: 4,
        },
      }),
    });
  });
  await page.route("**/api/documents/doc-reader-e2e/pages/2", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        page: {
          pageNumber: 2,
          cleanText: "Page two extracted text.",
          tokenCount: 4,
        },
      }),
    });
  });
  await page.route("**/api/documents/doc-reader-e2e/file", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from(pdfBytes),
    });
  });
  await page.route("**/api/documents/doc-reader-e2e/query", async (route) => {
    queryPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answer: "The evidence is on page two.",
        citations: [
          {
            pageStart: 2,
            pageEnd: 2,
            chunkId: "chunk-reader-e2e",
            headingPath: ["Chapter 2", "Evidence"],
            quote: "Evidence chunk from page two for source verification.",
          },
        ],
        retrievedChunks: [
          {
            chunkId: "chunk-reader-e2e",
            score: 0.91,
            pageStart: 2,
            pageEnd: 2,
            headingPath: ["Chapter 2", "Evidence"],
            preview: "Evidence chunk from page two for source verification.",
          },
        ],
      }),
    });
  });

  await page.setViewportSize({ width: 1210, height: 768 });
  await page.goto("/reader?document=doc-reader-e2e&page=2&chunk=chunk-reader-e2e");

  const canvas = page.getByTestId("pdf-page-canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("source-evidence")).toContainText(
    "Evidence chunk from page two",
  );
  await expect(page.getByLabel("Page number")).toHaveValue("2");
  expect(documentDetailsRequests).toBe(1);

  const readerBox = await getElementBox(page.getByTestId("pdf-reader"), "PDF reader");
  const documentsSidebarBox = await getElementBox(
    page.getByTestId("pdf-documents-sidebar"),
    "PDF documents sidebar",
  );
  const toolsSidebarBox = await getElementBox(
    page.getByTestId("pdf-tools-sidebar"),
    "PDF tools sidebar",
  );
  const documentsHandleBox = await getElementBox(
    page.getByTestId("resize-pdf-documents-sidebar"),
    "PDF documents resize handle",
  );
  const toolsHandleBox = await getElementBox(
    page.getByTestId("resize-pdf-tools-sidebar"),
    "PDF tools resize handle",
  );
  const tocSectionBox = await getElementBox(
    page.getByTestId("pdf-toc-section"),
    "PDF TOC section",
  );
  const askSectionBox = await getElementBox(
    page.getByTestId("pdf-ask-section"),
    "Ask PDF section",
  );

  expect(documentsSidebarBox.height).toBeLessThan(readerBox.height * 0.65);
  expect(toolsSidebarBox.height).toBeLessThan(readerBox.height * 0.95);
  expect(documentsHandleBox.height).toBeGreaterThan(96);
  expect(documentsHandleBox.height).toBeLessThan(readerBox.height * 0.35);
  expect(toolsHandleBox.height).toBeGreaterThan(96);
  expect(toolsHandleBox.height).toBeLessThan(readerBox.height * 0.35);
  expect(Math.abs(tocSectionBox.y + tocSectionBox.height - askSectionBox.y)).toBeLessThanOrEqual(
    1,
  );
  await expect
    .poll(() =>
      page
        .getByTestId("pdf-toc-list")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);

  const chapter2Toggle = page.locator(
    '[data-testid="toc-section-toggle"][data-section-id="section-reader-e2e-2"]',
  );
  const evidenceButton = page.locator(
    '[data-testid="toc-section-button"][data-section-id="section-reader-e2e-2-evidence"]',
  );
  await expect(chapter2Toggle).toHaveAttribute("aria-expanded", "true");
  await expect(evidenceButton).toBeVisible();
  await expect(evidenceButton).toHaveAttribute("aria-current", "location");

  await chapter2Toggle.click();
  await expect(chapter2Toggle).toHaveAttribute("aria-expanded", "false");
  await expect(evidenceButton).toHaveCount(0);
  await chapter2Toggle.click();
  await expect(evidenceButton).toBeVisible();
  await evidenceButton.click();
  await expect(page).toHaveURL(/document=doc-reader-e2e.*page=2/);
  await expect(page).not.toHaveURL(/chunk=chunk-reader-e2e/);
  await expect(page.getByLabel("Page number")).toHaveValue("2");

  await page.getByTestId("toc-section-button").filter({ hasText: "Chapter 1" }).click();
  await expect(page).toHaveURL(/document=doc-reader-e2e.*page=1/);
  await expect(page).not.toHaveURL(/chunk=chunk-reader-e2e/);
  await expect(page.getByLabel("Page number")).toHaveValue("1");
  expect(documentDetailsRequests).toBe(1);

  await page.getByTestId("ask-pdf-input").fill("Where is the evidence?");
  await page.getByTestId("ask-pdf-button").click();
  await expect.poll(() => queryPayload).not.toBeNull();
  expect(queryPayload).toMatchObject({ question: "Where is the evidence?" });
  await expect(page.getByTestId("ask-pdf-answer")).toContainText(
    "The evidence is on page two.",
  );
  await page.getByTestId("ask-pdf-citation").click();
  await expect(page).toHaveURL(/document=doc-reader-e2e.*page=2.*chunk=chunk-reader-e2e/);
  await expect(page.getByTestId("source-evidence")).toContainText(
    "Evidence chunk from page two",
  );
  expect(documentDetailsRequests).toBe(1);
});

test("reader upload parses for reading before explicit Ask PDF indexing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Reader upload flow is covered once.");

  const documentId = "doc-reader-upload-e2e";
  let document: {
    id: string;
    fileName: string;
    mimeType: string;
    pageCount: number;
    title: string | null;
    status: string;
    errorMessage: string | null;
    errorCode: string | null;
    errorStage: string | null;
    errorRequestId: string | null;
    updatedAt: string;
  } = {
    id: documentId,
    fileName: "reader-upload.pdf",
    mimeType: "application/pdf",
    pageCount: 0,
    title: null,
    status: "uploaded",
    errorMessage: null,
    errorCode: null,
    errorStage: null,
    errorRequestId: null,
    updatedAt: new Date().toISOString(),
  };
  let sections: unknown[] = [];
  let uploadRequests = 0;
  let parseRequests = 0;
  let indexRequests = 0;
  const pdfBytes = createSyntheticPdf([
    ["Reader Upload", "Page one has selectable text."],
    ["Reader Upload", "Page two has more selectable text."],
  ]);

  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documents: uploadRequests > 0 ? [document] : [],
      }),
    });
  });
  await page.route("**/api/documents/upload", async (route) => {
    uploadRequests += 1;
    document = { ...document, status: "uploaded" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ document }),
    });
  });
  await page.route("**/api/documents/doc-reader-upload-e2e", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ document, sections, chunkCount: 0 }),
    });
  });
  await page.route("**/api/documents/doc-reader-upload-e2e/parse", async (route) => {
    parseRequests += 1;
    document = {
      ...document,
      pageCount: 2,
      title: "Reader Upload",
      status: "parsed",
    };
    sections = [
      {
        id: "section-reader-upload-e2e",
        title: "Reader Upload",
        headingPath: ["Reader Upload"],
        level: 1,
        pageStart: 1,
        pageEnd: 2,
        source: "regex",
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ document, pageCount: 2, sectionCount: 1 }),
    });
  });
  await page.route("**/api/documents/doc-reader-upload-e2e/index", async (route) => {
    indexRequests += 1;
    document = { ...document, status: "indexed" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document,
        pageCount: 2,
        sectionCount: 1,
        chunkCount: 1,
        embeddingModel: "mock-embedding-v1",
      }),
    });
  });
  await page.route("**/api/documents/doc-reader-upload-e2e/pages/1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        page: {
          pageNumber: 1,
          cleanText: "Reader Upload page one extracted text.",
          tokenCount: 6,
        },
      }),
    });
  });
  await page.route("**/api/documents/doc-reader-upload-e2e/file", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from(pdfBytes),
    });
  });

  await page.goto("/reader");
  await page.locator("#pdf-upload").setInputFiles({
    name: "reader-upload.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes),
  });
  await page.getByRole("button", { name: "Upload PDF", exact: true }).click();

  await expect.poll(() => parseRequests).toBe(1);
  expect(indexRequests).toBe(0);
  const canvas = page.getByTestId("pdf-page-canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("toc-section-button")).toContainText("Reader Upload");
  await expect(page.getByTestId("ask-pdf-input")).toBeDisabled();
  await expect(page.getByTestId("ask-pdf-button")).toBeDisabled();

  await page.getByTestId("enable-ask-pdf-button").click();
  await expect.poll(() => indexRequests).toBe(1);
  await expect(page.getByTestId("ask-pdf-input")).toBeEnabled();
});

test("shows signed-in account menu state", async ({ page }) => {
  await mockAuthSession(page, {
    configured: true,
    user: { id: "user_e2e_auth", email: "learner@example.com" },
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects");
  const accountButton = page.locator('[data-testid="account-menu-button"]:visible').first();
  await expect(accountButton).toContainText("learner@example.com");
  await accountButton.click();
  await expect(page.locator('[data-testid="account-menu-popover"]:visible')).toContainText(
    "learner@example.com",
  );
  await expect(page.locator('[data-testid="sign-out-button"]:visible')).toBeVisible();
});

test("renames and confirms project deletion without opening the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const sourceProject = makeWorkspaceProject(`delete-confirm-${makeSeed()}`);
  const editedTitle = "Project list renamed workspace";
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto("/projects");
    const projectCard = page.locator(
      `[data-testid="project-card"][data-project-id="${project.id}"]`,
    );
    const editButton = projectCard.getByTestId("edit-project-name-button");
    const deleteButton = projectCard.getByTestId("delete-project-button");

    await expect(projectCard).toBeVisible();
    await editButton.click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(projectCard.getByTestId("project-name-edit-input")).toHaveValue(
      project.title,
    );
    await projectCard.getByTestId("project-name-edit-input").fill("Canceled rename");
    await projectCard.getByTestId("cancel-project-name-button").click();
    await expect(projectCard.getByTestId("project-name-edit-input")).toHaveCount(0);
    await expect(projectCard).toContainText(project.title);

    await editButton.click();
    await projectCard.getByTestId("project-name-edit-input").fill(editedTitle);
    await projectCard.getByTestId("save-project-name-button").click();
    await expect(projectCard.getByTestId("project-name-edit-input")).toHaveCount(0);
    await expect(projectCard).toContainText(editedTitle);
    await expect(page).toHaveURL(/\/projects$/);

    const persisted = await getPersistedProject(page, project.id);
    expect(persisted.title).toBe(editedTitle);
    expect(persisted.nodes[persisted.rootNodeId]).toMatchObject({
      title: "Seeded root node",
      titleManuallyEdited: false,
    });

    await deleteButton.click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("delete-project-dialog")).toBeVisible();
    await expect(page.getByTestId("delete-project-dialog")).toContainText(
      editedTitle,
    );

    await page.getByTestId("cancel-delete-project-button").click();
    await expect(page.getByTestId("delete-project-dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/projects$/);
    await expect(projectCard).toBeVisible();

    await deleteButton.click();
    await expect(page.getByTestId("delete-project-dialog")).toBeVisible();
    await page.getByTestId("confirm-delete-project-button").click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("delete-project-dialog")).toHaveCount(0);
    await expect(projectCard).toHaveCount(0);
    projectIdToDelete = null;
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("places the workspace account entry in the sidebar footer", async ({ page }) => {
  await mockAuthSession(page, { configured: true, user: null });
  await page.setViewportSize({ width: 1280, height: 800 });
  const sourceProject = makeWorkspaceProject(`account-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await expect(page.getByTestId("workspace-navigation")).not.toContainText("Sign in");
    await expect(page.getByTestId("workspace-sidebar-footer")).toBeVisible();
    await expect(
      page.getByTestId("workspace-sidebar-footer").getByTestId("account-sign-in-button"),
    ).toBeVisible();
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("loads a seeded workspace with stable test ids", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
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
    await expect(page.getByTestId("chat-model-selector-button")).toBeVisible();
    await expect(page.getByTestId("add-message-attachment-button")).toBeVisible();
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

test("edits a root node title from the node detail header", async ({ page }) => {
  const sourceProject = makeWorkspaceProject(`title-edit-${makeSeed()}`);
  const editedTitle = "Manual root title from detail";
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("edit-node-title-button").click();
    await expect(page.getByTestId("node-title-edit-input")).toHaveValue("Seeded root node");
    await page.getByTestId("node-title-edit-input").fill(editedTitle);
    await page.getByTestId("save-node-title-edit-button").click();

    await expect(page.getByTestId("node-title-edit-input")).toHaveCount(0);
    await expect(page.getByTestId("workspace-header")).toContainText(editedTitle);
    await expect(page.getByTestId("node-detail-panel")).toContainText(editedTitle);
    await expect(page.getByTestId("branch-node-card")).toContainText(editedTitle);
    await expect(page.getByTestId("conversation-outline")).toContainText(editedTitle);

    const response = await page.request.get("/api/projects");
    expect(response.status(), await response.text()).toBe(200);
    const data = await response.json();
    const projects = Array.isArray(data.projects) ? (data.projects as WorkspaceProject[]) : [];
    const persisted = projects.find((item) => item.id === project.id);
    expect(persisted?.title).toBe(editedTitle);
    expect(persisted?.nodes[persisted.rootNodeId]).toMatchObject({
      title: editedTitle,
      titleManuallyEdited: true,
    });
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("renames a project from the workspace header", async ({ page }) => {
  const sourceProject = makeWorkspaceProject(`project-title-edit-${makeSeed()}`);
  const editedTitle = "Workspace title from header";
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("edit-project-title-button").click();
    await expect(page.getByTestId("project-title-edit-input")).toHaveValue(project.title);
    await page.getByTestId("project-title-edit-input").fill(editedTitle);
    await page.getByTestId("save-project-title-button").click();

    await expect(page.getByTestId("project-title-edit-input")).toHaveCount(0);
    await expect(page.getByTestId("workspace-header")).toContainText(editedTitle);
    await expect(page.getByTestId("node-detail-panel")).toContainText("Seeded root node");

    const persisted = await getPersistedProject(page, project.id);
    expect(persisted.title).toBe(editedTitle);
    expect(persisted.nodes[persisted.rootNodeId]).toMatchObject({
      title: "Seeded root node",
      titleManuallyEdited: false,
    });
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("splits node edge drag from inner open actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Node hit areas are covered once.");

  await page.setViewportSize({ width: 1280, height: 800 });
  const sourceProject = makeWorkspaceTreeProject(`hit-area-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  const getCard = (nodeId: string) =>
    page.locator(`[data-testid="branch-node-card"][data-node-id="${nodeId}"]`);
  const dragFromPoint = async (
    startX: number,
    startY: number,
    deltaX: number,
    deltaY: number,
  ) => {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
    await page.mouse.up();
  };

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;
    const positionPatches: Array<{ nodeId: string; position: { x: number; y: number } }> = [];
    await page.route(`**/api/projects/${project.id}/nodes/*`, async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        const payload = request.postDataJSON() as { position?: { x: number; y: number } };
        if (payload.position) {
          positionPatches.push({
            nodeId: new URL(request.url()).pathname.split("/").pop() ?? "",
            position: payload.position,
          });
        }
      }

      await route.continue();
    });

    const root = project.nodes[project.rootNodeId];
    const tools = getNodeByTitle(project, "Programming Tools");

    await page.goto(`/workspace/${project.id}`);
    await expect(page.getByTestId("branch-node-card")).toHaveCount(4);

    const rootCard = getCard(root.id);
    const toolsCard = getCard(tools.id);

    await toolsCard.getByTestId("open-node-button").click();
    await expect(toolsCard).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("node-detail-panel")).toContainText("Programming Tools");

    await rootCard.getByTestId("open-node-button").click();
    await expect(rootCard).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("node-detail-panel")).toContainText("Machine Learning Map");

    await toolsCard.getByTestId("open-node-button").click();
    await expect(toolsCard).toHaveAttribute("data-selected", "true");
    const positionBeforeToggle = (await getPersistedProject(page, project.id)).nodes[root.id]
      .position;

    await rootCard.getByTestId("toggle-children-button").click();
    await expect(rootCard).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("node-detail-panel")).toContainText("Machine Learning Map");
    await expect(page.getByTestId("branch-node-card")).toHaveCount(1);
    expect((await getPersistedProject(page, project.id)).nodes[root.id].position).toEqual(
      positionBeforeToggle,
    );
    expect(positionPatches).toEqual([]);

    const openButtonBoxBefore = await getElementBox(
      rootCard.getByTestId("open-node-button"),
      "root open node button",
    );
    const rootBoxBeforeInnerDrag = await getElementBox(rootCard, "root card before inner drag");
    await dragFromPoint(
      openButtonBoxBefore.x + openButtonBoxBefore.width / 2,
      openButtonBoxBefore.y + openButtonBoxBefore.height / 2,
      90,
      50,
    );
    const rootBoxAfterInnerDrag = await getElementBox(rootCard, "root card after inner drag");
    expect(Math.abs(rootBoxAfterInnerDrag.x - rootBoxBeforeInnerDrag.x)).toBeLessThan(2);
    expect(Math.abs(rootBoxAfterInnerDrag.y - rootBoxBeforeInnerDrag.y)).toBeLessThan(2);
    expect((await getPersistedProject(page, project.id)).nodes[root.id].position).toEqual(
      positionBeforeToggle,
    );
    expect(positionPatches).toEqual([]);

    const rootBoxBeforeHandleDrag = await getElementBox(rootCard, "root card before handle drag");
    const sourceHandleBox = await getElementBox(
      rootCard.locator('[data-handleid="branch-source"]'),
      "root branch source handle",
    );
    await dragFromPoint(
      sourceHandleBox.x + sourceHandleBox.width / 2,
      sourceHandleBox.y + sourceHandleBox.height / 2,
      90,
      0,
    );
    const rootBoxAfterHandleDrag = await getElementBox(rootCard, "root card after handle drag");
    expect(Math.abs(rootBoxAfterHandleDrag.x - rootBoxBeforeHandleDrag.x)).toBeLessThan(2);
    expect(Math.abs(rootBoxAfterHandleDrag.y - rootBoxBeforeHandleDrag.y)).toBeLessThan(2);
    expect(positionPatches).toEqual([]);

    const positionBeforeEdgeDrag = (await getPersistedProject(page, project.id)).nodes[root.id]
      .position;
    const rootBoxBeforeEdgeDrag = await getElementBox(rootCard, "root card before edge drag");
    await dragFromPoint(
      rootBoxBeforeEdgeDrag.x + 8,
      rootBoxBeforeEdgeDrag.y + 24,
      90,
      50,
    );

    await expect
      .poll(async () => (await getPersistedProject(page, project.id)).nodes[root.id].position.x)
      .toBeGreaterThan(positionBeforeEdgeDrag.x + 20);
    expect(positionPatches).toHaveLength(1);
    expect(positionPatches[0].nodeId).toBe(root.id);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("workspace sidebars resize and snap like VS Code", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop sidebar resizing is covered once.");

  const sourceProject = makeWorkspaceProject(`sidebars-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/workspace/${project.id}`);

    const mindMapCanvas = page.getByTestId("mind-map-canvas");
    const workspaceSidebar = page.getByTestId("workspace-sidebar");
    const nodeDetailPanel = page.getByTestId("node-detail-panel");

    await expect(workspaceSidebar).toBeVisible();
    await expect(nodeDetailPanel).toBeVisible();

    await dragResizeHandle(page, page.getByTestId("resize-workspace-sidebar"), 430);
    await expect.poll(() => getElementWidth(workspaceSidebar)).toBeGreaterThan(560);
    await expect.poll(() => getElementWidth(mindMapCanvas)).toBeGreaterThan(219);
    await expectNoHorizontalOverflow(page);

    const wideSidebarWidth = await getElementWidth(workspaceSidebar);
    await dragResizeHandle(
      page,
      page.getByTestId("resize-workspace-sidebar"),
      -(wideSidebarWidth + 120),
    );
    await expect(workspaceSidebar).toHaveCount(0);
    await expect(mindMapCanvas.getByTestId("expand-workspace-sidebar-button")).toBeVisible();

    await mindMapCanvas.getByTestId("expand-workspace-sidebar-button").click();
    await expect(workspaceSidebar).toBeVisible();
    await expect.poll(() => getElementWidth(workspaceSidebar)).toBeGreaterThan(560);

    const detailWidthBeforeSnap = await getElementWidth(nodeDetailPanel);
    await dragResizeHandle(
      page,
      page.getByTestId("resize-node-details-panel"),
      detailWidthBeforeSnap + 120,
    );
    await expect(nodeDetailPanel).toHaveCount(0);
    await expect(mindMapCanvas.getByTestId("expand-node-detail-panel-button")).toBeVisible();

    await mindMapCanvas.getByTestId("expand-node-detail-panel-button").click();
    await expect(nodeDetailPanel).toBeVisible();
    await expect.poll(() => getElementWidth(nodeDetailPanel)).toBeGreaterThanOrEqual(300);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId("node-detail-notes-button").click();
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await expect(page.getByTestId("resize-project-notes-panel")).toBeVisible();

    await dragResizeHandle(page, page.getByTestId("resize-workspace-sidebar"), 900);
    await dragResizeHandle(page, page.getByTestId("resize-node-details-panel"), -900);
    await expect.poll(() => getElementWidth(mindMapCanvas)).toBeGreaterThan(219);
    await expectNoHorizontalOverflow(page);
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

    const notesEditor = page.getByTestId("project-notes-input");
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await expect(page.getByTestId("project-notes-preview-button")).toHaveCount(0);
    await expect(page.getByTestId("project-notes-preview")).toHaveCount(0);
    await page.getByTestId("add-latest-ai-reply-note-button").click();

    await expect(
      notesEditor.getByRole("heading", { level: 2, name: "Seeded root node" }),
    ).toBeVisible();
    await expect(
      notesEditor.getByRole("heading", { level: 2, name: "Workspace ready" }),
    ).toBeVisible();
    await expect(notesEditor.locator("strong").filter({ hasText: "ready" })).toBeVisible();
    await expect(notesEditor.locator("li")).toHaveCount(2);
    await expect(page.getByTestId("project-notes-save-status")).toContainText("Saved", {
      timeout: 5_000,
    });

    await notesEditor.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("# Quick heading");
    await expect(notesEditor.getByRole("heading", { level: 1, name: "Quick heading" }))
      .toBeVisible();

    await page.keyboard.press("Enter");
    await page.keyboard.type("[] Task item");
    await expect(notesEditor.getByRole("checkbox", { name: /Task item/ })).toBeVisible();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("**bold**");
    await expect(notesEditor.locator("strong").filter({ hasText: "bold" })).toBeVisible();
    await expect(page.getByTestId("conversation-message-content")).toHaveCount(2);

    await page.keyboard.press("Enter");
    await page.keyboard.type(manualNote);
    await expect(page.getByTestId("project-notes-save-status")).toContainText("Saved", {
      timeout: 5_000,
    });

    await page.reload();
    await page.getByTestId("node-detail-notes-button").click();
    const reloadedNotesEditor = page.getByTestId("project-notes-input");
    await expect(reloadedNotesEditor.getByText(manualNote)).toBeVisible();
    await expect(
      reloadedNotesEditor.getByRole("heading", { level: 1, name: "Quick heading" }),
    ).toBeVisible();
    await expect(reloadedNotesEditor.locator("strong").filter({ hasText: "bold" }))
      .toBeVisible();
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("shows a slash block menu in project notes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Project notes slash menu is covered once.");

  const sourceProject = makeWorkspaceProject(`notes-slash-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("node-detail-notes-button").click();

    const notesEditor = page.getByTestId("project-notes-input");
    const slashMenu = page.getByTestId("project-notes-slash-menu");
    const slashMenuList = page.getByTestId("project-notes-slash-menu-list");

    await notesEditor.click();
    await page.keyboard.type("Inline slash /path");
    await expect(slashMenu).toHaveCount(0);

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(slashMenu).toBeVisible();
    await expect(slashMenuList).toBeVisible();
    let keyboardScrollTop = 0;
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press("ArrowDown");
      keyboardScrollTop = await slashMenuList.evaluate(
        (element) => (element as HTMLElement).scrollTop,
      );
      if (keyboardScrollTop > 0) break;
    }
    expect(keyboardScrollTop).toBeGreaterThan(0);
    await expect(slashMenuList.locator('[role="option"][aria-selected="true"]'))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(slashMenu).toHaveCount(0);

    await page.keyboard.press("Backspace");
    await page.keyboard.type("/h1");
    await expect(page.getByTestId("project-notes-slash-menu-item-heading-1")).toBeVisible();
    await page.getByTestId("project-notes-slash-menu-item-heading-1").click();
    await page.keyboard.type("Slash Heading");
    await expect(
      notesEditor.getByRole("heading", { level: 1, name: "Slash Heading" }),
    ).toBeVisible();
    await expect(notesEditor).not.toContainText("/h1");

    await page.keyboard.press("Enter");
    await page.keyboard.type("/todo");
    await expect(page.getByTestId("project-notes-slash-menu-item-todo-list")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Slash task");
    await expect(notesEditor.getByRole("checkbox", { name: /Slash task/ })).toBeVisible();
    await expect(notesEditor).not.toContainText("/todo");

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/math");
    await expect(page.getByTestId("project-notes-slash-menu-item-math-equation"))
      .toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("project-notes-math-popover")).toBeVisible();
    await page.getByTestId("project-notes-math-input").fill("E = mc^2");
    await page.getByTestId("project-notes-math-submit").click();
    const mathFormula = notesEditor.locator(
      '[data-type="block-math"][data-latex="E = mc^2"]',
    );
    await expect(mathFormula.locator(".katex")).toBeVisible();
    await expect(notesEditor).not.toContainText("/math");
    await expect(page.getByTestId("project-notes-save-status")).toContainText("Saved", {
      timeout: 5_000,
    });

    await page.reload();
    await page.getByTestId("node-detail-notes-button").click();
    const reloadedNotesEditor = page.getByTestId("project-notes-input");
    await expect(
      reloadedNotesEditor.locator('[data-type="block-math"][data-latex="E = mc^2"] .katex'),
    ).toBeVisible();
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
    await expect(page.getByTestId("node-detail-panel")).toBeVisible();
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await expect(page.getByTestId("project-notes-drawer-backdrop")).toHaveCount(0);

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
    await expect(page.getByTestId("node-detail-panel")).toBeVisible();
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

test("shows chat and notes side by side on compact desktop", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Compact desktop notes layout is covered once.");

  const sourceProject = makeWorkspaceProject(`notes-compact-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 1180, height: 800 });
    await page.goto(`/workspace/${project.id}`);

    const notesButton = page.getByTestId("node-detail-notes-button");
    await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
    await notesButton.click();

    const mindMapCanvas = page.getByTestId("mind-map-canvas");
    const nodeDetailPanel = page.getByTestId("node-detail-panel");
    const notesPanel = page.getByTestId("project-notes-panel");
    const notesWindow = page.getByTestId("project-notes-window");

    await expect(notesButton).toHaveAttribute("aria-expanded", "true");
    await expect(nodeDetailPanel).toBeVisible();
    await expect(notesPanel).toBeVisible();
    await expect(page.getByTestId("workspace-sidebar")).toHaveCount(0);
    await expect(mindMapCanvas.getByTestId("expand-workspace-sidebar-button")).toBeVisible();
    await expect(page.getByTestId("resize-project-notes-panel")).toBeVisible();
    await expect(page.getByTestId("project-notes-drawer-backdrop")).toHaveCount(0);

    const chatBox = await getElementBox(nodeDetailPanel, "node detail panel");
    const notesBox = await getElementBox(notesWindow, "project notes window");
    expect(notesBox.x).toBeGreaterThanOrEqual(chatBox.x + chatBox.width - 1);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId("close-project-notes-button").click();
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);
    await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
    await expect(notesButton).toHaveAttribute("aria-expanded", "false");
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("keeps failed project notes saves out of the node composer", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop notes errors are covered once.");

  const sourceProject = makeWorkspaceProject(`notes-failure-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.route(`**/api/projects/${project.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "NOTES_SAVE_FAILED",
              message: "Request failed.",
              requestId: "e2e_notes_failure",
            },
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("node-detail-notes-button").click();

    const notesEditor = page.getByTestId("project-notes-input");
    await notesEditor.click();
    await page.keyboard.type("This note will fail to save.");

    await expect(page.getByTestId("project-notes-save-status")).toContainText(
      "Save failed",
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("project-notes-error-alert")).toContainText(
      "Notes could not be saved.",
    );

    await page.getByTestId("close-project-notes-button").click();
    await expect(page.getByTestId("project-notes-panel")).toHaveCount(0);
    await expect(page.getByTestId("message-error-alert")).toHaveCount(0);
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
    await page.getByTestId("workspace-mobile-view-chat").click();
    await expect(page.getByTestId("node-detail-notes-button")).toBeVisible();
    await page.getByTestId("node-detail-notes-button").click();

    await expect(page.getByTestId("project-notes-window")).toBeVisible();
    await expect(page.getByTestId("project-notes-panel")).toBeVisible();
    await expect(page.getByTestId("project-notes-drawer-backdrop")).toHaveCount(0);
    await expect(page.getByTestId("resize-project-notes-panel")).toBeHidden();
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await page.getByTestId("close-project-notes-button").click();
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

test("keeps long conversation content inside the node detail scroll area", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Conversation scrolling is covered once.");

  const sourceProject = makeScrollableWorkspaceProject(`conversation-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/workspace/${project.id}`);

    const detailPanel = page.getByTestId("node-detail-panel");
    const history = page.getByTestId("conversation-history");
    await expect(detailPanel).toBeVisible();
    await expect(page.getByTestId("conversation-message")).toHaveCount(30);

    const metrics = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="node-detail-panel"]');
      const historyElement = document.querySelector<HTMLElement>(
        '[data-testid="conversation-history"]',
      );
      if (!panel || !historyElement) {
        throw new Error("Expected node detail panel and conversation history.");
      }

      return {
        historyClientHeight: historyElement.clientHeight,
        historyScrollHeight: historyElement.scrollHeight,
        panelHeight: panel.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.panelHeight).toBeLessThanOrEqual(metrics.viewportHeight - 96);
    expect(metrics.historyScrollHeight).toBeGreaterThan(metrics.historyClientHeight + 24);
    await expectWheelScrolls(page, history);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("keeps long project notes inside the desktop side panel", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop notes scrolling is covered once.");

  const sourceProject = makeScrollableWorkspaceProject(`notes-desktop-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("node-detail-notes-button").click();

    const notesWindow = page.getByTestId("project-notes-window");
    const notesEditor = page.getByTestId("project-notes-input");
    await expect(notesWindow).toBeVisible();
    await expect(
      notesEditor.getByRole("heading", {
        exact: true,
        level: 2,
        name: "Notebook section 1",
      }),
    ).toBeVisible();

    const metrics = await page.evaluate(() => {
      const notesWindowElement = document.querySelector<HTMLElement>(
        '[data-testid="project-notes-window"]',
      );
      const notesPanelElement = document.querySelector<HTMLElement>(
        '[data-testid="project-notes-panel"]',
      );
      const notesEditorElement = document.querySelector<HTMLElement>(
        '[data-testid="project-notes-input"]',
      );
      if (!notesWindowElement || !notesPanelElement || !notesEditorElement) {
        throw new Error("Expected project notes window, panel, and editor.");
      }

      return {
        editorClientHeight: notesEditorElement.clientHeight,
        editorScrollHeight: notesEditorElement.scrollHeight,
        panelHeight: notesPanelElement.getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
        windowHeight: notesWindowElement.getBoundingClientRect().height,
      };
    });

    expect(metrics.windowHeight).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.panelHeight).toBeLessThanOrEqual(metrics.windowHeight + 1);
    expect(metrics.editorScrollHeight).toBeGreaterThan(metrics.editorClientHeight + 24);
    await expectWheelScrolls(page, notesEditor);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("keeps long project notes scrollable inside the mobile drawer", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile drawer scrolling is covered once.");

  const sourceProject = makeScrollableWorkspaceProject(`notes-mobile-scroll-${makeSeed()}`);
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/workspace/${project.id}`);
    await page.getByTestId("workspace-mobile-view-chat").click();
    await expect(page.getByTestId("node-detail-notes-button")).toBeVisible();
    await page.getByTestId("node-detail-notes-button").click();

    const notesWindow = page.getByTestId("project-notes-window");
    const notesEditor = page.getByTestId("project-notes-input");
    await expect(notesWindow).toBeVisible();
    await expect(page.getByTestId("project-notes-drawer-backdrop")).toHaveCount(0);
    await expect(
      notesEditor.getByRole("heading", {
        exact: true,
        level: 2,
        name: "Notebook section 1",
      }),
    ).toBeVisible();

    const metrics = await page.evaluate(() => {
      const notesWindowElement = document.querySelector<HTMLElement>(
        '[data-testid="project-notes-window"]',
      );
      const notesEditorElement = document.querySelector<HTMLElement>(
        '[data-testid="project-notes-input"]',
      );
      if (!notesWindowElement || !notesEditorElement) {
        throw new Error("Expected project notes drawer and editor.");
      }

      return {
        editorClientHeight: notesEditorElement.clientHeight,
        editorScrollHeight: notesEditorElement.scrollHeight,
        viewportHeight: window.innerHeight,
        windowHeight: notesWindowElement.getBoundingClientRect().height,
      };
    });

    expect(metrics.windowHeight).toBeLessThanOrEqual(metrics.viewportHeight - 20);
    expect(metrics.editorScrollHeight).toBeGreaterThan(metrics.editorClientHeight + 24);

    const scrolledTop = await notesEditor.evaluate((element) => {
      const scrollElement = element as HTMLElement;
      scrollElement.scrollTop = 0;
      scrollElement.scrollBy({ top: 700 });
      return scrollElement.scrollTop;
    });
    expect(scrolledTop).toBeGreaterThan(24);
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("shows the workspace sidebar as a collapsible tree outline", async ({
  page,
}, testInfo) => {
  const sourceProject = makeWorkspaceTreeProject(makeSeed());
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;
    const root = project.nodes[project.rootNodeId];
    const basics = getNodeByTitle(project, "Machine Learning Basics");
    const gradient = getNodeByTitle(project, "Gradient Descent Details");

    await page.goto(`/workspace/${project.id}`);
    if (testInfo.project.name === "mobile-chrome") {
      await page.getByTestId("workspace-mobile-view-outline").click();
    }

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
    await expect(page.getByTestId("node-brief-card")).toContainText(
      "Nested child found through outline search.",
    );
    await expect(page.getByTestId("conversation-empty-state")).toHaveCount(0);

    if (testInfo.project.name === "mobile-chrome") {
      await page.getByTestId("workspace-mobile-view-outline").click();
    }

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

test("streams a node reply into a draft child node", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Streaming chat is covered once.");

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
    await expect(page.getByTestId("streaming-assistant-response")).toBeVisible();
    await expect(page.getByTestId("message-streaming-status")).toBeVisible();
    const messages = page.getByTestId("conversation-message");
    await expect(messages).toHaveCount(4);
    await expect(messages.nth(0)).toHaveAttribute("data-inherited", "true");
    await expect(messages.nth(1)).toHaveAttribute("data-inherited", "true");
    await expect(messages.nth(0).getByTestId("edit-message-button")).toHaveCount(0);
    await expect(messages.nth(1).getByTestId("retry-message-button")).toHaveCount(0);
    await expect(messages.nth(3).getByTestId("retry-message-button")).toHaveCount(1);

    await expect(page.getByTestId("conversation-history")).toContainText(
      `Instruction received: ${instruction}`,
    );
    await expect(messages).toHaveCount(4);
    await expect(messages.nth(2)).toContainText(instruction);
    await expect(messages.nth(2)).not.toHaveAttribute("data-inherited", "true");
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

test("attaches file metadata to a sent message", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Attachment messaging is covered once.");

  const sourceProject = makeWorkspaceProject(`attachments-${makeSeed()}`);
  const instruction = "Use these attached file names as context markers.";
  let projectIdToDelete: string | null = null;

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;

    await page.goto(`/workspace/${project.id}`);
    await expect(page.getByTestId("add-message-attachment-button")).toBeVisible();

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId("add-message-attachment-button").click();
    await page.getByTestId("upload-new-file-button").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
      {
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("attachment notes"),
      },
      {
        name: "brief.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4"),
      },
      {
        name: "sketch.png",
        mimeType: "image/png",
        buffer: Buffer.from("png"),
      },
    ]);

    await expect(page.getByTestId("pending-attachment-chip")).toHaveCount(3);
    await page
      .getByTestId("pending-attachment-chip")
      .filter({ hasText: "brief.pdf" })
      .getByTestId("remove-pending-attachment-button")
      .click();
    await expect(page.getByTestId("pending-attachment-chip")).toHaveCount(2);

    await page.getByTestId("message-instruction-input").fill(instruction);
    await page.getByTestId("send-message-button").click();

    await expect(
      page.locator('[data-testid="conversation-message"]:not([data-inherited="true"])').first(),
    ).toContainText(
      instruction,
    );
    await expect(page.getByTestId("message-attachment")).toHaveCount(2);
    await expect(page.getByTestId("conversation-history")).toContainText("notes.txt");
    await expect(page.getByTestId("conversation-history")).toContainText("sketch.png");
    await expect(page.getByTestId("conversation-history")).not.toContainText("brief.pdf");
  } finally {
    if (projectIdToDelete) {
      await page.request
        .delete(`/api/projects/${projectIdToDelete}`, { headers: API_MUTATION_HEADERS })
        .catch(() => undefined);
    }
  }
});

test("selects an indexed PDF knowledge document without re-uploading", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Knowledge attachment selection is covered once.");

  const seed = makeSeed();
  const sourceProject = makeWorkspaceProject(`knowledge-${seed}`);
  const instruction = "Use the selected knowledge PDF.";
  const documentId = `doc-e2e-${seed}`;
  let projectIdToDelete: string | null = null;
  let uploadRequests = 0;
  let indexRequests = 0;
  let streamPayload: unknown = null;

  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documents: [
          {
            id: documentId,
            fileName: "memory.pdf",
            mimeType: "application/pdf",
            pageCount: 12,
            title: "Memory Systems",
            status: "indexed",
            errorMessage: null,
            updatedAt: new Date().toISOString(),
          },
          {
            id: `doc-pending-${seed}`,
            fileName: "pending.pdf",
            mimeType: "application/pdf",
            pageCount: 0,
            title: null,
            status: "indexing",
            errorMessage: null,
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    });
  });
  await page.route("**/api/documents/upload", async (route) => {
    uploadRequests += 1;
    await route.fulfill({ status: 500, body: "Unexpected upload" });
  });
  await page.route("**/api/documents/**/index", async (route) => {
    indexRequests += 1;
    await route.fulfill({ status: 500, body: "Unexpected index" });
  });

  try {
    const project = await importProject(page, sourceProject);
    projectIdToDelete = project.id;
    await page.route(`**/api/projects/${project.id}/nodes/stream`, async (route) => {
      streamPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: 'event: error\ndata: {"message":"Captured request"}\n\n',
      });
    });

    await page.goto(`/workspace/${project.id}`);
    const addButtonBox = await page
      .getByTestId("add-message-attachment-button")
      .boundingBox();
    const modelButtonBox = await page
      .getByTestId("chat-model-selector-button")
      .boundingBox();
    expect(addButtonBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
      modelButtonBox?.x ?? Number.NEGATIVE_INFINITY,
    );

    await page.getByTestId("add-message-attachment-button").click();
    await expect(page.getByTestId("attachment-menu")).toBeVisible();
    await expect(page.getByTestId("upload-new-file-button")).toBeVisible();
    await expect(page.getByTestId("knowledge-menu-button")).toBeVisible();
    await expect(page.getByTestId("knowledge-document-menu")).toHaveCount(0);
    await expect(page.getByTestId("attachment-menu")).not.toContainText("memory.pdf");

    await page.getByTestId("knowledge-menu-button").hover();
    await expect(page.getByTestId("knowledge-document-menu")).toBeVisible();
    await expect(page.getByTestId("knowledge-document-option")).toHaveCount(1);
    await expect(page.getByTestId("knowledge-document-menu")).not.toContainText(
      "pending.pdf",
    );
    await page
      .getByTestId("knowledge-document-option")
      .filter({ hasText: "Memory Systems" })
      .click();
    await expect(page.getByTestId("pending-attachment-chip")).toContainText("memory.pdf");
    await expect(page.getByTestId("pending-attachment-chip")).toContainText("Knowledge PDF");

    await page.getByTestId("message-instruction-input").fill(instruction);
    await page.getByTestId("send-message-button").click();

    await expect.poll(() => streamPayload).not.toBeNull();
    const payload = streamPayload as {
      attachments?: Array<Record<string, unknown>>;
      instruction?: string;
    };
    expect(payload.instruction).toBe(instruction);
    expect(payload.attachments).toEqual([
      expect.objectContaining({
        name: "memory.pdf",
        mimeType: "application/pdf",
        size: 0,
        documentId,
        documentStatus: "indexed",
      }),
    ]);
    expect(uploadRequests).toBe(0);
    expect(indexRequests).toBe(0);
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
  test.skip(testInfo.project.name !== "chromium", "Import/export is covered once.");

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
