// Renders promo/composition.html frame by frame and encodes it with ffmpeg.
//
// Usage:
//   node promo/render.mjs                 # full video → promo/out/branchmind-promo-9x16.mp4
//   node promo/render.mjs --stills 2,6,12 # only PNG stills at those seconds (quick review)
//
// Optional: drop a soundtrack at promo/assets/bgm.mp3 (or .m4a/.wav) and it is mixed in
// with a fade in/out and trimmed to the video length.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const OUT_DIR = here("./out/");
const COMPOSITION = pathToFileURL(here("./composition.html")).href + "?render=1";
const OUTPUT = OUT_DIR + "branchmind-promo-9x16.mp4";
const stillsArg = process.argv.indexOf("--stills");
const stills = stillsArg > -1 ? process.argv[stillsArg + 1].split(",").map(Number) : null;

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
await page.goto(COMPOSITION);
await page.waitForFunction(() => typeof window.renderFrame === "function");
await page.evaluate(() => document.fonts.ready);
const { DURATION, FPS } = await page.evaluate(() => window.PROMO);
const stage = page.locator("#stage");

async function frameAt(seconds) {
  await page.evaluate((t) => window.renderFrame(t), seconds);
  return stage.screenshot({ type: "png" });
}

if (stills) {
  for (const s of stills) {
    const buffer = await frameAt(s);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${OUT_DIR}still-${s.toFixed(2)}.png`, buffer);
    console.log(`still ${s}s`);
  }
  await browser.close();
  process.exit(0);
}

const bgm = ["bgm.mp3", "bgm.m4a", "bgm.wav"].map((f) => here("./assets/" + f)).find(existsSync);
const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"];
if (bgm) {
  args.push("-i", bgm, "-filter_complex",
    `[1:a]atrim=0:${DURATION},afade=t=in:d=0.8,afade=t=out:st=${DURATION - 2}:d=2,volume=0.8[a]`,
    "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-shortest");
}
args.push(
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
  "-profile:v", "high", "-movflags", "+faststart", "-r", String(FPS), OUTPUT,
);
const ffmpeg = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
const ffmpegDone = new Promise((resolve, reject) => {
  ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
});

const total = Math.round(DURATION * FPS);
for (let frame = 0; frame < total; frame += 1) {
  const buffer = await frameAt(frame / FPS);
  if (!ffmpeg.stdin.write(buffer)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (frame % 90 === 0) console.log(`frame ${frame}/${total}`);
}
ffmpeg.stdin.end();
await ffmpegDone;

// Cover image for the platform upload page (outro brand card).
const cover = await frameAt(DURATION - 0.5);
const { writeFile } = await import("node:fs/promises");
await writeFile(OUT_DIR + "branchmind-promo-cover.png", cover);

await browser.close();
console.log(`done → ${OUTPUT}${bgm ? " (with bgm)" : " (silent)"}`);
