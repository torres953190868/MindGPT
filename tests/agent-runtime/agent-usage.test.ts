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
