"use client";

import { create } from "zustand";
import type { AgentRunDto } from "@/lib/agent-runtime/agent-run-types";
import {
  ACTIVE_AGENT_RUN_STATUSES,
  isTerminalAgentRunStatus,
} from "@/lib/agent-runtime/agent-run-types";
import type {
  CurriculumRunStage,
  CurriculumStreamEvent,
  SourcePreview,
} from "@/lib/agent-runtime/stream-events";
import type { CurriculumValidationResult } from "@/lib/curriculum/curriculum-validation-service";
import {
  cancelAgentRun,
  generateCurriculum,
  getAgentRun,
  getAgentRunEvents,
  resumeAgentRun,
} from "@/lib/client/curriculum-api";
import { readCurriculumStreamEvents } from "@/lib/client/curriculum-streaming";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";

const ACTIVE_RUN_POLL_INTERVAL_MS = 2_000;
const STORAGE_KEY_PREFIX = "branchmind-curriculum-generation:";

// A single browser tab has one active curriculum generation stream. Keeping
// the controller outside Zustand lets the cancel action stop the local SSE
// reader without making an AbortController part of the serializable UI state.
let activeStreamAbortController: AbortController | null = null;

export type SearchRecord = {
  query: string;
  resultCount: number | null;
  completed: boolean;
};

export type GenerationError = {
  code: string | null;
  message: string;
};

export type CurriculumGenerationStatus =
  | "idle"
  | "streaming"
  | "reconnecting"
  | "polling"
  | "cancelling"
  | "resuming"
  | "completed"
  | "failed"
  | "cancelled";

export type CurriculumGenerationState = {
  curriculumId: string | null;
  runId: string | null;
  runStatus: AgentRunDto["status"] | null;
  status: CurriculumGenerationStatus;
  stage: CurriculumRunStage | null;
  searches: SearchRecord[];
  selectedSources: SourcePreview[];
  validation: CurriculumValidationResult | null;
  draftVersionId: string | null;
  error: GenerationError | null;
  latestSeq: number;
  isConnected: boolean;
  pollInterval: number | null;
};

type CurriculumGenerationActions = {
  startGeneration: (curriculumId: string, request: CurriculumBuildRequest) => Promise<void>;
  resumeGeneration: (runId: string) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  reconnectIfNeeded: (curriculumId: string) => Promise<void>;
  applyEvent: (event: CurriculumStreamEvent) => void;
  applyEvents: (events: CurriculumStreamEvent[]) => void;
  reset: () => void;
  resetForTests: () => void;
};

export type CurriculumGenerationStore = CurriculumGenerationState &
  CurriculumGenerationActions;

function getInitialState(): CurriculumGenerationState {
  return {
    curriculumId: null,
    runId: null,
    runStatus: null,
    status: "idle",
    stage: null,
    searches: [],
    selectedSources: [],
    validation: null,
    draftVersionId: null,
    error: null,
    latestSeq: 0,
    isConnected: false,
    pollInterval: null,
  };
}

function getStorageKey(curriculumId: string) {
  return `${STORAGE_KEY_PREFIX}${curriculumId}`;
}

function readStoredRunId(curriculumId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(curriculumId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { runId?: string; latestSeq?: number };
    return typeof parsed.runId === "string" ? parsed.runId : null;
  } catch {
    return null;
  }
}

function writeStoredRun(curriculumId: string, runId: string, latestSeq: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getStorageKey(curriculumId),
      JSON.stringify({ runId, latestSeq }),
    );
  } catch {
    // Ignore storage failures (e.g. private mode).
  }
}

function clearStoredRun(curriculumId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getStorageKey(curriculumId));
  } catch {
    // Ignore.
  }
}

function isStreamingStatus(status: CurriculumGenerationStatus): boolean {
  return status === "streaming" || status === "reconnecting" || status === "polling";
}

function deriveStoreStatus(
  runStatus: AgentRunDto["status"] | null,
  clientStatus: CurriculumGenerationStatus,
): CurriculumGenerationStatus {
  if (runStatus === "succeeded") return "completed";
  if (runStatus === "failed") return clientStatus === "resuming" ? "resuming" : "failed";
  if (runStatus === "cancelled") return clientStatus === "cancelling" ? "cancelling" : "cancelled";
  if (ACTIVE_AGENT_RUN_STATUSES.includes(runStatus ?? ("idle" as AgentRunDto["status"]))) {
    if (clientStatus === "reconnecting") return "reconnecting";
    return "polling";
  }
  return clientStatus;
}

