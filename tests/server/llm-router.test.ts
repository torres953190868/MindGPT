import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLlmChatModelCatalogFromConfig,
  resolveLlmCandidatesFromConfig,
  type LlmConfigBundle,
} from "@/lib/server/llm-router";

function createConfig(): LlmConfigBundle {
  return {
    source: "supabase",
    providers: [
      {
        providerId: "primary",
        displayName: "Primary",
        baseUrl: "https://primary.example/v1/chat/completions",
        apiKeyEnv: "PRIMARY_KEY",
        enabled: true,
        timeoutMs: null,
        payloadOptions: {},
        errorCodePrefix: "PRIMARY",
      },
      {
        providerId: "fallback",
        displayName: "Fallback",
        baseUrl: "https://fallback.example/v1/chat/completions",
        apiKeyEnv: "FALLBACK_KEY",
        enabled: true,
        timeoutMs: null,
        payloadOptions: {},
        errorCodePrefix: "FALLBACK",
      },
    ],
    models: [
      {
        providerId: "primary",
        model: "fast",
        displayName: "Fast",
        enabled: true,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 10,
      },
      {
        providerId: "fallback",
        model: "steady",
        displayName: "Steady",
        enabled: true,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 10,
      },
      {
        providerId: "primary",
        model: "disabled",
        displayName: "Disabled",
        enabled: false,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 20,
      },
    ],
    routes: [
      {
        task: "branch_chat",
        defaultProviderId: "primary",
        defaultModel: "fast",
        fallbackProviderId: "fallback",
        fallbackModel: "steady",
      },
      {
        task: "node_generation",
        defaultProviderId: "primary",
        defaultModel: "fast",
        fallbackProviderId: "fallback",
        fallbackModel: "steady",
      },
      {
        task: "pdf_qa",
        defaultProviderId: "primary",
        defaultModel: "fast",
        fallbackProviderId: null,
        fallbackModel: null,
      },
    ],
  };
}

describe("LLM router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves default and fallback candidates from config", () => {
    vi.stubEnv("PRIMARY_KEY", "primary-key");
    vi.stubEnv("FALLBACK_KEY", "fallback-key");

    const candidates = resolveLlmCandidatesFromConfig(
      createConfig(),
      "branch_chat",
      undefined,
      { requireJson: true },
    );

    expect(candidates.map((candidate) => candidate.model.model)).toEqual([
      "fast",
      "steady",
    ]);
  });

  it("rejects explicit disabled model selections", () => {
    expect(() =>
      resolveLlmCandidatesFromConfig(
        createConfig(),
        "branch_chat",
        { providerId: "primary", model: "disabled" },
        { requireJson: true },
      ),
    ).toThrow("Selected AI model is not allowed.");
  });

  it("omits providers without API keys from the public catalog", () => {
    vi.stubEnv("AI_MOCK_MODE", "false");
    vi.stubEnv("PRIMARY_KEY", "primary-key");
    vi.stubEnv("FALLBACK_KEY", "");

    const catalog = getLlmChatModelCatalogFromConfig(createConfig());

    expect(catalog.providers).toHaveLength(1);
    expect(catalog.providers[0].id).toBe("primary");
    expect(catalog.providers[0].models).toEqual(["fast"]);
  });
});
