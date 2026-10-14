import { expect, type Page, test } from "@playwright/test";

const DEMO_DISMISSED_STORAGE_KEY = "branchmind-home-demo-dismissed";

// playwright.config.ts marks the demo as seen for every other test.
// These tests need a first-visit browser.
test.use({ storageState: { cookies: [], origins: [] } });

function readDismissedFlag(page: Page) {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    DEMO_DISMISSED_STORAGE_KEY,
  );
}

test("home demo plays on first visit and stops for good after clicking the input card", async ({
  page,
}) => {
  await page.goto("/");

  const mindMap = page.getByTestId("mind-map");
  const demoCard = page.getByTestId("home-demo-card");
  const input = page.getByTestId("message-instruction-input");

  await expect(demoCard).toBeVisible();
  await expect(mindMap).toHaveAttribute("data-home-demo", "playing");
  await expect(page.getByTestId("home-demo-ghost").first()).toBeVisible();
  expect(await readDismissedFlag(page)).toBeNull();

  await demoCard.click();

  await expect(input).toBeFocused();
  await expect.poll(() => readDismissedFlag(page)).toBe("1");
  await expect(demoCard).toHaveCount(0);
  await expect(page.getByTestId("home-demo-ghost")).toHaveCount(0);
  await expect(mindMap).not.toHaveAttribute("data-home-demo", /.*/);

  await input.pressSequentially("hello");
  await expect(input).toHaveValue("hello");

  await page.reload();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expect(page.getByTestId("message-instruction-input")).toBeVisible();
  await expect(mindMap).not.toHaveAttribute("data-home-demo", /.*/);
  await expect(demoCard).toHaveCount(0);
});

test("focusing the home composer with the keyboard stops the demo", async ({ page }) => {
  await page.goto("/");

  const demoCard = page.getByTestId("home-demo-card");
  const input = page.getByTestId("message-instruction-input");

  await expect(demoCard).toBeVisible();
  await input.focus();

  await expect(input).toBeFocused();
  await expect.poll(() => readDismissedFlag(page)).toBe("1");
  await expect(demoCard).toHaveCount(0);
  await expect(page.getByTestId("mind-map")).not.toHaveAttribute(
    "data-home-demo",
    /.*/,
  );
});

test("home demo is skipped when the user prefers reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  // Nodes become visible only after React Flow measured them on the client,
  // which is after the demo would have started.
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expect(page.getByTestId("message-instruction-input")).toBeVisible();
  await expect(page.getByTestId("mind-map")).not.toHaveAttribute(
    "data-home-demo",
    /.*/,
  );
  await expect(page.getByTestId("home-demo-card")).toHaveCount(0);
  expect(await readDismissedFlag(page)).toBeNull();
});
