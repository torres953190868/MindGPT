import { getRagProcessingQueueHandler } from "@/lib/server/rag/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

const queueHandler = getRagProcessingQueueHandler();

export function POST(request: Request) {
  return queueHandler(request);
}
