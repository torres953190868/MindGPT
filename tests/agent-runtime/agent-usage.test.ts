import { describe, expect, it } from "vitest";
import {
  aggregateModelCallUsage,
  createModelCallUsage,
  parseModelCostRates,
  summarizeTelemetryValue,
} from "@/lib/agent-runtime/agent-usage";

describe("agent usage telemetry", () => {
  it("parses valid cost rates and ignores malformed entries", () => {
    expect(parseModelCostRates(JSON.stringify({
      "deepseek/test": { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
      broken: { inputPerMillionTokens: -1, outputPerMillionTokens: 2 },
    }))).toEqual({
      "deepseek/test": { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
    });
    expect(parseModelCostRates("not-json")).toEqual({});
  });

  it("estimates model-call cost without storing prompt or response text", () => {
    const call = createModelCallUsage({
      provider: "DeepSeek",
      model: "test",
      promptTokens: 1_000,
      completionTokens: 500,
      durationMs: 42,
      rates: { "deepseek/test": { inputPerMillionTokens: 2, outputPerMillionTokens: 4 } },
    });

    expect(call).toMatchObject({
      provider: "DeepSeek",
      model: "test",
      totalTokens: 1_500,
      durationMs: 42,
      estimatedCostUsd: 0.004,
    });
    expect(aggregateModelCallUsage([call])).toMatchObject({
      promptTokens: 1_000,
      completionTokens: 500,
      totalTokens: 1_500,
      estimatedCostUsd: 0.004,
    });
  });

  it("prices cache-hit input tokens at the cache rate and aggregates cache totals", () => {
    const call = createModelCallUsage({
      provider: "DeepSeek",
      model: "test",
      promptTokens: 1_000,
      completionTokens: 0,
      durationMs: 1,
      cacheHitTokens: 800,
      rates: {
        "deepseek/test": {
          inputPerMillionTokens: 2,
          outputPerMillionTokens: 4,
          cacheHitInputPerMillionTokens: 0.5,
        },
      },
    });

    expect(call.cacheHitTokens).toBe(800);
    // Miss tokens default to prompt minus hit.
    expect(call.cacheMissTokens).toBe(200);
    // 200 miss × $2/M + 800 hit × $0.5/M = $0.0008.
    expect(call.estimatedCostUsd).toBeCloseTo(0.0008, 10);

    // A row persisted before cache tracking has no cache fields: it must
    // aggregate as zero, not NaN.
    const legacy = {
      provider: "DeepSeek",
      model: "test",
      promptTokens: 10,
      completionTokens: 1,
      totalTokens: 11,
      durationMs: 1,
      estimatedCostUsd: 0,
    } as unknown as Parameters<typeof aggregateModelCallUsage>[0][number];
    expect(aggregateModelCallUsage([call, legacy])).toMatchObject({
      promptTokens: 1_010,
      cacheHitTokens: 800,
      cacheMissTokens: 200,
    });
  });

  it("falls back to the standard input rate for hits when no cache rate is configured", () => {
    const call = createModelCallUsage({
      provider: "DeepSeek",
      model: "test",
      promptTokens: 1_000,
      completionTokens: 0,
      cacheHitTokens: 800,
      rates: { "deepseek/test": { inputPerMillionTokens: 2, outputPerMillionTokens: 4 } },
    });

    expect(call.estimatedCostUsd).toBeCloseTo(0.002, 10);
  });

  it("parses the optional cache-hit rate from cost-rate JSON", () => {
    expect(
      parseModelCostRates(
        JSON.stringify({
          "deepseek/test": {
            inputPerMillionTokens: 1,
            outputPerMillionTokens: 2,
            cacheHitInputPerMillionTokens: 0.25,
          },
        }),
      ),
    ).toEqual({
      "deepseek/test": {
        inputPerMillionTokens: 1,
        outputPerMillionTokens: 2,
        cacheHitInputPerMillionTokens: 0.25,
      },
    });
  });

  it("redacts sensitive and long telemetry values to hash plus length", () => {
    const summary = summarizeTelemetryValue({
      prompt: "do not persist this prompt",
      answer: "do not persist this answer",
      short: "safe label",
      long: "x".repeat(181),
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("do not persist");
    expect(summary.short).toBe("safe label");
    expect(summary.prompt).toMatchObject({ length: 26 });
    expect(summary.answer).toMatchObject({ length: 26 });
    expect(summary.long).toMatchObject({ length: 181 });
  });
});
