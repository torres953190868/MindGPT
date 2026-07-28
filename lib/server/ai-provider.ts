export type ChatCompletionsProviderId = "deepseek" | "gemini";

export type ChatCompletionsProvider = {
  id: ChatCompletionsProviderId;
  displayName: string;
  url: string;
  urlEnv: string;
  apiKeyEnv: string;
  modelEnv: string;
  allowedModelsEnv: string;
  defaultModel: string;
  defaultAllowedModels: string[];
  errorCodePrefix: string;
  payloadOptions?: Record<string, unknown>;
};

export const DEEPSEEK_CHAT_COMPLETIONS_URL =
  "https://api.deepseek.com/chat/completions";
export const GEMINI_OPENAI_CHAT_COMPLETIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEFAULT_DEEPSEEK_ALLOWED_MODELS = [
  DEFAULT_DEEPSEEK_MODEL,
  "deepseek-v4-pro",
];

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const DEFAULT_GEMINI_ALLOWED_MODELS = [DEFAULT_GEMINI_MODEL];

export const CHAT_COMPLETIONS_PROVIDERS: Record<
  ChatCompletionsProviderId,
  ChatCompletionsProvider
> = {
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    url: DEEPSEEK_CHAT_COMPLETIONS_URL,
    urlEnv: "DEEPSEEK_URL",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    allowedModelsEnv: "DEEPSEEK_ALLOWED_MODELS",
    defaultModel: DEFAULT_DEEPSEEK_MODEL,
    defaultAllowedModels: DEFAULT_DEEPSEEK_ALLOWED_MODELS,
    errorCodePrefix: "DEEPSEEK",
    payloadOptions: { thinking: { type: "disabled" } },
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    url: GEMINI_OPENAI_CHAT_COMPLETIONS_URL,
    urlEnv: "GEMINI_URL",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    allowedModelsEnv: "GEMINI_ALLOWED_MODELS",
    defaultModel: DEFAULT_GEMINI_MODEL,
    defaultAllowedModels: DEFAULT_GEMINI_ALLOWED_MODELS,
    errorCodePrefix: "GEMINI",
  },
};

export function splitEnvList(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export function getConfiguredProviderId() {
  return (process.env.AI_PROVIDER ?? "deepseek").trim().toLowerCase();
}

export function getChatCompletionsProvider(id = getConfiguredProviderId()) {
  return CHAT_COMPLETIONS_PROVIDERS[id as ChatCompletionsProviderId] ?? null;
}

export function getProviderIds() {
  return Object.keys(CHAT_COMPLETIONS_PROVIDERS);
}

export function getProviderUrl(provider: ChatCompletionsProvider) {
  return (process.env[provider.urlEnv] ?? provider.url).trim();
}

export function getProviderApiKey(provider: ChatCompletionsProvider) {
  return process.env[provider.apiKeyEnv]?.trim() ?? "";
}

export function getProviderAllowedModels(provider: ChatCompletionsProvider) {
  const configured = splitEnvList(process.env[provider.allowedModelsEnv]);
  return new Set(configured.length ? configured : provider.defaultAllowedModels);
}
