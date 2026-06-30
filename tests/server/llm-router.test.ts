import { afterEach, describe, expect, it, vi } from "vitest";
import { type PlanModelAccess } from "@/lib/server/account-plan";
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

function createFreePlanConfig(): LlmConfigBundle {
  return {
    source: "supabase",
    providers: [
      {
        providerId: "deepseek",
        displayName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/chat/completions",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        enabled: true,
        timeoutMs: null,
        payloadOptions: {},
        errorCodePrefix: "DEEPSEEK",
      },
      {
        providerId: "opencode-go",
        displayName: "OpenCode Go",
        baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
        apiKeyEnv: "OPENCODE_GO_API_KEY",
        enabled: true,
        timeoutMs: null,
        payloadOptions: {},
        errorCodePrefix: "OPENCODE_GO",
      },
    ],
    models: [
      {
        providerId: "deepseek",
        model: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        enabled: true,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 10,
      },
      {
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        enabled: true,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 20,
      },
      {
        providerId: "opencode-go",
        model: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        enabled: true,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 10,
      },
      {
        providerId: "opencode-go",
        model: "qwen3.6-plus",
        displayName: "Qwen 3.6 Plus",
        enabled: true,
        supportsStreaming: true,
        supportsJson: true,
        notes: null,
        sortOrder: 20,
      },
    ],
    routes: [
      {
        task: "branch_chat",
        defaultProviderId: "deepseek",
        defaultModel: "deepseek-v4-flash",
        fallbackProviderId: "opencode-go",
        fallbackModel: "deepseek-v4-pro",
      },
      {
        task: "node_generation",
        defaultProviderId: "deepseek",
        defaultModel: "deepseek-v4-flash",
        fallbackProviderId: "opencode-go",
        fallbackModel: "qwen3.6-plus",
      },
      {
        task: "pdf_qa",
        defaultProviderId: "deepseek",
        defaultModel: "deepseek-v4-flash",
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

  it("limits free plan catalogs to official DeepSeek V4 models", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

    const catalog = getLlmChatModelCatalogFromConfig(createFreePlanConfig(), "free");

    expect(catalog.defaultSelection).toEqual({
      providerId: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(catalog.providers).toEqual([
      {
        id: "deepseek",
        displayName: "DeepSeek",
        configured: true,
        models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      },
    ]);
  });

  it("rejects OpenCode Go selections for free plan users", () => {
    expect(() =>
      resolveLlmCandidatesFromConfig(
        createFreePlanConfig(),
        "branch_chat",
        { providerId: "opencode-go", model: "deepseek-v4-pro" },
        { requireJson: true, accountPlan: "free" },
      ),
    ).toThrow(expect.objectContaining({
      message: "Selected AI model is not available on the free plan.",
      code: "PLAN_MODEL_NOT_ALLOWED",
      status: 403,
    }));
  });

  it("removes non-free fallbacks while keeping the official DeepSeek default", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

    const candidates = resolveLlmCandidatesFromConfig(
      createFreePlanConfig(),
      "branch_chat",
      undefined,
      { requireJson: true, accountPlan: "free" },
    );

    expect(
      candidates.map((candidate) => ({
        provider: candidate.provider.providerId,
        model: candidate.model.model,
      })),
    ).toEqual([
      {
        provider: "deepseek",
        model: "deepseek-v4-flash",
      },
    ]);
  });

  it("returns PLAN_MODEL_NOT_ALLOWED 403 when free plan route has no allowed candidates", () => {
    const blockedConfig: LlmConfigBundle = {
      ...createFreePlanConfig(),
      routes: [
        {
          task: "branch_chat",
          defaultProviderId: "opencode-go",
          defaultModel: "qwen3.6-plus",
          fallbackProviderId: "opencode-go",
          fallbackModel: "deepseek-v4-pro",
        },
        ...createFreePlanConfig().routes.filter((route) => route.task !== "branch_chat"),
      ],
    };

    expect(() =>
      resolveLlmCandidatesFromConfig(
        blockedConfig,
        "branch_chat",
        undefined,
        { requireJson: true, accountPlan: "free" },
      ),
    ).toThrow(
      expect.objectContaining({
        message: "No AI model for this task is available on the free plan.",
        code: "PLAN_MODEL_NOT_ALLOWED",
        status: 403,
      }),
    );
  });

  it("falls back normally for unrestricted plans when the primary candidate is unavailable", () => {
    vi.stubEnv("PRIMARY_KEY", "primary-key");
    vi.stubEnv("FALLBACK_KEY", "fallback-key");

    const candidates = resolveLlmCandidatesFromConfig(
      createConfig(),
      "branch_chat",
      undefined,
      { requireJson: true, accountPlan: "pro" },
    );

    expect(candidates.map((candidate) => candidate.model.model)).toEqual([
      "fast",
      "steady",
    ]);
  });

  it("falls back normally when no account plan context is provided", () => {
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

  it("treats null and undefined account plans as unrestricted", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

    const nullCatalog = getLlmChatModelCatalogFromConfig(createFreePlanConfig(), null);
    const undefinedCatalog = getLlmChatModelCatalogFromConfig(
      createFreePlanConfig(),
      undefined,
    );

    expect(nullCatalog.providers.map((provider) => provider.id)).toEqual([
      "deepseek",
      "opencode-go",
    ]);
    expect(undefinedCatalog).toEqual(nullCatalog);
  });

  it("returns LLM_ROUTE_NOT_AVAILABLE 500 for genuine missing route configuration", () => {
    const configWithoutPdfQa: LlmConfigBundle = {
      ...createConfig(),
      routes: createConfig().routes.filter((route) => route.task !== "pdf_qa"),
    };

    expect(() =>
      resolveLlmCandidatesFromConfig(
        configWithoutPdfQa,
        "pdf_qa",
        undefined,
        { requireJson: true, accountPlan: "pro" },
      ),
    ).toThrow(
      expect.objectContaining({
        message: "No configured AI model is available for this task.",
        code: "LLM_ROUTE_NOT_AVAILABLE",
        status: 500,
      }),
    );
  });

  it("uses DB-backed planModelAccess to allow only configured free-plan models", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

    const access: PlanModelAccess[] = [
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-flash" },
    ];

    const catalog = getLlmChatModelCatalogFromConfig(
      createFreePlanConfig(),
      "free",
      access,
    );

    expect(catalog.defaultSelection).toEqual({
      providerId: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(catalog.providers).toEqual([
      {
        id: "deepseek",
        displayName: "DeepSeek",
        configured: true,
        models: ["deepseek-v4-flash"],
      },
    ]);
  });

  it("rejects a free-plan model that is not in planModelAccess", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");

    const access: PlanModelAccess[] = [
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-flash" },
    ];

    expect(() =>
      resolveLlmCandidatesFromConfig(
        createFreePlanConfig(),
        "branch_chat",
        { providerId: "deepseek", model: "deepseek-v4-pro" },
        { requireJson: true, accountPlan: "free", planModelAccess: access },
      ),
    ).toThrow(
      expect.objectContaining({
        message: "Selected AI model is not available on the free plan.",
        code: "PLAN_MODEL_NOT_ALLOWED",
        status: 403,
      }),
    );
  });

  it("rejects non-DeepSeek providers even when planModelAccess is empty", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

    expect(() =>
      resolveLlmCandidatesFromConfig(
        createFreePlanConfig(),
        "branch_chat",
        { providerId: "opencode-go", model: "deepseek-v4-pro" },
        { requireJson: true, accountPlan: "free", planModelAccess: [] },
      ),
    ).toThrow(
      expect.objectContaining({
        message: "Selected AI model is not available on the free plan.",
        code: "PLAN_MODEL_NOT_ALLOWED",
        status: 403,
      }),
    );
  });

  it("leaves unrestricted plan behavior unchanged when planModelAccess is provided", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");

    const access: PlanModelAccess[] = [
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-flash" },
    ];

    const candidates = resolveLlmCandidatesFromConfig(
      createFreePlanConfig(),
      "branch_chat",
      undefined,
      { requireJson: true, accountPlan: "pro", planModelAccess: access },
    );

    expect(
      candidates.map((candidate) => ({
        provider: candidate.provider.providerId,
        model: candidate.model.model,
      })),
    ).toEqual([
      { provider: "deepseek", model: "deepseek-v4-flash" },
      { provider: "opencode-go", model: "deepseek-v4-pro" },
    ]);
  });
});
