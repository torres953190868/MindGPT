import { ApiRequestError, formatApiErrorMessage, getApiErrorMeta, readJsonApi } from "@/lib/client/api";
import type { AgentRunDto, AgentRunEventDto } from "@/lib/agent-runtime/agent-run-types";
import type {
  CurriculumBuildRequest,
  CurriculumConflict,
  CurriculumDraft,
  CurriculumVersionStatus,
} from "@/lib/curriculum/curriculum-types";

export type CurriculumDto = {
  id: string;
  ownerUserId: string;
  projectId: string | null;
  title: string;
  subject: string;
  learningGoal: string;
  status: "draft" | "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type CurriculumGenerationQuota = {
  plan: string | null;
  used: number;
  limit: number | null;
  remaining: number | null;
  tracked: boolean;
  resetsAt: string | null;
};

export type GenerateCurriculumResponse = {
  response: Response;
  runId: string | null;
};

export type CancelRunResponse = {
  run: AgentRunDto;
};

export type ResumeRunResponse = {
  response: Response;
  runId: string;
};

export type GetRunResponse = {
  run: AgentRunDto;
};

export type GetEventsResponse = {
  events: AgentRunEventDto[];
};

export type CurriculumVersionSummary = {
  id: string;
  curriculumId: string;
  versionNumber: number;
  versionLabel: string;
  status: CurriculumVersionStatus;
  audience: string;
  assumptions: string[];
  exclusions: string[];
  conflicts: CurriculumConflict[];
  estimatedWeeks: number | null;
  estimatedHours: number | null;
  createdAt: string;
  publishedAt: string | null;
};

export type CurriculumVersionContentResponse = {
  version: CurriculumVersionSummary;
  draft: CurriculumDraft;
  validation: unknown;
};

export type CurriculumOverviewResponse = {
  curriculum: CurriculumDto;
  versions: CurriculumVersionSummary[];
  defaultVersion: CurriculumVersionContentResponse | null;
};

export type CurriculumVersionDiffEntry = {
  key: string;
  kind: "added" | "removed" | "changed";
  changedFields?: string[];
};

export type CurriculumVersionDiffResponse = {
  diff: {
    fromVersionId: string;
    againstVersionId: string;
    modules: CurriculumVersionDiffEntry[];
    nodes: CurriculumVersionDiffEntry[];
    edges: CurriculumVersionDiffEntry[];
    sources: CurriculumVersionDiffEntry[];
  };
};

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `curriculum-gen-${crypto.randomUUID()}`;
  }
  return `curriculum-gen-${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function assertJsonResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new ApiRequestError(formatApiErrorMessage(data, response.status), {
      ...getApiErrorMeta(data),
      status: response.status,
    });
  }

  return data as T;
}

export async function generateCurriculum(
  curriculumId: string,
  request: CurriculumBuildRequest,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<GenerateCurriculumResponse> {
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();

  const response = await fetch("/api/curricula/generate", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ curriculumId, ...request }),
    signal: options.signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as unknown;
    throw new ApiRequestError(formatApiErrorMessage(data, response.status), {
      ...getApiErrorMeta(data),
      status: response.status,
    });
  }

  const data = (await response.clone().json().catch(() => null)) as { runId?: unknown } | null;
  return { response, runId: typeof data?.runId === "string" ? data.runId : null };
}

export async function listCurricula() {
  if (curriculumListRequest) return curriculumListRequest;

  curriculumListRequest = readJsonApi<{ curricula: CurriculumDto[] }>("/api/curricula").finally(() => {
    curriculumListRequest = null;
  });
  return curriculumListRequest;
}

let curriculumListRequest: Promise<{ curricula: CurriculumDto[] }> | null = null;

export async function createCurriculum(input: {
  title: string;
  subject?: string;
  learningGoal: string;
}) {
  return readJsonApi<{ curriculum: CurriculumDto }>("/api/curricula", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getCurriculumGenerationQuota() {
  if (curriculumQuotaRequest) return curriculumQuotaRequest;

  curriculumQuotaRequest = readJsonApi<{ quota: CurriculumGenerationQuota }>(
    "/api/curricula/generate/quota",
  ).finally(() => {
    curriculumQuotaRequest = null;
  });
  return curriculumQuotaRequest;
}

let curriculumQuotaRequest: Promise<{ quota: CurriculumGenerationQuota }> | null = null;

export async function getAgentRun(
  runId: string,
  options: { signal?: AbortSignal } = {},
): Promise<GetRunResponse> {
  const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, {
    credentials: "same-origin",
    signal: options.signal,
  });
  return assertJsonResponse<GetRunResponse>(response);
}

export async function getAgentRunEvents(
  runId: string,
  afterSeq: number,
  options: { signal?: AbortSignal } = {},
): Promise<GetEventsResponse> {
  const url = new URL(`/api/agent-runs/${encodeURIComponent(runId)}/events`, window.location.origin);
  url.searchParams.set("after", String(afterSeq));

  const response = await fetch(url.toString(), {
    credentials: "same-origin",
    signal: options.signal,
  });
  return assertJsonResponse<GetEventsResponse>(response);
}

export async function cancelAgentRun(runId: string): Promise<CancelRunResponse> {
  const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
  return assertJsonResponse<CancelRunResponse>(response);
}

export async function resumeAgentRun(
  runId: string,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<ResumeRunResponse> {
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();

  const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as unknown;
    throw new ApiRequestError(formatApiErrorMessage(data, response.status), {
      ...getApiErrorMeta(data),
      status: response.status,
    });
  }

  return { response, runId };
}

export async function listCurriculumVersions(curriculumId: string) {
  return readJsonApi<{ versions: CurriculumVersionSummary[] }>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/versions`,
  );
}

