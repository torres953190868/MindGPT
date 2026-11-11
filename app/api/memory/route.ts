import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import {
  clearUserMemoryForOwner,
  getUserMemoryForOwner,
  MAX_CONCEPT_NAME_CHARS,
  MAX_CONCEPT_NOTE_CHARS,
  MAX_PREFERRED_STYLE_CHARS,
  MAX_PROFILE_SUMMARY_CHARS,
  updateUserMemoryForOwner,
  type UserMemorySnapshot,
} from "@/lib/server/user-memory";
import { parseJsonBody } from "@/lib/server/validation";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

const UPDATE_MEMORY_LIMIT = 30;
const UPDATE_MEMORY_WINDOW_MS = 60_000;

const CLEAR_MEMORY_LIMIT = 10;
const CLEAR_MEMORY_WINDOW_MS = 60_000;

const upsertConceptItemSchema = z
  .object({
    concept: z.string().trim().min(1).max(MAX_CONCEPT_NAME_CHARS),
    status: z.enum(["mastered", "learning", "struggling"]),
    note: z.string().trim().max(MAX_CONCEPT_NOTE_CHARS).optional(),
  })
  .strict();

const patchMemorySchema = z
  .object({
    profileSummary: z.string().trim().max(MAX_PROFILE_SUMMARY_CHARS).optional(),
    preferredStyle: z.string().trim().max(MAX_PREFERRED_STYLE_CHARS).optional(),
    upsertConcepts: z.array(upsertConceptItemSchema).max(20).optional(),
    removeConceptIds: z
      .array(z.string().trim().min(1).max(160))
      .max(50)
      .optional(),
    removeConceptKeys: z
      .array(z.string().trim().min(1).max(160))
      .max(50)
      .optional(),
  })
  .strict();

function assertMutation(request: NextRequest) {
  assertValidRequestOrigin(request, {
    allowMissingOrigin: process.env.NODE_ENV !== "production",
  });
}

function emptyReadOnlySnapshot(): UserMemorySnapshot {
  return {
    ownerId: "",
    profileSummary: "",
    preferredStyle: "",
    concepts: [],
    updatedAt: null,
  };
}

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession(
        { memory: emptyReadOnlySnapshot() },
        READ_ONLY_LOCAL_SESSION,
        undefined,
        { requestId },
      );
    }

    const { principal, session } = await getBranchMindAuthContext(request);
    const memory = await getUserMemoryForOwner(principal.id);
    return jsonWithSession({ memory }, session, undefined, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}

export async function PATCH(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertMutation(request);
    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, patchMemorySchema, {
      maxBytes: 32 * 1024,
    });

    const rateLimit = await checkRateLimitAsync(request, {
      action: "update-memory",
      sessionId: principal.id,
      limit: UPDATE_MEMORY_LIMIT,
      windowMs: UPDATE_MEMORY_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
        { requestId },
      );
    }

    const memory = await updateUserMemoryForOwner(principal.id, body);
    return jsonWithSession({ memory }, session, undefined, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}

export async function DELETE(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertMutation(request);
    const { principal, session } = await getBranchMindAuthContext(request);

    const rateLimit = await checkRateLimitAsync(request, {
      action: "clear-memory",
      sessionId: principal.id,
      limit: CLEAR_MEMORY_LIMIT,
      windowMs: CLEAR_MEMORY_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
        { requestId },
      );
    }

    await clearUserMemoryForOwner(principal.id);
    return jsonWithSession({ ok: true }, session, undefined, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
