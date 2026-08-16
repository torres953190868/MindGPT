// Model adapter for the dual-agent runtime (impact analysis D1: "JSON
// instruction + code-executed tools", no Vercel AI SDK). The model is
// instructed to output ONE JSON object matching a caller-supplied zod action
// schema; the caller (runner) parses, validates and acts on it. Non-streaming
// OpenAI-compatible chat-completions over the existing llm-router candidate
// resolution (default + fallback candidates, plan gating).
//
// This file is intentionally self-contained: deepseek.ts / deepseek-core.ts /
// deepseek-streaming.ts are NOT modified; only the mock-mode switch is shared
// (impact analysis D6: the whole agent chain reads AI_MOCK_MODE through this
// module instead of every layer reading env on its own).
//
// Validation contract: invalid model output is retried with the validation
// error fed back as a user message (up to MODEL_OUTPUT_CORRECTION_RETRIES
// corrections); still-invalid output throws
// AgentError(AGENT_INVALID_MODEL_OUTPUT). Transport/HTTP failures retry per
// candidate and then fall back to the next candidate, mirroring
// requestDeepSeekReply's policy.

import { z } from "zod";
import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { isAbortError, isDeepSeekMockMode } from "@/lib/server/deepseek-core";
import {
  getLlmProviderApiKey,
  getLlmRequestTimeoutMs,
  resolveLlmCandidates,
  type LlmRuntimeCandidate,
} from "@/lib/server/llm-router";
import type { LlmRouteTask } from "@/lib/types";

export type AgentModelMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentModelActionRequest<T> = {
  task: LlmRouteTask;
  systemPrompt: string;
  contextMessages: AgentModelMessage[];
  // The JSON shape the model MUST output; validated with zod.
  actionSchema: z.ZodType<T>;
  maxOutputTokens?: number;
  accountPlan?: string | null;
  signal?: AbortSignal;
  // Explicit caller-stamped stage key (e.g. the curriculum pipeline stage).
  // MockModelAdapter routes scripted entries on this instead of scraping
  // marker strings out of prompt text; real adapters ignore it.
  stage?: string;
};

export type AgentModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // Provider context-cache accounting (DeepSeek: prompt_cache_hit_tokens /
  // prompt_cache_miss_tokens; OpenAI-style fallback: prompt_tokens_details.
  // cached_tokens). Absent when the provider does not report cache usage.
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
};

export type AgentModelActionResult<T> = {
  action: T;
  usage: AgentModelUsage;
  provider: string;
  model: string;
};

export interface AgentModelAdapter {
  completeAction<T>(request: AgentModelActionRequest<T>): Promise<AgentModelActionResult<T>>;
}

// Appended to every agent system prompt: the model must answer with exactly
// one JSON object, nothing else (D1's "JSON instruction" contract).
export const JSON_ACTION_CONTRACT_PROMPT =
  "Output contract: respond with exactly one JSON object matching the action schema described " +
  "above. Do not output any other text — no prose, no explanations, no Markdown code fences.";

const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
const MODEL_OUTPUT_CORRECTION_RETRIES = 2;
const MAX_ATTEMPTS_PER_CANDIDATE = 2;
const RETRY_DELAY_MS = 300;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

// D6: one mock switch for the whole agent chain, honoring AI_MOCK_MODE (plus
// the legacy DeepSeek mock envs) exactly like the existing chat chain.
export function isAgentModelMockMode() {
  return isDeepSeekMockMode();
}

const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
      prompt_cache_hit_tokens: z.number().optional(),
      prompt_cache_miss_tokens: z.number().optional(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  error: z
    .object({
      message: z.string().optional(),
    })
    .optional(),
});

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildMessages<T>(request: AgentModelActionRequest<T>) {
  // The business prompt names the required fields, but some providers still
  // return a convenient-looking JSON shape (for example an array of query
  // strings) unless they receive the exact structure. Supplying the derived
  // JSON Schema makes the runtime validator's contract visible to the model.
  const actionSchema = JSON.stringify(z.toJSONSchema(request.actionSchema));
  return [
    {
      role: "system",
      content: `${request.systemPrompt.trim()}\n\n${JSON_ACTION_CONTRACT_PROMPT}\nRequired JSON Schema:\n${actionSchema}`,
    },
    ...request.contextMessages,
  ];
}