export function applyStreamEvent(
  state: CurriculumGenerationState,
  event: CurriculumStreamEvent,
): CurriculumGenerationState {
  if (event.seq <= state.latestSeq) return state;

  const next: CurriculumGenerationState = {
    ...state,
    latestSeq: event.seq,
    runId: event.runId,
  };

  switch (event.type) {
    case "run_started":
      next.status = isStreamingStatus(next.status) ? next.status : "streaming";
      next.error = null;
      break;
    case "stage_started":
      next.stage = event.stage;
      break;
    case "search_started":
      next.searches = [...next.searches, { query: event.query, resultCount: null, completed: false }];
      break;
    case "search_completed": {
      const searches = [...next.searches];
      const pendingIndex = searches.findIndex((s) => s.query === event.query && !s.completed);
      if (pendingIndex >= 0) {
        searches[pendingIndex] = { ...searches[pendingIndex], resultCount: event.resultCount, completed: true };
      } else {
        searches.push({ query: event.query, resultCount: event.resultCount, completed: true });
      }
      next.searches = searches;
      break;
    }
    case "source_selected":
      if (!next.selectedSources.some((s) => s.url === event.source.url)) {
        next.selectedSources = [...next.selectedSources, event.source];
      }
      break;
    case "validation_completed":
      next.validation = event.validation;
      break;
    case "draft_saved":
      next.draftVersionId = event.curriculumVersionId;
      break;
    case "run_completed":
      next.status = "completed";
      next.draftVersionId = event.curriculumVersionId;
      next.isConnected = false;
      break;
    case "run_failed":
      next.status = "failed";
      next.error = { code: event.code, message: event.message };
      next.isConnected = false;
      break;
    case "run_cancelled":
      next.status = "cancelled";
      next.isConnected = false;
      break;
  }

  return next;
}

export function mergeEvents(
  state: CurriculumGenerationState,
  events: CurriculumStreamEvent[],
): CurriculumGenerationState {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  return sorted.reduce((current, event) => applyStreamEvent(current, event), state);
}

function stopPolling(get: () => CurriculumGenerationState, set: (state: Partial<CurriculumGenerationState>) => void) {
  const state = get();
  if (state.pollInterval !== null) {
    window.clearInterval(state.pollInterval);
    set({ pollInterval: null });
  }
}

function startPolling(
  curriculumId: string,
  runId: string,
  get: () => CurriculumGenerationState,
  set: (state: Partial<CurriculumGenerationState> | ((state: CurriculumGenerationState) => Partial<CurriculumGenerationState>)) => void,
) {
  stopPolling(get, set);

  const interval = window.setInterval(async () => {
    const current = get();
    if (current.runId !== runId || current.curriculumId !== curriculumId) {
      stopPolling(get, set);
      return;
    }

    try {
      const { events } = await getAgentRunEvents(runId, current.latestSeq);
      if (events.length > 0) {
        set((prev) => {
          const merged = mergeEvents(prev, events.map((e) => e.event));
          if (merged.curriculumId) {
            writeStoredRun(merged.curriculumId, merged.runId ?? runId, merged.latestSeq);
          }
          return merged;
        });
      }

      const { run } = await getAgentRun(runId);
      const derived = deriveStoreStatus(run.status, get().status);
      set({ runStatus: run.status, status: derived });

      if (isTerminalAgentRunStatus(run.status)) {
        stopPolling(get, set);
        if (run.status === "succeeded" && run.curriculumVersionId) {
          set({ draftVersionId: run.curriculumVersionId });
        }
        if (curriculumId) clearStoredRun(curriculumId);
      }
    } catch {
      // Polling failures are non-fatal; the next tick retries.
    }
  }, ACTIVE_RUN_POLL_INTERVAL_MS);

  set({ pollInterval: interval });
}

