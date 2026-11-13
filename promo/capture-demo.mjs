// Captures the real homepage onboarding demo frame by frame with a fake clock,
// so every frame is evenly spaced no matter how slow the screenshot is.
//
// Usage: PROMO_BASE_URL=http://127.0.0.1:12760 node promo/capture-demo.mjs
// Needs a dev server with AI_MOCK_MODE=true (see promo/README.md).
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.PROMO_BASE_URL ?? "http://127.0.0.1:12760";
const FPS = 30;
const SECONDS = Number(process.env.PROMO_DEMO_SECONDS ?? 23); // two 11.5s loops
const VIEWPORT = { width: 720, height: 1280 };
const OUT_DIR = fileURLToPath(new URL("./frames/demo/", import.meta.url));

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1080 / VIEWPORT.width,
  locale: "zh-CN",
});
await context.addCookies([
  { name: "branchmind-language", value: "zh", url: BASE },
  { name: "branchmind-theme", value: "warm-limestone", url: BASE },
]);
const page = await context.newPage();

// Hide dev-only overlays (Next.js dev indicator, element inspector).
await page.addInitScript(() => {
  const style = document.createElement("style");
  style.textContent = "nextjs-portal, [data-nextjs-toast], [data-element-inspector] { display: none !important; }";
  document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
});

await page.clock.install({ time: new Date("2026-11-13T09:00:00+08:00") });
await page.goto(BASE + "/");
// An installed clock still flows with real time; pause it so only runFor() moves it.
await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));

// React flushes through MessageChannel, which the fake clock leaves alone.
async function settle() {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(0);
      });
    }
    // Drive CSS transitions/animations from the fake clock as well.
    const w = window;
    w.__promoAnimStarts ??= new WeakMap();
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      if (!w.__promoAnimStarts.has(animation)) w.__promoAnimStarts.set(animation, now);
      animation.pause();
      animation.currentTime = now - w.__promoAnimStarts.get(animation);
    }
  });
}

const card = page.getByTestId("home-demo-card");
for (let i = 0; i < 400 && !(await card.isVisible()); i += 1) {
  await page.clock.runFor(16);
  await settle();
  await page.waitForTimeout(10);
}
if (!(await card.isVisible())) throw new Error("home demo card never appeared");
await page.waitForLoadState("networkidle");

const total = Math.round(SECONDS * FPS);
const frameMs = 1000 / FPS;
let elapsed = 0;
for (let frame = 0; frame < total; frame += 1) {
  // Advance in whole-millisecond steps that average to exactly 1000/FPS.
  const target = Math.round((frame + 1) * frameMs);
  await page.clock.runFor(target - elapsed);
  elapsed = target;
  await settle();
  await page.screenshot({
    path: `${OUT_DIR}${String(frame).padStart(5, "0")}.jpg`,
    type: "jpeg",
    quality: 94,
  });
  if (frame % 60 === 0) console.log(`demo frame ${frame}/${total}`);
}

await browser.close();
console.log(`captured ${total} frames to ${OUT_DIR}`);
