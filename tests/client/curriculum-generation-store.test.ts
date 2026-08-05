import { describe, expect, it } from "vitest";
import {
  applyStreamEvent,
  mergeEvents,
  type CurriculumGenerationState,
} from "@/store/useCurriculumGenerationStore";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";

function makeState(overrides: Partial<CurriculumGenerationState> = {}): CurriculumGenerationState {
  return {
    curriculumId: "curriculum_1",
    runId: "run_1",
    runStatus: "running",
    status: "streaming",
    stage: null,
    searches: [],
    selectedSources: [],
    validation: null,
    draftVersionId: null,
    error: null,
    latestSeq: 0,
    isConnected: true,
    pollInterval: null,
    ...overrides,
  };
}

describe("applyStreamEvent", () => {
  it("advances stage on stage_started", () => {
    const event: CurriculumStreamEvent = { type: "stage_started", runId: "run_1", seq: 1, stage: "intake" };
    const next = applyStreamEvent(makeState(), event);
    expect(next.stage).toBe("intake");
    expect(next.latestSeq).toBe(1);
  });

  it("records search_started and updates on search_completed", () => {
    const state = makeState();
    const started: CurriculumStreamEvent = { type: "search_started", runId: "run_1", seq: 1, query: "linear regression" };
    const completed: CurriculumStreamEvent = {
      type: "search_completed",
      runId: "run_1",
      seq: 2,
      query: "linear regression",
      resultCount: 5,
    };

    const afterStart = applyStreamEvent(state, started);
    expect(afterStart.searches).toEqual([
      { query: "linear regression", resultCount: null, completed: false },
    ]);

    const afterComplete = applyStreamEvent(afterStart, completed);
    expect(afterComplete.searches).toEqual([
      { query: "linear regression", resultCount: 5, completed: true },
    ]);
  });

  it("dedupes selected sources by url", () => {
    const source = {
      url: "https://example.com",
      title: "Example",
      sourceType: "official_documentation" as const,
      qualityScore: 0.8,
    };
    const event1: CurriculumStreamEvent = { type: "source_selected", runId: "run_1", seq: 1, source };
    const event2: CurriculumStreamEvent = { type: "source_selected", runId: "run_1", seq: 2, source };

    const state = applyStreamEvent(makeState(), event1);
    const next = applyStreamEvent(state, event2);

    expect(next.selectedSources).toHaveLength(1);
  });

  it("sets terminal states and errors", () => {
    const failed: CurriculumStreamEvent = {
      type: "run_failed",
      runId: "run_1",
      seq: 1,
      code: "VALIDATION_ERROR",
      message: "Draft invalid",
    };
    const next = applyStreamEvent(makeState(), failed);
    expect(next.status).toBe("failed");
    expect(next.error).toEqual({ code: "VALIDATION_ERROR", message: "Draft invalid" });
    expect(next.isConnected).toBe(false);
  });

  it("ignores duplicate seq numbers", () => {
    const event: CurriculumStreamEvent = { type: "stage_started", runId: "run_1", seq: 1, stage: "intake" };
    const state = applyStreamEvent(makeState({ latestSeq: 2 }), event);
    expect(state.stage).toBeNull();
    expect(state.latestSeq).toBe(2);
  });
});

describe("mergeEvents", () => {
  it("merges events in seq order and catches up state", () => {
    const events: CurriculumStreamEvent[] = [
      { type: "stage_started", runId: "run_1", seq: 1, stage: "intake" },
      { type: "stage_started", runId: "run_1", seq: 3, stage: "searching" },
      { type: "search_started", runId: "run_1", seq: 4, query: "q1" },
      { type: "search_completed", runId: "run_1", seq: 5, query: "q1", resultCount: 3 },
      { type: "run_completed", runId: "run_1", seq: 6, curriculumVersionId: "v1" },
    ];

    const state = mergeEvents(makeState(), events);
    expect(state.stage).toBe("searching");
    expect(state.searches).toEqual([{ query: "q1", resultCount: 3, completed: true }]);
    expect(state.draftVersionId).toBe("v1");
    expect(state.status).toBe("completed");
    expect(state.latestSeq).toBe(6);
  });

  it("sorts out-of-order events by seq", () => {
    const events: CurriculumStreamEvent[] = [
      { type: "stage_started", runId: "run_1", seq: 3, stage: "searching" },
      { type: "stage_started", runId: "run_1", seq: 2, stage: "planning" },
      { type: "stage_started", runId: "run_1", seq: 1, stage: "intake" },
    ];

    const state = mergeEvents(makeState(), events);
    expect(state.stage).toBe("searching");
    expect(state.latestSeq).toBe(3);
  });

  it("merges reconnect catch-up without duplicating already-applied events", () => {
    const initial = makeState({
      latestSeq: 2,
      stage: "planning",
      searches: [],
    });

    const catchUp: CurriculumStreamEvent[] = [
      { type: "stage_started", runId: "run_1", seq: 2, stage: "planning" },
      { type: "stage_started", runId: "run_1", seq: 3, stage: "searching" },
      { type: "search_started", runId: "run_1", seq: 4, query: "q" },
    ];

    const state = mergeEvents(initial, catchUp);
    expect(state.latestSeq).toBe(4);
    expect(state.stage).toBe("searching");
    expect(state.searches).toHaveLength(1);
  });
});
