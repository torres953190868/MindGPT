import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdminClient, hasSupabaseServerConfig } from "@/lib/supabase/server";

export type RetentionConfig = {
  traceDays: number;
  sourceChunkDays: number;
  assessmentDays: number;
};

export type RetentionPlan = {
  dryRun: true;
  generatedAt: string;
  cutoffs: { tracesBefore: string; sourceChunksBefore: string; assessmentsBefore: string };
  protectedData: string[];
  executableTargets: string[];
};

export type RetentionResult = RetentionPlan | {
  dryRun: false;
  deletedRuns: number;
  deletedSteps: number;
  deletedEvents: number;
  deletedIdempotencyKeys: number;
};

const DEFAULT_CONFIG: RetentionConfig = { traceDays: 30, sourceChunkDays: 180, assessmentDays: 365 };

function days(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value ?? 0) >= 1 ? Math.floor(value!) : fallback;
}

export function getRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    traceDays: days(Number(env.BRANCHMIND_TRACE_RETENTION_DAYS), DEFAULT_CONFIG.traceDays),
    sourceChunkDays: days(Number(env.BRANCHMIND_SOURCE_CHUNK_RETENTION_DAYS), DEFAULT_CONFIG.sourceChunkDays),
    assessmentDays: days(Number(env.BRANCHMIND_ASSESSMENT_RETENTION_DAYS), DEFAULT_CONFIG.assessmentDays),
  };
}

function cutoff(now: Date, retentionDays: number) {
  return new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
}

export function createRetentionPlan(now = new Date(), config = getRetentionConfig()): RetentionPlan {
  return {
    dryRun: true,
    generatedAt: now.toISOString(),
    cutoffs: {
      tracesBefore: cutoff(now, config.traceDays),
      sourceChunksBefore: cutoff(now, config.sourceChunkDays),
      assessmentsBefore: cutoff(now, config.assessmentDays),
    },
    protectedData: [
      "active/queued/running agent runs",
      "active enrollment records",
      "learning assessments and evidence referenced by an enrollment",
      "source chunks still attached to a curriculum version",
    ],
    executableTargets: ["terminal agent_runs, steps, events and expired idempotency keys"],
  };
}

type StoredRun = { id: string; status: string; finished_at: string | null; created_at: string };
type StoredTraceData = {
  version?: number;
  runs?: StoredRun[];
  steps?: Array<{ run_id: string; created_at: string }>;
  events?: Array<{ run_id: string; created_at: string }>;
  idempotencyKeys?: Array<{ created_at: string }>;
};

function filePath() {
  const dir = process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(dir, "branchmind-agent-runs.json");
}

export async function executeRetentionCleanup(options: {
  now?: Date;
  config?: RetentionConfig;
  dryRun?: boolean;
  confirm?: boolean;
} = {}): Promise<RetentionResult> {
  const plan = createRetentionPlan(options.now, options.config ?? getRetentionConfig());
  if (options.dryRun !== false || options.confirm !== true) return plan;

  if (hasSupabaseServerConfig() && process.env.BRANCHMIND_CURRICULUM_BACKEND !== "file") {
    const client = getSupabaseAdminClient();
    const terminal = await client
      .from("agent_runs")
      .select("id")
      .in("status", ["succeeded", "failed", "cancelled"])
      .lt("finished_at", plan.cutoffs.tracesBefore);
    if (terminal.error) throw new Error(`Retention run query failed: ${terminal.error.message}`);
    const ids = (terminal.data ?? []).map((row) => row.id);
    if (ids.length === 0) return { dryRun: false, deletedRuns: 0, deletedSteps: 0, deletedEvents: 0, deletedIdempotencyKeys: 0 };
    const steps = await client.from("agent_steps").delete({ count: "exact" }).in("run_id", ids);
    const events = await client.from("agent_run_events").delete({ count: "exact" }).in("run_id", ids);
    const runs = await client.from("agent_runs").delete({ count: "exact" }).in("id", ids);
    if (steps.error || events.error || runs.error) throw new Error("Retention trace cleanup failed.");
    return { dryRun: false, deletedRuns: runs.count ?? ids.length, deletedSteps: steps.count ?? 0, deletedEvents: events.count ?? 0, deletedIdempotencyKeys: 0 };
  }

  const target = filePath();
  let data: StoredTraceData;
  try {
    data = JSON.parse(await readFile(target, "utf8")) as StoredTraceData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dryRun: false, deletedRuns: 0, deletedSteps: 0, deletedEvents: 0, deletedIdempotencyKeys: 0 };
    throw error;
  }
  const deletedRunIds = new Set((data.runs ?? [])
    .filter((run) => ["succeeded", "failed", "cancelled"].includes(run.status) && run.finished_at && run.finished_at < plan.cutoffs.tracesBefore)
    .map((run) => run.id));
  const beforeRuns = data.runs?.length ?? 0;
  const beforeSteps = data.steps?.length ?? 0;
  const beforeEvents = data.events?.length ?? 0;
  const beforeKeys = data.idempotencyKeys?.length ?? 0;
  data.runs = (data.runs ?? []).filter((run) => !deletedRunIds.has(run.id));
  data.steps = (data.steps ?? []).filter((step) => !deletedRunIds.has(step.run_id));
  data.events = (data.events ?? []).filter((event) => !deletedRunIds.has(event.run_id));
  data.idempotencyKeys = (data.idempotencyKeys ?? []).filter((entry) => entry.created_at >= plan.cutoffs.tracesBefore);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return {
    dryRun: false,
    deletedRuns: beforeRuns - data.runs.length,
    deletedSteps: beforeSteps - data.steps.length,
    deletedEvents: beforeEvents - data.events.length,
    deletedIdempotencyKeys: beforeKeys - data.idempotencyKeys.length,
  };
}

