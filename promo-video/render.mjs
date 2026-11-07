// 将 promo-video/index.html 逐帧导出并编码为 MP4（H.264）。
//
//   node promo-video/render.mjs                 # 完整导出 → promo-video/out/branchmind-promo.mp4
//   node promo-video/render.mjs --stills 3,9,20 # 只导出指定秒数的静帧，便于检查画面
//   node promo-video/render.mjs --fps 60        # 自定义帧率（默认 30）
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fps = Number(argValue("--fps") ?? 30);
const stills = argValue("--stills");

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "index.html")).href);
await page.evaluate(() => window.promoReady);
const duration = await page.evaluate(() => window.DURATION);

if (stills) {
  const stillDir = path.join(outDir, "stills");
  mkdirSync(stillDir, { recursive: true });
  for (const s of stills.split(",").map(Number)) {
    await page.evaluate((t) => window.renderFrame(t), s);
    await page.screenshot({ path: path.join(stillDir, `t-${String(s).padStart(5, "0")}.png`) });
    console.log(`still @ ${s}s`);
  }
  await browser.close();
  process.exit(0);
}

const framesDir = path.join(outDir, "frames");
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const total = Math.round(duration * fps);
const started = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.renderFrame(t), i / fps);
  const buf = await page.screenshot({ type: "jpeg", quality: 95 });
  writeFileSync(path.join(framesDir, `f${String(i).padStart(5, "0")}.jpg`), buf);
  if (i % fps === 0) {
    const elapsed = (Date.now() - started) / 1000;
    console.log(`frame ${i}/${total}  (${elapsed.toFixed(0)}s elapsed)`);
  }
}

// 封面图：取片尾定格画面
await page.evaluate((t) => window.renderFrame(t), duration - 0.01);
await page.screenshot({ path: path.join(outDir, "branchmind-promo-cover.png") });
await browser.close();

// 用 macOS 自带的 AVFoundation 编码为 H.264 MP4
const encoderBin = path.join(outDir, "encode-frames");
execFileSync(
  "swiftc",
  ["-O", "-module-cache-path", path.join(outDir, ".swift-module-cache"), path.join(here, "encode-frames.swift"), "-o", encoderBin],
  { stdio: "inherit" },
);
const mp4 = path.join(outDir, "branchmind-promo.mp4");
execFileSync(encoderBin, [framesDir, mp4, String(fps)], { stdio: "inherit" });
console.log(`done → ${mp4}`);

