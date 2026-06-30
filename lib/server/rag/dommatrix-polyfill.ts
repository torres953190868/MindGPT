import { DOMMatrix } from "@napi-rs/canvas";

if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-expect-error polyfill for Node.js serverless runtimes (e.g. Vercel)
  globalThis.DOMMatrix = DOMMatrix;
}
