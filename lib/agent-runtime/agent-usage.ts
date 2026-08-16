import { createHash } from "node:crypto";
import { z } from "zod";

/** Safe telemetry for one model call. It deliberately contains no prompt or response text. */
export type ModelCallUsage = {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // Provider context-cache accounting; 0 when the provider does not report it.
  cacheHitTokens: number;
  cacheMissTokens: number;
  durationMs: number;
  estimatedCostUsd: number;
};

export type ModelCostRate = {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  // Price for cache-hit input tokens (e.g. DeepSeek context-cache hits are
  // billed far below the standard input price). Falls back to the standard
  // input rate when absent.
  cacheHitInputPerMillionTokens?: number;
};

export type ModelCostRates = Record<string, ModelCostRate>;

const rateSchema = z.object({
  inputPerMillionTokens: z.number().finite().nonnegative(),
  outputPerMillionTokens: z.number().finite().nonnegative(),
  cacheHitInputPerMillionTokens: z.number().finite().nonnegative().optional(),
});

const DEFAULT_RATE: ModelCostRate = {
  inputPerMillionTokens: 0,
  outputPerMillionTokens: 0,
};

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseModelCostRates(raw: string | undefined): ModelCostRates {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const rates: ModelCostRates = {};
    for (const [key, value] of Object.entries(parsed)) {
      const result = rateSchema.safeParse(value);
      if (result.success) rates[key.trim().toLowerCase()] = result.data;
    }
    return rates;
  } catch {
    return {};
  }
}

export function getModelCostRate(
  provider: string,
  model: string,
  rates: ModelCostRates = parseModelCostRates(process.env.BRANCHMIND_LLM_COST_RATES_JSON),
): ModelCostRate {
  const providerKey = provider.trim().toLowerCase();
  const modelKey = model.trim().toLowerCase();
  return (
    rates[`${providerKey}/${modelKey}`] ??
    rates[modelKey] ??
    rates[providerKey] ??
    rates.default ??
    DEFAULT_RATE
  );
}

export function estimateModelCostUsd(
  input: Pick<ModelCallUsage, "promptTokens" | "completionTokens" | "cacheHitTokens">,
  rate: ModelCostRate,
) {
  const promptTokens = finiteNonNegative(input.promptTokens);
  // Cache-hit tokens are billed at the (cheaper) hit rate; everything else is
  // a miss charged at the standard input rate.
  const cacheHitTokens = Math.min(finiteNonNegative(input.cacheHitTokens), promptTokens);
  const cacheMissTokens = promptTokens - cacheHitTokens;
  const cacheHitRate = rate.cacheHitInputPerMillionTokens ?? rate.inputPerMillionTokens;
  return (
    (cacheMissTokens * finiteNonNegative(rate.inputPerMillionTokens) +
      cacheHitTokens * finiteNonNegative(cacheHitRate)) / 1_000_000 +
    finiteNonNegative(input.completionTokens) * finiteNonNegative(rate.outputPerMillionTokens) / 1_000_000
  );
}

export function createModelCallUsage(input: {
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  durationMs?: number;
  rates?: ModelCostRates;
}): ModelCallUsage {
  const promptTokens = finiteNonNegative(input.promptTokens ?? 0);
  const completionTokens = finiteNonNegative(input.completionTokens ?? 0);
  const totalTokens = finiteNonNegative(input.totalTokens ?? promptTokens + completionTokens);
  const cacheHitTokens = finiteNonNegative(input.cacheHitTokens ?? 0);
  const cacheMissTokens = finiteNonNegative(
    input.cacheMissTokens ?? Math.max(0, promptTokens - cacheHitTokens),
  );
  return {
    provider: input.provider,
    model: input.model,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
    durationMs: finiteNonNegative(input.durationMs ?? 0),
    estimatedCostUsd: estimateModelCostUsd(
      { promptTokens, completionTokens, cacheHitTokens },
      getModelCostRate(input.provider, input.model, input.rates),
    ),
  };
}

export function aggregateModelCallUsage(calls: readonly ModelCallUsage[]) {
  return calls.reduce(
    (total, call) => ({
      promptTokens: total.promptTokens + call.promptTokens,
      completionTokens: total.completionTokens + call.completionTokens,
      totalTokens: total.totalTokens + call.totalTokens,
      // Rows persisted before cache tracking lack these fields — count as 0.
      cacheHitTokens: total.cacheHitTokens + finiteNonNegative(call.cacheHitTokens),
      cacheMissTokens: total.cacheMissTokens + finiteNonNegative(call.cacheMissTokens),
      durationMs: total.durationMs + call.durationMs,
      estimatedCostUsd: total.estimatedCostUsd + call.estimatedCostUsd,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      durationMs: 0,
      estimatedCostUsd: 0,
    },
  );
}

export function hashTelemetryText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const SENSITIVE_TELEMETRY_KEYS = new Set([
  "prompt",
  "answer",
  "content",
  "excerpt",
  "markdown",
  "messages",
  "message",
  "code",
  "input_text",
  "output_text",
]);

/** Recursively keeps trace data useful while preventing prompt/answer bodies from being persisted. */
export function summarizeTelemetryValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    if (SENSITIVE_TELEMETRY_KEYS.has(key.toLowerCase()) || value.length > 180) {
      return { sha256: hashTelemetryText(value), length: value.length };
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => summarizeTelemetryValue(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 80).map(([childKey, childValue]) => [
        childKey,
        summarizeTelemetryValue(childValue, childKey, depth + 1),
      ]),
    );
  }
  return undefined;
}