const curriculumOverviewRequests = new Map<string, Promise<CurriculumOverviewResponse>>();

export function getCurriculumOverview(curriculumId: string) {
  const existing = curriculumOverviewRequests.get(curriculumId);
  if (existing) return existing;

  const request = readJsonApi<CurriculumOverviewResponse>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/overview`,
  ).finally(() => {
    curriculumOverviewRequests.delete(curriculumId);
  });
  curriculumOverviewRequests.set(curriculumId, request);
  return request;
}

const curriculumVersionRequests = new Map<string, Promise<CurriculumVersionContentResponse>>();

export async function getCurriculumVersion(
  curriculumId: string,
  versionId: string,
) {
  const key = `${curriculumId}:${versionId}`;
  const existing = curriculumVersionRequests.get(key);
  if (existing) return existing;

  const request = readJsonApi<CurriculumVersionContentResponse>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/versions/${encodeURIComponent(versionId)}`,
  ).finally(() => {
    curriculumVersionRequests.delete(key);
  });
  curriculumVersionRequests.set(key, request);
  return request;
}

export async function patchCurriculumVersion(
  curriculumId: string,
  versionId: string,
  patch: unknown,
) {
  return readJsonApi<CurriculumVersionContentResponse>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/versions/${encodeURIComponent(versionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

export async function deriveCurriculumVersion(curriculumId: string, versionId: string) {
  const key = `curriculum-derive-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  return readJsonApi<CurriculumVersionContentResponse>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/versions/${encodeURIComponent(versionId)}/derive`,
    {
      method: "POST",
      headers: { "Idempotency-Key": key },
    },
  );
}

export async function getCurriculumVersionDiff(
  curriculumId: string,
  versionId: string,
  againstVersionId: string,
) {
  const params = new URLSearchParams({ against: againstVersionId });
  return readJsonApi<CurriculumVersionDiffResponse>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/versions/${encodeURIComponent(versionId)}/diff?${params.toString()}`,
  );
}

export async function publishCurriculumVersion(
  curriculumId: string,
  versionId: string,
) {
  return readJsonApi<{ version: CurriculumVersionSummary }>(
    `/api/curricula/${encodeURIComponent(curriculumId)}/publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, confirmation: true }),
    },
  );
}
