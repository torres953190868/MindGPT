import type { ChatModelSelection } from "@/lib/types";
import type {
  ChatModelCatalogResponse,
  ChatModelOption,
  NormalizedModelCatalog,
} from "./types";

export const FALLBACK_MODEL_SELECTION: ChatModelSelection = {
  providerId: "deepseek",
  model: "deepseek-v4-flash",
};

export const MODEL_SELECTION_STORAGE_KEY = "branchmind.chatModelSelection.v1";
export const MODEL_CATALOG_CACHE_KEY = "branchmind.chatModelCatalog.v1";
export const MODEL_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

export const FALLBACK_MODEL_OPTIONS: ChatModelOption[] = [
  {
    ...FALLBACK_MODEL_SELECTION,
    providerName: "DeepSeek",
    configured: true,
  },
];

export const CATALOG_PLACEHOLDER_MODEL_OPTIONS: ChatModelOption[] = [
  { providerId: "anthropic", providerName: "Anthropic", model: "claude-fable-5", configured: false, locked: true },
  { providerId: "anthropic", providerName: "Anthropic", model: "claude-opus-4.6", configured: false, locked: true },
  { providerId: "anthropic", providerName: "Anthropic", model: "claude-sonnet-5", configured: false, locked: true },
  { providerId: "openai", providerName: "OpenAI", model: "gpt-5.6-sol", configured: false, locked: true },
  { providerId: "openai", providerName: "OpenAI", model: "gpt-5.6-terra", configured: false, locked: true },
  { providerId: "openai", providerName: "OpenAI", model: "gpt-5.6-luna", configured: false, locked: true },
  { providerId: "moonshot", providerName: "Kimi", model: "kimi-k3", configured: false, locked: true },
  { providerId: "zhipu", providerName: "Z.ai", model: "glm-5.2", configured: false, locked: true },
];

export const AUTO_MODEL_SELECTION: ChatModelSelection = {
  providerId: "deepseek",
  model: "deepseek-v4-flash",
};

export const AUTO_STORAGE_SELECTION: ChatModelSelection = {
  providerId: "auto",
  model: "auto",
};

const MODEL_LABEL_PARTS: Record<string, string> = {
  claude: "Claude",
  deepseek: "DeepSeek",
  flash: "Flash",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  kimi: "Kimi",
  mimo: "Mimo",
  omni: "Omni",
  plus: "Plus",
  pro: "Pro",
  qwen: "Qwen",
  reasoner: "Reasoner",
};

const MODEL_LABEL_OVERRIDES: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "glm-5.1": "GLM 5.1",
  "glm-5.2": "GLM 5.2",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "kimi-k2.6": "Kimi K2.6",
  "kimi-k3": "Kimi K3",
  "mimo-v2.5-pro": "MiMo V2.5 Pro",
  "qwen3.6-plus": "Qwen 3.6 Plus",
};

const MODEL_DISPLAY_PRIORITY: Record<string, number> = {
  "claude-fable-5": 10,
  "claude-opus-4.6": 20,
  "claude-sonnet-5": 30,
  "gpt-5.6-sol": 40,
  "gpt-5.6-terra": 50,
  "gpt-5.6-luna": 60,
  "kimi-k3": 70,
  "glm-5.2": 80,
  "deepseek-v4-pro": 90,
  "kimi-k2.6": 100,
  "mimo-v2.5-pro": 110,
  "deepseek-v4-flash": 120,
  "glm-5.1": 130,
  "qwen3.6-plus": 140,
  "gemini-3.5-flash": 150,
};

