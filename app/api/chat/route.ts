import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { chatModelSelectionSchema } from "@/lib/server/node-request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

const chatSchema = z.object({
  mode: z.enum(["root", "continue", "branch"]).optional(),
  instruction: z.string().trim().min(1).max(1_500),
  contextTitles: z.array(z.string().trim().min(1).max(240)).max(24).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8_000),
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
      maxBytes: 64 * 1024,
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

    const reply = await requestDeepSeekReply(body);
    return jsonWithSession(reply, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
