import { HttpError } from "@/lib/server/http";
import {
  getPlanModelAccess,
  isAccountPlanModelRestricted,
  isModelAllowedByPlanAccess,
  isModelAllowedForAccountPlan,
  type PlanModelAccess,
} from "@/lib/server/account-plan";
import {
  CHAT_COMPLETIONS_PROVIDERS,
  getConfiguredProviderId,
  getProviderAllowedModels,
  getProviderUrl,
  splitEnvList,
} from "@/lib/server/ai-provider";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";
import type {
  ChatModelSelection,
  LlmModelConfig,
  LlmProviderConfig,
  LlmRouteConfig,
  LlmRouteTask,
} from "@/lib/types";

export const LLM_ROUTE_TASKS: LlmRouteTask[] = [
  "node_generation",
  "branch_chat",
  "pdf_qa",
];

export type LlmRuntimeProvider = LlmProviderConfig & {
  errorCodePrefix: string;
};

export type LlmRuntimeCandidate = {
  provider: LlmRuntimeProvider;
  model: LlmModelConfig;
  source: "explicit" | "default" | "fallback";
  task: LlmRouteTask;
};

export type LlmConfigBundle = {
  providers: LlmRuntimeProvider[];
  models: LlmModelConfig[];
  routes: LlmRouteConfig[];
  source: "supabase" | "static";
};

export type ChatModelCatalog = {
  defaultSelection: ChatModelSelection;
  providers: Array<{
    id: string;
    displayName: string;
    configured: boolean;
    models: string[];
    lockedModels: string[];
  }>;
};

type LlmResolveOptions = {
  requireConfigured?: boolean;
  requireStreaming?: boolean;
  requireJson?: boolean;
  accountPlan?: string | null;
  planModelAccess?: PlanModelAccess[];
};

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function isAiMockMode() {
  return (
    isEnabled(process.env.AI_MOCK_MODE) ||
    isEnabled(process.env.DEEPSEEK_MOCK_MODE) ||
    isEnabled(process.env.MOCK_DEEPSEEK) ||
    isEnabled(process.env.LLM_MOCK_MODE)
  );
}

function parseTimeoutMs(value: string | undefined) {
  if (!value) return null;
  const timeoutMs = Number(value.trim());
  return Number.isFinite(timeoutMs) && timeoutMs >= 1_000 ? timeoutMs : null;
}

function errorCodePrefix(providerId: string) {
  const prefix = providerId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return prefix || "LLM";
}

