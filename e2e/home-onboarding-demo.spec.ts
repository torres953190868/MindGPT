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

async function openReturningHomeWithPausedClock(page: Page) {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, "1"),
    DEMO_DISMISSED_STORAGE_KEY,
  );
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByTestId("message-instruction-input")).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.getByTestId("message-instruction-input").focus();
}

test("home composer never flashes while the first-visit demo starts", async ({ page }) => {
  await page.addInitScript(() => {
    const samples = { frames: 0, visibleFrames: 0 };
    Object.assign(window, { __homeComposerStartupSamples: samples });

    function sampleFrame() {
      const composer = document.querySelector<HTMLElement>(
        "[data-home-composer='true']",
      );
      if (composer) {
        samples.frames += 1;
        const style = getComputedStyle(composer);
        if (style.visibility === "visible" && Number(style.opacity) > 0) {
          samples.visibleFrames += 1;
        }
      }
      window.requestAnimationFrame(sampleFrame);
    }

    window.requestAnimationFrame(sampleFrame);
  });

  // Let the server HTML and CSS paint before hydration, as on a cold/slow first visit.
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (route.request().resourceType() === "script") await scriptsReady;
    await route.continue();
  });

  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByTestId("home-hero")).toBeVisible();
  } finally {
    releaseScripts();
  }

  await expect(page.getByTestId("home-demo-card")).toBeVisible();
  await expect(page.getByTestId("home-demo-ghost").first()).toBeVisible();
  const samples = await page.evaluate(() =>
    (window as typeof window & {
      __homeComposerStartupSamples: { frames: number; visibleFrames: number };
    }).__homeComposerStartupSamples,
  );
  expect(samples.frames).toBeGreaterThan(0);
  expect(samples.visibleFrames).toBe(0);
});

test("home demo plays on first visit and yields to the input card", async ({
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

test("home demo replays after 10 idle seconds and user activity resets the countdown", async ({ page }) => {
  await openReturningHomeWithPausedClock(page);

  const demoCard = page.getByTestId("home-demo-card");
  const input = page.getByTestId("message-instruction-input");

  await page.clock.runFor(9_000);
  await expect(demoCard).toHaveCount(0);
  await input.press("ArrowLeft");
  await page.clock.runFor(9_000);
  await expect(demoCard).toHaveCount(0);
  await page.clock.runFor(1_050);
  await expect(page.getByTestId("mind-map")).toHaveAttribute("data-home-demo", "playing");
  await page.clock.runFor(100);
  await expect(demoCard).toBeVisible();

  // Replaying must release focus so keyboard users can stop it again.
  await input.focus();
  await expect(page.getByTestId("mind-map")).toHaveAttribute("data-home-demo", "closing");
  await page.clock.runFor(2_000);
  await expect(demoCard).toHaveCount(0);
  await expect(input).toBeFocused();

  await page.clock.runFor(10_050);
  await expect(page.getByTestId("mind-map")).toHaveAttribute("data-home-demo", "playing");
  await page.clock.runFor(100);
  await expect(demoCard).toBeVisible();
});

test("home demo preserves a draft and replays only after the input is cleared", async ({ page }) => {
  await openReturningHomeWithPausedClock(page);

  const demoCard = page.getByTestId("home-demo-card");
  const input = page.getByTestId("message-instruction-input");
  await page.clock.runFor(9_000);
  await input.fill("Keep my research question");
  await page.clock.runFor(12_000);
  await expect(demoCard).toHaveCount(0);
  await expect(input).toHaveValue("Keep my research question");

  await input.fill("");
  await page.clock.runFor(9_000);
  await expect(demoCard).toHaveCount(0);
  await page.clock.runFor(1_050);
  await expect(page.getByTestId("mind-map")).toHaveAttribute("data-home-demo", "playing");
  await page.clock.runFor(100);
  await expect(demoCard).toBeVisible();
});

test("home demo is skipped when the user prefers reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/");

  // Nodes become visible only after React Flow measured them on the client,
  // which is after the demo would have started.
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expect(page.getByTestId("message-instruction-input")).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.clock.runFor(12_000);
  await expect(page.getByTestId("mind-map")).not.toHaveAttribute(
    "data-home-demo",
    /.*/,
  );
  await expect(page.getByTestId("home-demo-card")).toHaveCount(0);
  expect(await readDismissedFlag(page)).toBeNull();
});
