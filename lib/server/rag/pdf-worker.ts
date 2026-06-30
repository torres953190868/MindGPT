import "./dommatrix-polyfill";

import type { WorkerMessageHandler as WorkerMessageHandlerType } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

type WorkerModule = {
  WorkerMessageHandler: typeof WorkerMessageHandlerType;
};

export async function loadWorkerMessageHandler() {
  if (typeof (globalThis as { pdfjsWorker?: WorkerModule }).pdfjsWorker !== "undefined") {
    return;
  }

  const worker = (await import(
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  )) as unknown as WorkerModule;

  (globalThis as { pdfjsWorker?: WorkerModule }).pdfjsWorker = worker;
}