export const useCurriculumGenerationStore = create<CurriculumGenerationStore>((set, get) => ({
  ...getInitialState(),

  applyEvent(event) {
    set((state) => {
      const next = applyStreamEvent(state, event);
      if (next.curriculumId && next.runId) {
        writeStoredRun(next.curriculumId, next.runId, next.latestSeq);
      }
      return next;
    });
  },

  applyEvents(events) {
    set((state) => {
      const next = mergeEvents(state, events);
      if (next.curriculumId && next.runId) {
        writeStoredRun(next.curriculumId, next.runId, next.latestSeq);
      }
      return next;
    });
  },

  async startGeneration(curriculumId, request) {
    const state = get();
    if (isStreamingStatus(state.status)) return;

    set({
      ...getInitialState(),
      curriculumId,
      status: "streaming",
      isConnected: true,
    });

    const abortController = new AbortController();
    activeStreamAbortController = abortController;
    let runId: string | null = null;

    try {
      const { response } = await generateCurriculum(curriculumId, request, {
        signal: abortController.signal,
      });

      const { events } = await readCurriculumStreamEvents(
        response,
        (event) => {
          set((prev) => {
            const next = applyStreamEvent(prev, event);
            if (!runId && event.runId) runId = event.runId;
            if (next.curriculumId && next.runId) {
              writeStoredRun(next.curriculumId, next.runId, next.latestSeq);
            }
            return next;
          });
        },
        {
          signal: abortController.signal,
        },
      );

      if (events.length > 0 && events[0]) {
        runId = events[0].runId;
      }

      const finalEvent = events[events.length - 1];
      if (finalEvent?.type === "run_completed") {
        set({ status: "completed", isConnected: false });
        clearStoredRun(curriculumId);
      } else if (finalEvent?.type === "run_failed") {
        set({
          status: "failed",
          error: { code: finalEvent.code, message: finalEvent.message },
          isConnected: false,
        });
      } else if (finalEvent?.type === "run_cancelled") {
        set({ status: "cancelled", isConnected: false });
      } else if (runId) {
        // Stream ended without terminal event; transition to polling.
        set({ status: "polling", isConnected: false });
        startPolling(curriculumId, runId, get, set);
      }
    } catch (error) {
      if (abortController.signal.aborted && (get().status === "cancelling" || get().status === "cancelled")) {
        return;
      }
      set({
        status: "failed",
        error: {
          code: error instanceof Error && "code" in error ? String(error.code) : null,
          message: error instanceof Error ? error.message : "Generation failed.",
        },
        isConnected: false,
      });
    } finally {
      if (activeStreamAbortController === abortController) {
        activeStreamAbortController = null;
      }
    }
  },

  async resumeGeneration(runId) {
    const state = get();
    if (isStreamingStatus(state.status)) return;

    set({ status: "resuming", isConnected: true, error: null });
    const abortController = new AbortController();
    activeStreamAbortController = abortController;

    try {
      const { response } = await resumeAgentRun(runId, { signal: abortController.signal });
      const { events } = await readCurriculumStreamEvents(response, (event) => {
        set((prev) => {
          const next = applyStreamEvent(prev, event);
          if (next.curriculumId && next.runId) {
            writeStoredRun(next.curriculumId, next.runId, next.latestSeq);
          }
          return next;
        });
      }, { signal: abortController.signal });

      const finalEvent = events[events.length - 1];
      if (finalEvent?.type === "run_completed") {
        set({ status: "completed", isConnected: false });
        const curriculumId = get().curriculumId;
        if (curriculumId) clearStoredRun(curriculumId);
      } else if (finalEvent?.type === "run_failed") {
        set({
          status: "failed",
          error: { code: finalEvent.code, message: finalEvent.message },
          isConnected: false,
        });
      } else if (finalEvent?.type === "run_cancelled") {
        set({ status: "cancelled", isConnected: false });
      } else if (events.length > 0 && events[0]) {
        const curriculumId = get().curriculumId ?? state.curriculumId;
        set({ status: "polling", isConnected: false });
        if (curriculumId) startPolling(curriculumId, events[0].runId, get, set);
      }
    } catch (error) {
      if (abortController.signal.aborted && (get().status === "cancelling" || get().status === "cancelled")) {
        return;
      }
      set({
        status: "failed",
        error: {
          code: error instanceof Error && "code" in error ? String(error.code) : null,
          message: error instanceof Error ? error.message : "Resume failed.",
        },
        isConnected: false,
      });
    } finally {
      if (activeStreamAbortController === abortController) {
        activeStreamAbortController = null;
      }
    }
  },

  async cancelGeneration() {
    const state = get();
    if (!state.runId || !isStreamingStatus(state.status)) return;

    set({ status: "cancelling" });
    stopPolling(get, set);

    try {
      await cancelAgentRun(state.runId);
      activeStreamAbortController?.abort("Generation cancelled.");
      set({ status: "cancelled", isConnected: false });
      if (state.curriculumId) clearStoredRun(state.curriculumId);
    } catch (error) {
      set({
        status: "failed",
        error: {
          code: error instanceof Error && "code" in error ? String(error.code) : null,
          message: error instanceof Error ? error.message : "Cancel failed.",
        },
        isConnected: false,
      });
    }
  },

  async reconnectIfNeeded(curriculumId) {
    const storedRunId = readStoredRunId(curriculumId);
    if (!storedRunId) return;

    set({
      ...getInitialState(),
      curriculumId,
      runId: storedRunId,
      status: "reconnecting",
      isConnected: false,
    });

    try {
      const { run } = await getAgentRun(storedRunId);
      const current = get();
      const newState: Partial<CurriculumGenerationState> = {
        runStatus: run.status,
        runId: run.id,
        draftVersionId: run.curriculumVersionId,
      };

      if (isTerminalAgentRunStatus(run.status)) {
        const { events } = await getAgentRunEvents(storedRunId, 0);
        set((prev) => {
          const merged = mergeEvents({ ...prev, ...newState }, events.map((e) => e.event));
          merged.status = run.status === "succeeded" ? "completed" : (run.status as CurriculumGenerationStatus);
          if (run.curriculumVersionId) merged.draftVersionId = run.curriculumVersionId;
          if (merged.status === "completed") clearStoredRun(curriculumId);
          return merged;
        });
        return;
      }

      // Active run: catch up on missed events, then poll for new ones.
      const { events } = await getAgentRunEvents(storedRunId, current.latestSeq);
      set((prev) => {
        const merged = mergeEvents({ ...prev, ...newState }, events.map((e) => e.event));
        merged.status = "polling";
        return merged;
      });

      startPolling(curriculumId, storedRunId, get, set);
    } catch {
      // Stored run no longer exists; clear it.
      clearStoredRun(curriculumId);
      set(getInitialState());
    }
  },

  reset() {
    const state = get();
    stopPolling(get, set);
    if (state.curriculumId) clearStoredRun(state.curriculumId);
    set(getInitialState());
  },

  resetForTests() {
    stopPolling(get, set);
    set(getInitialState());
  },
}));