export function formatModelLabel(model: string) {
  const override = MODEL_LABEL_OVERRIDES[model.toLowerCase()];
  if (override) return override;

  return model
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      const compactProviderMatch = part.match(
        /^(claude|deepseek|gemini|glm|gpt|kimi|mimo|qwen)(.+)$/i,
      );

      if (compactProviderMatch) {
        const [, provider, suffix] = compactProviderMatch;
        const providerLabel = MODEL_LABEL_PARTS[provider.toLowerCase()] ?? provider;
        return `${providerLabel} ${suffix.toUpperCase()}`;
      }

      const normalized = MODEL_LABEL_PARTS[part.toLowerCase()];
      if (normalized) return normalized;

      return /\d/.test(part)
        ? part.toUpperCase()
        : part[0]?.toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function matchesModelSelection(
  option: ChatModelSelection,
  selection: ChatModelSelection,
) {
  return option.providerId === selection.providerId && option.model === selection.model;
}

export function isStoredModelSelection(value: unknown): value is ChatModelSelection {
  if (!value || typeof value !== "object") return false;

  const selection = value as Partial<ChatModelSelection>;
  return (
    typeof selection.providerId === "string" &&
    selection.providerId.trim().length > 0 &&
    typeof selection.model === "string" &&
    selection.model.trim().length > 0
  );
}

export function readStoredModelSelection() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredModelSelection(parsed)) return null;

    return {
      providerId: parsed.providerId.trim(),
      model: parsed.model.trim(),
    };
  } catch {
    return null;
  }
}

export function isAutoModelSelection(selection: ChatModelSelection | null) {
  return (
    selection?.providerId === AUTO_STORAGE_SELECTION.providerId &&
    selection.model === AUTO_STORAGE_SELECTION.model
  );
}

export function writeStoredModelSelection(selection: ChatModelSelection) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      MODEL_SELECTION_STORAGE_KEY,
      JSON.stringify({
        providerId: selection.providerId,
        model: selection.model,
      }),
    );
  } catch {
    // The selected model still works for this send even if browser storage is unavailable.
  }
}

export function normalizeModelCatalog(
  data: ChatModelCatalogResponse | null,
): NormalizedModelCatalog | null {
  if (!data?.providers?.length) return null;

  const rawOptions: ChatModelOption[] = [
    ...data.providers.flatMap((provider) => [
      ...provider.models.map((model) => ({
        providerId: provider.id,
        providerName: provider.displayName,
        model,
        configured: provider.configured,
      })),
      ...(provider.lockedModels ?? []).map((model) => ({
        providerId: provider.id,
        providerName: provider.displayName,
        model,
        configured: provider.configured,
        locked: true,
      })),
    ]),
    ...CATALOG_PLACEHOLDER_MODEL_OPTIONS,
  ];

  const optionScore = (option: ChatModelOption) =>
    (option.locked ? 0 : 4) +
    (option.configured ? 2 : 0) +
    (option.providerId === "deepseek" ? 1 : 0);
  const optionsByModel = new Map<string, ChatModelOption>();
  rawOptions.forEach((option) => {
    const key = option.model.toLowerCase();
    const current = optionsByModel.get(key);
    if (!current || optionScore(option) > optionScore(current)) {
      optionsByModel.set(key, option);
    }
  });
  const options = Array.from(optionsByModel.values());

  options.sort((left, right) => {
    const leftPriority = MODEL_DISPLAY_PRIORITY[left.model.toLowerCase()] ?? 1_000;
    const rightPriority = MODEL_DISPLAY_PRIORITY[right.model.toLowerCase()] ?? 1_000;
    return leftPriority - rightPriority || left.model.localeCompare(right.model);
  });

  if (options.length === 0) return null;

  const responseDefault = data.defaultSelection;
  const availableOptions = options.filter((option) => !option.locked && option.configured);
  const defaultSelection =
    responseDefault &&
    availableOptions.some((option) => matchesModelSelection(option, responseDefault))
      ? responseDefault
      : availableOptions[0] ?? options[0];

  return {
    options,
    defaultSelection,
  };
}

export function readCachedModelCatalog() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(MODEL_CATALOG_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as {
      cachedAt?: unknown;
      catalog?: ChatModelCatalogResponse;
    };
    if (
      typeof cached.cachedAt !== "number" ||
      Date.now() - cached.cachedAt > MODEL_CATALOG_CACHE_TTL_MS
    ) {
      window.sessionStorage.removeItem(MODEL_CATALOG_CACHE_KEY);
      return null;
    }

    return normalizeModelCatalog(cached.catalog ?? null);
  } catch {
    return null;
  }
}

export function cacheModelCatalog(catalog: ChatModelCatalogResponse) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      MODEL_CATALOG_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), catalog }),
    );
  } catch {
    // Model selection remains available for this render if storage is unavailable.
  }
}
