import { readFile, writeFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ChatMessage, Project } from "@/lib/types";

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

test("navigates the project shell with stable test ids", async ({ page }) => {
  await page.goto("/");
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;

  if (isMobile) {
    await page.locator("summary").filter({ hasText: "Menu" }).click();
    await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  } else {
    await expect(page.getByTestId("home-primary-navigation")).toBeVisible();
    await expect(page.getByTestId("home-projects-link")).toBeVisible();
    await expect(page.getByTestId("home-privacy-link")).toBeVisible();
    await expect(page.getByTestId("home-terms-link")).toBeVisible();
  }

  if (isMobile) {
    await page.getByRole("link", { name: "Projects" }).click();
  } else {
    await page.getByTestId("home-projects-link").click();
  }

  await expect(page).toHaveURL(/\/projects$/);
  if (!isMobile) {
    await expect(page.getByTestId("projects-navigation")).toBeVisible();
  }
  await expect(page.getByTestId("project-card-list")).toBeVisible();
  await expect(page.getByTestId("project-search-input")).toBeVisible();
  await expect(
    page.getByTestId("project-grid").or(page.getByTestId("project-empty-state")),
  ).toBeVisible();
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
  await page.getByTestId("chat-model-selector-button").click();
  await expect(page.getByTestId("chat-model-menu")).toBeVisible();
  await page
    .getByTestId("chat-model-option")
    .filter({ hasText: "Kimi K2.6" })
    .click();
  await page.getByTestId("project-topic-input").fill(instruction);
  await page.getByTestId("create-project-button").click();

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
  await page.getByTestId("project-topic-input").fill(instruction);
  await page.getByTestId("create-project-button").click();

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
    await page.getByTestId("project-topic-input").fill(instruction);
    await page.getByTestId("create-project-button").click();

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
  await page.getByTestId("project-topic-input").fill(instruction);
  await page.getByTestId("create-project-button").click();

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

  await page.getByTestId("project-topic-input").fill(instruction);
  await page.getByTestId("create-project-button").click();

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

test("shows compact account entry in desktop and mobile headers", async ({ page }) => {
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
  await page.goto("/reader");
  await expect(page.locator('[data-testid="account-sign-in-button"]:visible')).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Menu" }).click();
  await expect(page.getByTestId("responsive-header-mobile-actions")).toBeVisible();
  await expect(page.locator('[data-testid="account-sign-in-button"]:visible')).toBeVisible();
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

test("keeps long project notes inside the fixed desktop side window", async ({
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

    expect(metrics.windowHeight).toBeLessThanOrEqual(metrics.viewportHeight - 80);
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

    await expect(page.getByTestId("conversation-message").first()).toContainText(
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
