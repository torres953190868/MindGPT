import { NextResponse } from "next/server";
import { createRequestId, withRequestIdHeader } from "@/lib/server/request";
import { getSupabaseAdminClient, hasSupabaseServerConfig } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HEALTH_PROBE_TABLE = "branchmind_projects";

type SupabaseHealth = "not_configured" | "ok" | "error";

function jsonWithRequestId(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: withRequestIdHeader(undefined, requestId),
  });
}

async function probeSupabase(): Promise<Exclude<SupabaseHealth, "error">> {
  if (!hasSupabaseServerConfig()) return "not_configured";

  const { error } = await getSupabaseAdminClient()
    .from(HEALTH_PROBE_TABLE)
    .select("id", { head: true });

  if (error) throw new Error(error.message);
  return "ok";
}

export async function GET() {
  const requestId = createRequestId();
  const timestamp = new Date().toISOString();

  try {
    const supabase = await probeSupabase();
    return jsonWithRequestId(
      { ok: true, timestamp, checks: { supabase } },
      200,
      requestId,
    );
  } catch (error) {
    console.error("BranchMind health check failed", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return jsonWithRequestId(
      { ok: false, timestamp, checks: { supabase: "error" } },
      503,
      requestId,
    );
  }
}