// Tolerates a single ```json fenced block; anything more exotic is treated
// as invalid and fed back through the correction loop.
function extractJsonText(content: string) {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function tryParseAction<T>(
  schema: z.ZodType<T>,
  content: string,
): { ok: true; action: T } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(content));
  } catch (error) {
    return {
      ok: false,
      error: `response is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `response JSON failed schema validation (${issues})` };
  }
  return { ok: true, action: result.data };
}

function buildCorrectionMessage(error: string) {
  return (
    `Your previous response was rejected: ${error}. ` +
    "Respond again with ONLY the corrected JSON object — no prose, no Markdown code fences."
  );
}

function extractUsage(usage: unknown): AgentModelUsage {
  const entry = (usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  const promptTokens = entry.prompt_tokens ?? 0;
  const completionTokens = entry.completion_tokens ?? 0;
  const cacheHitTokens = entry.prompt_cache_hit_tokens ?? entry.prompt_tokens_details?.cached_tokens;
  const cacheMissTokens =
    entry.prompt_cache_miss_tokens ??
    (typeof cacheHitTokens === "number" ? Math.max(0, promptTokens - cacheHitTokens) : undefined);
  return {
    promptTokens,
    completionTokens,
    totalTokens: entry.total_tokens ?? promptTokens + completionTokens,
    // Only stamp cache fields when the provider reports them, so providers
    // without context caching stay indistinguishable from a full miss.
    ...(typeof cacheHitTokens === "number"
      ? { promptCacheHitTokens: cacheHitTokens, promptCacheMissTokens: cacheMissTokens ?? 0 }
      : {}),
  };
}

function extractProviderErrorMessage(data: unknown) {
  const entry = (data ?? {}) as { error?: { message?: string } };
  return typeof entry.error?.message === "string" ? entry.error.message : null;
}

// ---------------------------------------------------------------------------
// Real adapter: non-streaming JSON chat-completions through llm-router.
// ---------------------------------------------------------------------------

export class LlmModelAdapter implements AgentModelAdapter {
  async completeAction<T>(
    request: AgentModelActionRequest<T>,
  ): Promise<AgentModelActionResult<T>> {
    const candidates = await resolveLlmCandidates(request.task, undefined, {
      requireJson: true,
      accountPlan: request.accountPlan ?? null,
    });

    let lastError: AgentError | null = null;
    for (const candidate of candidates) {
      try {
        return await this.completeWithCandidate(candidate, request);
      } catch (error) {
        if (!(error instanceof AgentError)) throw error;
        // Schema-contract violations are deterministic for this candidate —
        // surface them loudly instead of burning fallback quota.
        if (error.code === "AGENT_INVALID_MODEL_OUTPUT") throw error;
        lastError = error;
        if (!error.retryable) throw error;
      }
    }

    throw (
      lastError ??
      new AgentError("No AI model is available for this agent task.", {
        code: "AGENT_MODEL_CALL_FAILED",
        status: 502,
      })
    );
  }

  private async completeWithCandidate<T>(
    candidate: LlmRuntimeCandidate,
    request: AgentModelActionRequest<T>,
  ): Promise<AgentModelActionResult<T>> {
    const messages = buildMessages(request);
    let lastValidationError = "unknown validation failure";

    for (let attempt = 0; attempt <= MODEL_OUTPUT_CORRECTION_RETRIES; attempt += 1) {
      const { content, usage } = await this.fetchCompletion(candidate, messages, request);
      const parsed = tryParseAction(request.actionSchema, content);
      if (parsed.ok) {
        return {
          action: parsed.action,
          usage,
          provider: candidate.provider.providerId,
          model: candidate.model.model,
        };
      }

      lastValidationError = parsed.error;
      // Feed the invalid output and the rejection reason back so the model
      // can correct itself on the next round-trip.
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: buildCorrectionMessage(parsed.error) });
    }

    throw new AgentError(
      `Model output for task "${request.task}" failed validation after ${
        MODEL_OUTPUT_CORRECTION_RETRIES + 1
      } attempts: ${lastValidationError}`,
      {
        code: "AGENT_INVALID_MODEL_OUTPUT",
        retryable: false,
        status: 502,
        details: { task: request.task, error: lastValidationError },
      },
    );
  }

  private async fetchCompletion<T>(
    candidate: LlmRuntimeCandidate,
    messages: ReturnType<typeof buildMessages>,
    request: AgentModelActionRequest<T>,
  ): Promise<{ content: string; usage: AgentModelUsage }> {
    const provider = candidate.provider;
    const apiKey = getLlmProviderApiKey(provider);
    if (!apiKey) {
      throw new AgentError(`${provider.apiKeyEnv} is not configured.`, {
        code: `${provider.errorCodePrefix}_NOT_CONFIGURED`,
        status: 500,
      });
    }

    let lastError: AgentError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CANDIDATE; attempt += 1) {
      try {
        return await this.fetchOnce(candidate, apiKey, messages, request);
      } catch (error) {
        if (!(error instanceof AgentError)) throw error;
        lastError = error;
        if (!error.retryable || attempt >= MAX_ATTEMPTS_PER_CANDIDATE) throw error;
        await delay(RETRY_DELAY_MS);
      }
    }

    throw lastError;
  }

  private async fetchOnce<T>(
    candidate: LlmRuntimeCandidate,
    apiKey: string,
    messages: ReturnType<typeof buildMessages>,
    request: AgentModelActionRequest<T>,
  ): Promise<{ content: string; usage: AgentModelUsage }> {
    const provider = candidate.provider;
    const payload = {
      model: candidate.model.model,
      messages,
      response_format: { type: "json_object" },
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      stream: false,
      ...provider.payloadOptions,
    };

    // Always fetch with the internal controller so the provider timeout stays
    // armed; a caller-supplied signal (run cancellation, race timeout) is
    // forwarded into that same controller. Manual composition instead of
    // AbortSignal.any keeps this working on the oldest supported Node.
    const controller = new AbortController();
    const callerSignal = request.signal;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    const timeout = setTimeout(() => controller.abort(), getLlmRequestTimeoutMs(provider));

    let response: Response;
    try {
      response = await fetch(provider.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        // A caller-initiated abort is a cancellation, not a provider timeout:
        // it must not be retried or misreported as {PREFIX}_TIMEOUT.
        if (callerSignal?.aborted) {
          throw new AgentError(`${provider.displayName} request was cancelled.`, {
            code: "AGENT_RUN_CANCELLED",
            expose: true,
            retryable: false,
            status: 200,
          });
        }
        throw new AgentError(`${provider.displayName} request timed out.`, {
          code: `${provider.errorCodePrefix}_TIMEOUT`,
          expose: true,
          retryable: true,
          status: 504,
        });
      }
      throw new AgentError(`${provider.displayName} API request failed.`, {
        code: `${provider.errorCodePrefix}_NETWORK_ERROR`,
        retryable: true,
        status: 502,
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }

    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const providerMessage = extractProviderErrorMessage(data);
      throw new AgentError(
        `${provider.displayName} request failed (HTTP ${response.status})${
          providerMessage ? `: ${providerMessage}` : ""
        }`,
        {
          code: `${provider.errorCodePrefix}_HTTP_${response.status}`,
          retryable: RETRYABLE_STATUSES.has(response.status),
          status: response.status >= 500 ? 502 : response.status,
        },
      );
    }

    const parsed = completionResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AgentError(`${provider.displayName} returned an unreadable response.`, {
        code: "AGENT_MODEL_CALL_FAILED",
        retryable: true,
        status: 502,
      });
    }

    const content = parsed.data.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new AgentError(`${provider.displayName} returned an empty response.`, {
        code: `${provider.errorCodePrefix}_EMPTY_RESPONSE`,
        retryable: true,
        status: 502,
      });
    }

    return { content, usage: extractUsage(parsed.data.usage) };
  }
}

// ---------------------------------------------------------------------------
// Mock adapter (D6): deterministic, script-driven, zero network. The script
// is a consumed queue — each call takes the FIRST remaining matching entry.
// Routing precedence per entry: an explicit `stage` key matches on
// request.stage (decoupled from prompt copy; the curriculum mock script uses
// this), otherwise a `match` predicate runs (generic test infra), otherwise
// the entry matches everything. Registered actions are validated against the
// request's actionSchema, so a broken script fails loudly instead of leaking
// bad fixtures downstream.
// ---------------------------------------------------------------------------

export type MockActionScriptEntry = {
  // Preferred routing key: matched strictly against request.stage. Entries
  // with a stage key never match requests that carry no (or a different)
  // stage.
  stage?: string;
  match?: (request: AgentModelActionRequest<unknown>) => boolean;
  action: unknown;
  usage?: Partial<AgentModelUsage>;
};

export const MOCK_MODEL_USAGE: AgentModelUsage = {
  promptTokens: 128,
  completionTokens: 64,
  totalTokens: 192,
};

export class MockModelAdapter implements AgentModelAdapter {
  readonly provider = "mock";
  readonly model = "mock-model";
  // Every received request, in order — for test assertions.
  readonly calls: AgentModelActionRequest<unknown>[] = [];
  private readonly script: MockActionScriptEntry[];

  constructor(script: MockActionScriptEntry[] = []) {
    this.script = [...script];
  }

  enqueue(entry: MockActionScriptEntry) {
    this.script.push(entry);
  }

  async completeAction<T>(
    request: AgentModelActionRequest<T>,
  ): Promise<AgentModelActionResult<T>> {
    this.calls.push(request as AgentModelActionRequest<unknown>);

    const index = this.script.findIndex((entry) => {
      // Stage-keyed entries route on the explicit request stage only.
      if (entry.stage !== undefined) return entry.stage === request.stage;
      if (entry.match) return entry.match(request as AgentModelActionRequest<unknown>);
      return true;
    });
    if (index < 0) {
      throw new AgentError(
        `Mock model adapter script exhausted: no scripted action left for task "${request.task}" (call #${this.calls.length}).`,
        {
          code: "AGENT_MOCK_SCRIPT_EXHAUSTED",
          details: { task: request.task, callCount: this.calls.length },
        },
      );
    }

    const [entry] = this.script.splice(index, 1);
    const parsed = request.actionSchema.safeParse(entry.action);
    if (!parsed.success) {
      throw new AgentError(
        `Mock model adapter script action failed the actionSchema for task "${request.task}": ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
        {
          code: "AGENT_INVALID_MODEL_OUTPUT",
          details: { task: request.task },
        },
      );
    }

    return {
      action: parsed.data,
      usage: { ...MOCK_MODEL_USAGE, ...entry.usage },
      provider: this.provider,
      model: this.model,
    };
  }
}

// Convenience factory for runners (D6): in mock mode the caller MUST provide
// the deterministic script; outside mock mode the real adapter is used.
export function createAgentModelAdapter(options: {
  mockScript?: MockActionScriptEntry[];
} = {}): AgentModelAdapter {
  if (isAgentModelMockMode()) {
    return new MockModelAdapter(options.mockScript ?? []);
  }
  return new LlmModelAdapter();
}
