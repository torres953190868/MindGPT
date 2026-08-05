import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  executeRetentionCleanup,
  type RetentionConfig,
} from "@/lib/observability/data-retention";

const config: RetentionConfig = { traceDays: 30, sourceChunkDays: 180, assessmentDays: 365 };
const now = new Date("2026-08-05T00:00:00.000Z");

describe("agent trace retention", () => {
  it("is a dry run unless explicit confirmation is provided", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bm-retention-"));
    const target = path.join(directory, "branchmind-agent-runs.json");
    const data = {
      version: 1,
      runs: [{ id: "old", status: "succeeded", finished_at: "2026-06-01T00:00:00.000Z", created_at: "2026-06-01T00:00:00.000Z" }],
      steps: [{ run_id: "old", created_at: "2026-06-01T00:00:00.000Z" }],
      events: [{ run_id: "old", created_at: "2026-06-01T00:00:00.000Z" }],
      idempotencyKeys: [],
    };
    await writeFile(target, JSON.stringify(data), "utf8");

    const originalDirectory = process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR;
    process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR = directory;
    try {
      const plan = await executeRetentionCleanup({ now, config });
      expect(plan.dryRun).toBe(true);
      expect(JSON.parse(await readFile(target, "utf8")).runs).toHaveLength(1);

      const result = await executeRetentionCleanup({ now, config, dryRun: false, confirm: true });
      expect(result).toMatchObject({ dryRun: false, deletedRuns: 1, deletedSteps: 1, deletedEvents: 1 });
      expect(JSON.parse(await readFile(target, "utf8")).runs).toEqual([]);
    } finally {
      if (originalDirectory === undefined) delete process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR;
      else process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR = originalDirectory;
    }
  });

  it("preserves active runs even when their timestamps are old", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bm-retention-active-"));
    const target = path.join(directory, "branchmind-agent-runs.json");
    await writeFile(target, JSON.stringify({
      version: 1,
      runs: [{ id: "active", status: "running", finished_at: null, created_at: "2026-01-01T00:00:00.000Z" }],
      steps: [],
      events: [],
      idempotencyKeys: [],
    }), "utf8");
    const originalDirectory = process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR;
    process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR = directory;
    try {
      const result = await executeRetentionCleanup({ now, config, dryRun: false, confirm: true });
      expect(result).toMatchObject({ dryRun: false, deletedRuns: 0 });
      expect(JSON.parse(await readFile(target, "utf8")).runs).toHaveLength(1);
    } finally {
      if (originalDirectory === undefined) delete process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR;
      else process.env.BRANCHMIND_AGENT_RUNS_DATA_DIR = originalDirectory;
    }
  });
});
