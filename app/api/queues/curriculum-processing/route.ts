import { getCurriculumProcessingQueueHandler } from "@/lib/agents/curriculum-builder/curriculum-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

const queueHandler = getCurriculumProcessingQueueHandler();
export function POST(request: Request) { return queueHandler(request); }