function objectPayloadOptions(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getStaticProviderTimeout(errorPrefix: string) {
  return (
    parseTimeoutMs(process.env[`${errorPrefix}_TIMEOUT_MS`]) ??
    parseTimeoutMs(process.env.AI_PROVIDER_TIMEOUT_MS)
  );
}

function getStaticProviders(): LlmRuntimeProvider[] {
  return Object.values(CHAT_COMPLETIONS_PROVIDERS).map((provider) => ({
    providerId: provider.id,
    displayName: provider.displayName,
    baseUrl: getProviderUrl(provider),
    apiKeyEnv: provider.apiKeyEnv,
    enabled: true,
    timeoutMs: getStaticProviderTimeout(provider.errorCodePrefix),
    payloadOptions: provider.payloadOptions ?? {},
    errorCodePrefix: provider.errorCodePrefix,
  }));
}

function getStaticModels(): LlmModelConfig[] {
  return Object.values(CHAT_COMPLETIONS_PROVIDERS).flatMap((provider) => {
    return [...getProviderAllowedModels(provider)].map((model, index) => ({
      providerId: provider.id,
      model,
      displayName: model,
      enabled: true,
      supportsStreaming: true,
      supportsJson: true,
      notes: null,
      sortOrder: (index + 1) * 10,
    }));
  });
}

function getStaticProviderDefaultModel(providerId: string, override?: string | null) {
  const provider = CHAT_COMPLETIONS_PROVIDERS[providerId as keyof typeof CHAT_COMPLETIONS_PROVIDERS];
  return (
    clean(override) ??
    clean(provider ? process.env[provider.modelEnv] : undefined) ??
    provider?.defaultModel ??
    ""
  );
}

function getStaticChatProviderId() {
  const configured = getConfiguredProviderId();
  return CHAT_COMPLETIONS_PROVIDERS[configured as keyof typeof CHAT_COMPLETIONS_PROVIDERS]
    ? configured
    : "deepseek";
}

function getStaticPdfProviderId() {
  const configured = (process.env.LLM_PROVIDER ?? process.env.AI_PROVIDER ?? "deepseek")
    .trim()
    .toLowerCase();
  return CHAT_COMPLETIONS_PROVIDERS[configured as keyof typeof CHAT_COMPLETIONS_PROVIDERS]
    ? configured
    : "deepseek";
}

function getStaticRoutes(): LlmRouteConfig[] {
  const chatProviderId = getStaticChatProviderId();
  const pdfProviderId = getStaticPdfProviderId();
  const fallbackProviderId = chatProviderId === "deepseek" ? "gemini" : "deepseek";

  return [
    {
      task: "branch_chat",
      defaultProviderId: chatProviderId,
      defaultModel: getStaticProviderDefaultModel(chatProviderId),
      fallbackProviderId,
      fallbackModel: getStaticProviderDefaultModel(fallbackProviderId),
    },
    {
      task: "node_generation",
      defaultProviderId: chatProviderId,
      defaultModel: getStaticProviderDefaultModel(chatProviderId),
      fallbackProviderId,
      fallbackModel: getStaticProviderDefaultModel(fallbackProviderId),
    },
    {
      task: "pdf_qa",
      defaultProviderId: pdfProviderId,
      defaultModel: getStaticProviderDefaultModel(pdfProviderId, process.env.LLM_MODEL),
      fallbackProviderId,
      fallbackModel: getStaticProviderDefaultModel(fallbackProviderId),
    },
  ];
}

export function getStaticLlmConfig(): LlmConfigBundle {
  return {
    providers: getStaticProviders(),
    models: getStaticModels(),
    routes: getStaticRoutes(),
    source: "static",
  };
}

function providerFromRow(row: {
  provider_id: string;
  display_name: string;
  base_url: string;
  api_key_env: string;
  enabled: boolean;
  timeout_ms: number | null;
  payload_options: unknown;
}): LlmRuntimeProvider {
  return {
    providerId: row.provider_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    apiKeyEnv: row.api_key_env,
    enabled: row.enabled,
    timeoutMs: row.timeout_ms,
    payloadOptions: objectPayloadOptions(row.payload_options),
    errorCodePrefix: errorCodePrefix(row.provider_id),
  };
}

function modelFromRow(row: {
  provider_id: string;
  model: string;
  display_name: string;
  enabled: boolean;
  supports_streaming: boolean;
  supports_json: boolean;
  notes: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}): LlmModelConfig {
  return {
    providerId: row.provider_id,
    model: row.model,
    displayName: row.display_name,
    enabled: row.enabled,
    supportsStreaming: row.supports_streaming,
    supportsJson: row.supports_json,
    notes: row.notes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function routeFromRow(row: {
  task: LlmRouteTask;
  default_provider_id: string;
  default_model: string;
  fallback_provider_id: string | null;
  fallback_model: string | null;
  updated_at?: string;
}): LlmRouteConfig {
  return {
    task: row.task,
    defaultProviderId: row.default_provider_id,
    defaultModel: row.default_model,
    fallbackProviderId: row.fallback_provider_id,
    fallbackModel: row.fallback_model,
    updatedAt: row.updated_at,
  };
}

async function getSupabaseLlmConfig(): Promise<LlmConfigBundle> {
  const supabase = getSupabaseAdminClient();
  const [providersResult, modelsResult, routesResult] = await Promise.all([
    supabase
      .from("branchmind_llm_providers")
      .select("*")
      .order("provider_id", { ascending: true }),
    supabase
      .from("branchmind_llm_models")
      .select("*")
      .order("provider_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("model", { ascending: true }),
    supabase.from("branchmind_llm_routes").select("*"),
  ]);

  if (providersResult.error) throw providersResult.error;
  if (modelsResult.error) throw modelsResult.error;
  if (routesResult.error) throw routesResult.error;

  return {
    providers: (providersResult.data ?? []).map(providerFromRow),
    models: (modelsResult.data ?? []).map(modelFromRow),
    routes: (routesResult.data ?? []).map(routeFromRow),
    source: "supabase",
  };
}

export async function getLlmConfig(options: { fallbackOnError?: boolean } = {}) {
  if (!hasSupabaseServerConfig()) return getStaticLlmConfig();

  try {
    return await getSupabaseLlmConfig();
  } catch (error) {
    if (options.fallbackOnError ?? true) return getStaticLlmConfig();
    throw error;
  }
}

function getProvider(bundle: LlmConfigBundle, providerId: string) {
  return bundle.providers.find((provider) => provider.providerId === providerId) ?? null;
}

function getModel(bundle: LlmConfigBundle, providerId: string, model: string) {
  return (
    bundle.models.find(
      (item) => item.providerId === providerId && item.model === model,
    ) ?? null
  );
}

function isProviderConfigured(provider: LlmRuntimeProvider) {
  return isAiMockMode() || Boolean(process.env[provider.apiKeyEnv]?.trim());
}

function createCandidate(
  bundle: LlmConfigBundle,
  task: LlmRouteTask,
  providerId: string,
  modelId: string,
  source: LlmRuntimeCandidate["source"],
  options: LlmResolveOptions,
) {
  const provider = getProvider(bundle, providerId);
  const model = getModel(bundle, providerId, modelId);
  if (!provider || !model) return null;
  if (!provider.enabled || !model.enabled) return null;
  const planModelAccess = options.planModelAccess;
  if (isAccountPlanModelRestricted(options.accountPlan)) {
    if (planModelAccess && planModelAccess.length > 0) {
      if (!isModelAllowedByPlanAccess(planModelAccess, providerId, modelId)) return null;
    } else if (!isModelAllowedForAccountPlan(options.accountPlan, providerId, modelId)) {
      return null;
    }
  }
  if (options.requireConfigured && !isProviderConfigured(provider)) return null;
  if (options.requireStreaming && !model.supportsStreaming) return null;
  if (options.requireJson && !model.supportsJson) return null;
  return { provider, model, source, task };
}

function unavailableExplicitSelectionError(
  message = "Selected AI model is not allowed.",
  code = "LLM_MODEL_NOT_ALLOWED",
) {
  return new HttpError(message, {
    code,
    expose: true,
    status: 400,
  });
}

export function resolveLlmCandidatesFromConfig(
  bundle: LlmConfigBundle,
  task: LlmRouteTask,
  selection?: ChatModelSelection,
  options: LlmResolveOptions = {},
): LlmRuntimeCandidate[] {
  if (selection) {
    const providerId = selection.providerId.trim().toLowerCase();
    const modelId = selection.model.trim();
    const provider = getProvider(bundle, providerId);
    if (!provider || !provider.enabled) {
      throw unavailableExplicitSelectionError(
        "Selected AI provider is not supported.",
        "AI_PROVIDER_NOT_SUPPORTED",
      );
    }

    const model = getModel(bundle, providerId, modelId);
    if (!model || !model.enabled) {
      throw unavailableExplicitSelectionError(
        "Selected AI model is not allowed.",
        `${provider.errorCodePrefix}_MODEL_NOT_ALLOWED`,
      );
    }
    if (isAccountPlanModelRestricted(options.accountPlan)) {
      const planModelAccess = options.planModelAccess;
      const allowed = planModelAccess && planModelAccess.length > 0
        ? isModelAllowedByPlanAccess(planModelAccess, providerId, modelId)
        : isModelAllowedForAccountPlan(options.accountPlan, providerId, modelId);
      if (!allowed) {
        throw new HttpError("Selected AI model is not available on the free plan.", {
          code: "PLAN_MODEL_NOT_ALLOWED",
          expose: true,
          status: 403,
        });
      }
    }
    if (options.requireStreaming && !model.supportsStreaming) {
      throw unavailableExplicitSelectionError(
        "Selected AI model does not support streaming.",
        `${provider.errorCodePrefix}_MODEL_NOT_ALLOWED`,
      );
    }
    if (options.requireJson && !model.supportsJson) {
      throw unavailableExplicitSelectionError(
        "Selected AI model does not support JSON responses.",
        `${provider.errorCodePrefix}_MODEL_NOT_ALLOWED`,
      );
    }

    return [{ provider, model, source: "explicit", task }];
  }

  const route = bundle.routes.find((item) => item.task === task);
  const candidates: LlmRuntimeCandidate[] = [];
  if (route) {
    const defaultProvider = getProvider(bundle, route.defaultProviderId);
    if (defaultProvider && !getModel(bundle, route.defaultProviderId, route.defaultModel)) {
      throw new HttpError(
        `Configured ${defaultProvider.displayName} model is not allowed.`,
        {
          code: `${defaultProvider.errorCodePrefix}_MODEL_NOT_ALLOWED`,
          status: 500,
        },
      );
    }

    const primary = createCandidate(
      bundle,
      task,
      route.defaultProviderId,
      route.defaultModel,
      "default",
      options,
    );
    if (primary) candidates.push(primary);

    if (route.fallbackProviderId && route.fallbackModel) {
      const fallback = createCandidate(
        bundle,
        task,
        route.fallbackProviderId,
        route.fallbackModel,
        "fallback",
        { ...options, requireConfigured: true },
      );
      if (
        fallback &&
        !candidates.some(
          (candidate) =>
            candidate.provider.providerId === fallback.provider.providerId &&
            candidate.model.model === fallback.model.model,
        )
      ) {
        candidates.push(fallback);
      }
    }

    if (candidates.length === 0) {
      if (isAccountPlanModelRestricted(options.accountPlan)) {
        throw new HttpError(
          "No AI model for this task is available on the free plan.",
          {
            code: "PLAN_MODEL_NOT_ALLOWED",
            expose: true,
            status: 403,
          },
        );
      }
      throw new HttpError("No configured AI model is available for this task.", {
        code: "LLM_ROUTE_NOT_AVAILABLE",
        status: 500,
      });
    }
  }

  if (candidates.length > 0) return candidates;

  if (isAccountPlanModelRestricted(options.accountPlan)) {
    throw new HttpError(
      "No AI model for this task is available on the free plan.",
      {
        code: "PLAN_MODEL_NOT_ALLOWED",
        expose: true,
        status: 403,
      },
    );
  }

  const firstAvailable = bundle.models
    .sort((left, right) => left.sortOrder - right.sortOrder || left.model.localeCompare(right.model))
    .map((model) =>
      createCandidate(bundle, task, model.providerId, model.model, "default", {
        ...options,
        requireConfigured: true,
      }),
    )
    .find((candidate): candidate is LlmRuntimeCandidate => Boolean(candidate));

  if (firstAvailable) return [firstAvailable];

  throw new HttpError("No configured AI model is available for this task.", {
    code: "LLM_ROUTE_NOT_AVAILABLE",
    status: 500,
  });
}

export async function resolveLlmCandidates(
  task: LlmRouteTask,
  selection?: ChatModelSelection,
  options: LlmResolveOptions = {},
) {
  const planModelAccess = isAccountPlanModelRestricted(options.accountPlan)
    ? await getPlanModelAccess(options.accountPlan)
    : [];
  return resolveLlmCandidatesFromConfig(
    await getLlmConfig(),
    task,
    selection,
    { ...options, planModelAccess },
  );
}

export function getLlmProviderApiKey(provider: LlmRuntimeProvider) {
  return process.env[provider.apiKeyEnv]?.trim() ?? "";
}

export function requireLlmProviderApiKey(provider: LlmRuntimeProvider) {
  const apiKey = getLlmProviderApiKey(provider);
  if (apiKey || isAiMockMode()) return apiKey;

  throw new HttpError(`${provider.apiKeyEnv} is not configured.`, {
    code: `${provider.errorCodePrefix}_NOT_CONFIGURED`,
    status: 500,
  });
}

export function getLlmRequestTimeoutMs(provider: LlmRuntimeProvider) {
  return (
    provider.timeoutMs ??
    parseTimeoutMs(process.env[`${provider.errorCodePrefix}_TIMEOUT_MS`]) ??
    parseTimeoutMs(process.env.AI_PROVIDER_TIMEOUT_MS) ??
    30_000
  );
}

export function getLlmChatModelCatalogFromConfig(
  bundle: LlmConfigBundle,
  accountPlan?: string | null,
  planModelAccess?: PlanModelAccess[],
): ChatModelCatalog {
  let defaultSelection: LlmRuntimeCandidate;
  try {
    defaultSelection = resolveLlmCandidatesFromConfig(
      bundle,
      "branch_chat",
      undefined,
      {
        requireConfigured: true,
        requireJson: true,
        accountPlan,
        planModelAccess,
      },
    )[0];
  } catch {
    defaultSelection = resolveLlmCandidatesFromConfig(
      bundle,
      "branch_chat",
      undefined,
      { requireJson: true, accountPlan, planModelAccess },
    )[0];
  }

  const accessList = planModelAccess;
  const hasPlanAccess =
    isAccountPlanModelRestricted(accountPlan) && accessList && accessList.length > 0;
  const isModelAllowed = (providerId: string, model: string) =>
    hasPlanAccess
      ? isModelAllowedByPlanAccess(accessList, providerId, model)
      : isModelAllowedForAccountPlan(accountPlan, providerId, model);

  return {
    defaultSelection: {
      providerId: defaultSelection.provider.providerId,
      model: defaultSelection.model.model,
    },
    providers: bundle.providers
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.providerId,
        displayName: provider.displayName,
        configured: isProviderConfigured(provider),
        models: bundle.models
          .filter(
            (model) =>
              model.providerId === provider.providerId &&
              model.enabled &&
              model.supportsJson &&
              isModelAllowed(model.providerId, model.model),
          )
          .sort((left, right) => left.sortOrder - right.sortOrder || left.model.localeCompare(right.model))
          .map((model) => model.model),
        lockedModels: bundle.models
          .filter(
            (model) =>
              model.providerId === provider.providerId &&
              model.enabled &&
              model.supportsJson &&
              !isModelAllowed(model.providerId, model.model),
          )
          .sort((left, right) => left.sortOrder - right.sortOrder || left.model.localeCompare(right.model))
          .map((model) => model.model),
      }))
      .filter(
        (provider) =>
          (provider.models.length > 0 || provider.lockedModels.length > 0),
      ),
  };
}

export async function getLlmChatModelCatalog(accountPlan?: string | null) {
  const planModelAccess = isAccountPlanModelRestricted(accountPlan)
    ? await getPlanModelAccess(accountPlan)
    : [];
  return getLlmChatModelCatalogFromConfig(await getLlmConfig(), accountPlan, planModelAccess);
}

export async function getAdminLlmConfig() {
  return getLlmConfig();
}

export function getAllowedProviderIdsFromEnv(providerId: string) {
  const provider = CHAT_COMPLETIONS_PROVIDERS[providerId as keyof typeof CHAT_COMPLETIONS_PROVIDERS];
  return provider ? splitEnvList(process.env[provider.allowedModelsEnv]) : [];
}
