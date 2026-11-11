import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { MAX_REPLY_CONTENT_LENGTH } from "@/lib/server/deepseek-core";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { chatModelSelectionSchema } from "@/lib/server/node-request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import {
  recordCanvasTurnMemoryForOwner,
  resolveUserMemorySlotForOwner,
} from "@/lib/server/user-memory";
import { parseJsonBody } from "@/lib/server/validation";

const chatSchema = z.object({
  mode: z.enum(["root", "continue", "branch"]).optional(),
  instruction: z.string().trim().min(1).max(1_500),
  contextTitles: z.array(z.string().trim().min(1).max(240)).max(24).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(MAX_REPLY_CONTENT_LENGTH),
      }),
    )
    .max(16)
    .optional(),
  sourceText: z.string().trim().max(4_000).optional(),
  modelSelection: chatModelSelectionSchema.optional(),
});

const CHAT_LIMIT = 10;
const CHAT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, chatSchema, {
      maxBytes: 128 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "chat",
      sessionId: principal.id,
      limit: CHAT_LIMIT,
      windowMs: CHAT_WINDOW_MS,
    });

    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const retrievalQuery = [body.instruction, body.sourceText]
      .filter(Boolean)
      .join("\n\n");
    const [userPlan, userMemory] = await Promise.all([
      getAccountPlanForModelAccess(principal),
      resolveUserMemorySlotForOwner(principal.id, retrievalQuery),
    ]);

    const reply = await requestDeepSeekReply({
      ...body,
      llmTask: "branch_chat",
      userPlan,
      ...(userMemory ? { userMemory } : {}),
    });
    await recordCanvasTurnMemoryForOwner({
      ownerId: principal.id,
      mode: body.mode ?? "root",
      instruction: body.instruction,
      sourceText: body.sourceText,
      reply,
      contextSummaries: body.contextTitles,
    });
    return jsonWithSession(reply, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
