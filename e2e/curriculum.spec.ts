import { expect, test, type Page } from "@playwright/test";

type CurriculumVersionListEntry = { id: string; versionNumber: number; status: string };

// Shared precondition: create a curriculum, generate a draft, and publish v1.
// Returns the curriculum id and the published version id.
async function createAndPublishCurriculum(
  page: Page,
  input: { title: string; goal: string; subject: string },
): Promise<{ curriculumId: string; publishedVersionId: string }> {
  await page.goto("/curricula");
  await expect(page.getByTestId("curriculum-list-page")).toBeVisible();

  await page.getByLabel(/课程名称|curriculum title/i).fill(input.title);
  await page.getByLabel(/学习目标|learning goal/i).fill(input.goal);
  await page.getByRole("button", { name: /创建|create/i }).click();
  await expect(page).toHaveURL(/\/curricula\/[^/]+$/);

  const curriculumId = new URL(page.url()).pathname.split("/").pop();
  if (!curriculumId) throw new Error("Curriculum id missing from URL.");
  await page.getByLabel(/主题|subject/i).last().fill(input.subject);
  await page.getByLabel(/学习目标|learning goal/i).last().fill(input.goal);
  await page.getByTestId("curriculum-generate-button").click();
  await expect(page.getByTestId("curriculum-version-preview")).toContainText(/版本|version/i, { timeout: 90_000 });

  await page.getByRole("button", { name: /发布|publish/i }).first().click();
  await expect(page.getByTestId("curriculum-publish-dialog")).toBeVisible();
  const publishResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/curricula/${curriculumId}/publish`) && response.request().method() === "POST" && response.ok(),
  );
  await page.getByTestId("curriculum-publish-dialog").getByRole("button", { name: /确认发布|confirm/i }).click();
  await publishResponse;

  const versionsResponse = await page.request.get(`/api/curricula/${curriculumId}/versions`);
  expect(versionsResponse.ok()).toBeTruthy();
  const versions = (await versionsResponse.json()).versions as CurriculumVersionListEntry[];
  const published = versions.find((version) => version.status === "published");
  expect(published).toBeTruthy();
  return { curriculumId, publishedVersionId: published!.id };
}

test.describe("curriculum agent flow", () => {
  test("creates, generates, publishes, enrolls, and answers in Tutor", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/curricula");
    await expect(page.getByTestId("curriculum-list-page")).toBeVisible();

    await page.getByLabel(/课程名称|curriculum title/i).fill("E2E Testing Curriculum");
    await page.getByLabel(/学习目标|learning goal/i).fill("Understand reliable automated testing.");
    await page.getByRole("button", { name: /创建|create/i }).click();
    await expect(page).toHaveURL(/\/curricula\/[^/]+$/);

    const curriculumId = new URL(page.url()).pathname.split("/").pop();
    if (!curriculumId) throw new Error("Curriculum id missing from URL.");
    await page.getByLabel(/主题|subject/i).last().fill("Software Testing");
    await page.getByLabel(/学习目标|learning goal/i).last().fill("Explain and apply unit testing.");
    await page.getByTestId("curriculum-generate-button").click();
    await expect(page.getByTestId("curriculum-version-preview")).toContainText(/版本|version/i, { timeout: 90_000 });

    const publishButton = page.getByRole("button", { name: /发布|publish/i }).first();
    await publishButton.click();
    await expect(page.getByTestId("curriculum-publish-dialog")).toBeVisible();
    const publishResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/curricula/${curriculumId}/publish`) && response.request().method() === "POST" && response.ok(),
    );
    await page.getByTestId("curriculum-publish-dialog").getByRole("button", { name: /确认发布|confirm/i }).click();
    await publishResponse;

    const versionsResponse = await page.request.get(`/api/curricula/${curriculumId}/versions`);
    expect(versionsResponse.ok()).toBeTruthy();
    const versions = (await versionsResponse.json()).versions as Array<{ id: string; status: string }>;
    const published = versions.find((version) => version.status === "published");
    expect(published).toBeTruthy();

    const enrollmentResponse = await page.request.post(`/api/curricula/${curriculumId}/enroll`, {
      headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": `e2e-enroll-${Date.now()}` },
      data: { curriculumVersionId: published!.id },
    });
    expect(enrollmentResponse.ok()).toBeTruthy();
    const enrollment = (await enrollmentResponse.json()).enrollment as { id: string };

    await page.goto(`/learn/${enrollment.id}`);
    await expect(page.getByText("BranchMind Tutor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/本节聚焦|Current node|当前节点/).first()).toBeVisible();
    const answer = page.getByPlaceholder(/写下你的回答|write your answer/i);
    await answer.fill("A unit test checks one behavior with a clear example.");
    await page.getByRole("button", { name: /提交评估|submit assessment/i }).click();
    await expect(page.getByText(/掌握度：\d+\.\d+ · 状态：/).last()).toBeVisible({ timeout: 30_000 });
  });

  test("published version is immutable; edits create a new version", async ({ page }) => {
    test.setTimeout(120_000);
    const { curriculumId, publishedVersionId } = await createAndPublishCurriculum(page, {
      title: "Immutable Versions Curriculum",
      goal: "Keep published curricula stable.",
      subject: "Versioning",
    });

    const preview = page.getByTestId("curriculum-version-preview");

    // A published version exposes no editing controls: the label input is
    // disabled and the draft-only save/publish buttons are not rendered.
    await expect(preview.locator("input")).toBeDisabled();
    await expect(preview.getByRole("button", { name: /保存修改|save changes/i })).toHaveCount(0);
    await expect(preview.getByRole("button", { name: /发布教材|publish curriculum/i })).toHaveCount(0);

    // The server rejects edits to a published version too.
    const patchResponse = await page.request.patch(`/api/curricula/${curriculumId}/versions/${publishedVersionId}`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { versionLabel: "Should not persist" },
    });
    expect(patchResponse.status()).toBe(409);

    // Deriving copies the published version into a new draft (v2).
    const deriveResponse = await page.request.post(`/api/curricula/${curriculumId}/versions/${publishedVersionId}/derive`, {
      headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": `e2e-derive-${Date.now()}` },
    });
    expect(deriveResponse.status()).toBe(201);
    const derived = (await deriveResponse.json()) as { version: { id: string; versionNumber: number; status: string } };
    expect(derived.version.versionNumber).toBe(2);
    expect(derived.version.status).toBe("draft");

    const versionsResponse = await page.request.get(`/api/curricula/${curriculumId}/versions`);
    expect(versionsResponse.ok()).toBeTruthy();
    const versions = (await versionsResponse.json()).versions as CurriculumVersionListEntry[];
    expect(versions.find((version) => version.versionNumber === 2)?.status).toBe("draft");
    expect(versions.find((version) => version.versionNumber === 1)?.status).toBe("published");

    // The version picker lists both versions; switching to the new draft
    // re-enables editing.
    await page.reload();
    const versionSelect = page.getByTestId("curriculum-version-select");
    await expect(versionSelect).toBeVisible();
    await versionSelect.selectOption(derived.version.id);
    await expect(versionSelect).toHaveValue(derived.version.id);
    await expect(preview.locator("input")).toBeEnabled();

    // Diffing the untouched derived draft against v1 reports no structural changes.
    const compareSelect = preview.locator("select", {
      has: page.locator("option", { hasText: /对比版本|compare against/i }),
    });
    await compareSelect.selectOption(publishedVersionId);
    await preview.getByRole("button", { name: /版本差异|version diff/i }).click();
    await expect(preview.getByText(/没有结构变化|no structural changes/i)).toBeVisible();
  });

  test("Tutor does not expose locked nodes", async ({ page }) => {
    test.setTimeout(120_000);
    const subject = "Graph Theory";
    const { curriculumId, publishedVersionId } = await createAndPublishCurriculum(page, {
      title: "Locked Nodes Curriculum",
      goal: "Respect prerequisite gating.",
      subject,
    });

    // Pick a node with unmet prerequisites: it is locked for a fresh enrollment.
    const contentResponse = await page.request.get(`/api/curricula/${curriculumId}/versions/${publishedVersionId}`);
    expect(contentResponse.ok()).toBeTruthy();
    const content = (await contentResponse.json()) as {
      draft: { modules: Array<{ nodes: Array<{ clientId: string; prerequisiteClientIds: string[] }> }> };
    };
    const lockedNode = content.draft.modules
      .flatMap((courseModule) => courseModule.nodes)
      .find((node) => node.prerequisiteClientIds.length > 0);
    expect(lockedNode).toBeTruthy();

    const enrollmentResponse = await page.request.post(`/api/curricula/${curriculumId}/enroll`, {
      headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": `e2e-enroll-${Date.now()}` },
      data: { curriculumVersionId: publishedVersionId },
    });
    expect(enrollmentResponse.ok()).toBeTruthy();
    const enrollment = (await enrollmentResponse.json()).enrollment as { id: string };

    await page.goto(`/learn/${enrollment.id}`);
    await expect(page.getByText("BranchMind Tutor")).toBeVisible({ timeout: 30_000 });
    // Wait until the tutor payload (learning path) has loaded.
    await expect(page.locator("section").getByText(`${subject}基础概念`).first()).toBeVisible();

    // The learning-path sidebar (visible on desktop widths only) lists the
    // available node and hides every locked node, including the status text.
    const sidebar = page.locator("aside").filter({ hasText: "Learning path" });
    if (await sidebar.isVisible()) {
      await expect(sidebar.getByText(`${subject}基础概念`)).toBeVisible();
      await expect(sidebar.getByText(`${subject}核心方法`)).toHaveCount(0);
      await expect(sidebar.getByText(`${subject}综合项目`)).toHaveCount(0);
      await expect(sidebar.getByText(/^locked$/i)).toHaveCount(0);
    }

    // Asking the Tutor API to jump straight to a locked node returns a
    // prerequisite gap instead of a lesson.
    const lockedChatResponse = await page.request.post("/api/tutor/chat", {
      headers: { Origin: new URL(page.url()).origin },
      data: { enrollmentId: enrollment.id, targetNodeId: lockedNode!.clientId, message: "" },
    });
    expect(lockedChatResponse.ok()).toBeTruthy();
    const lockedChatBody = await lockedChatResponse.text();
    expect(lockedChatBody).toContain("prerequisite_gap");
    expect(lockedChatBody).toContain(lockedNode!.clientId);
  });
});
