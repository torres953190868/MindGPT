// Streaming events for the curriculum-builder agent (spec §8.2) plus the
// generation state machine stages (spec §3.8). Every event carries runId and
// a monotonically increasing per-run seq so a disconnected client can catch
// up via GET /events?after=seq (spec §8.11); events are persisted to
// agent_run_events BEFORE being pushed to clients (spec §7.17).

import type { CurriculumValidationResult } from "@/lib/curriculum/curriculum-validation-service";
import type { CurriculumSourceType } from "@/lib/curriculum/curriculum-types";

// Spec §3.8 — the twelve curriculum generation states. `completed`, `failed`
// and `cancelled` are terminal; `validating` may loop back through
// `repairing` into searching/extracting/building while repair budget lasts.
export type CurriculumRunStage =
  | "intake"
  | "planning"
  | "searching"
  | "fetching_sources"
  | "extracting_concepts"
  | "building_graph"
  | "validating"
  | "repairing"
  | "saving_draft"
  | "completed"
  | "failed"
  | "cancelled";

export const CURRICULUM_RUN_STAGES: readonly CurriculumRunStage[] = [
  "intake",
  "planning",
  "searching",
  "fetching_sources",
  "extracting_concepts",
  "building_graph",
  "validating",
  "repairing",
  "saving_draft",
  "completed",
  "failed",
  "cancelled",
];

// Lightweight source descriptor carried by `source_selected` events (the full
// row lives in curriculum_sources once the draft persists).
export type SourcePreview = {
  url: string;
  title: string;
  publisher?: string;
  sourceType: CurriculumSourceType;
  qualityScore: number;
};

// Spec §8.2 — the ten stream events. `validation` uses the deterministic
// validation result shape (CurriculumValidation in the spec).
export type CurriculumStreamEvent =
  | { type: "run_started"; runId: string; seq: number }
  | { type: "stage_started"; runId: string; seq: number; stage: CurriculumRunStage }
  | { type: "search_started"; runId: string; seq: number; query: string }
  | {
      type: "search_completed";
      runId: string;
      seq: number;
      query: string;
      resultCount: number;
    }
  | { type: "source_selected"; runId: string; seq: number; source: SourcePreview }
  | {
      type: "validation_completed";
      runId: string;
      seq: number;
      validation: CurriculumValidationResult;
    }
  | { type: "draft_saved"; runId: string; seq: number; curriculumVersionId: string }
  | { type: "run_completed"; runId: string; seq: number; curriculumVersionId: string }
  | { type: "run_failed"; runId: string; seq: number; code: string; message: string }
  | { type: "run_cancelled"; runId: string; seq: number };

// Same shape minus the sequencing fields — what runners hand to the
// sequencer; seq is assigned centrally so ordering can never drift.
export type CurriculumStreamEventInput =
  | { type: "run_started" }
  | { type: "stage_started"; stage: CurriculumRunStage }
  | { type: "search_started"; query: string }
  | { type: "search_completed"; query: string; resultCount: number }
  | { type: "source_selected"; source: SourcePreview }
  | { type: "validation_completed"; validation: CurriculumValidationResult }
  | { type: "draft_saved"; curriculumVersionId: string }
  | { type: "run_completed"; curriculumVersionId: string }
  | { type: "run_failed"; code: string; message: string }
  | { type: "run_cancelled" };

// Assigns monotonically increasing seq values within one run. Constructed
// with the runId; `next()` stamps the caller's event with runId + seq. When
// resuming an interrupted stream, seed `initialSeq` from the last persisted
// event so the sequence stays gapless.
export class AgentEventSequencer {
  private readonly runId: string;
  private seq: number;

  constructor(runId: string, options: { initialSeq?: number } = {}) {
    this.runId = runId;
    this.seq = options.initialSeq ?? 0;
  }

  get currentSeq() {
    return this.seq;
  }

  next(event: CurriculumStreamEventInput): CurriculumStreamEvent {
    this.seq += 1;
    return { ...event, runId: this.runId, seq: this.seq } as CurriculumStreamEvent;
  }
}
