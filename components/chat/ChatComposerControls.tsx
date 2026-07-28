"use client";

import {
  type ChangeEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Check,
  Infinity as InfinityIcon,
  Loader2,
  LockKeyhole,
  Paperclip,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  getHighlightedActionClass,
  useHighlightedAction,
} from "@/components/ui/highlighted-action";
import { ApiRequestError, readJsonApi } from "@/lib/client/api";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import {
  addStoredChatSkill,
  isDefaultChatSkill,
  readAvailableChatSkills,
  removeStoredChatSkill,
  validateChatSkillForSend,
  type ParsedChatSkill,
} from "@/lib/chat-skills";
import { createId } from "@/lib/ids";
import type { ChatAttachment, ChatModelSelection, ChatSkill } from "@/lib/types";

type ChatModelOption = ChatModelSelection & {
  providerName: string;
  configured: boolean;
  locked?: boolean;
};

type ChatModelCatalogResponse = {
  defaultSelection?: ChatModelSelection;
  providers?: Array<{
    id: string;
    displayName: string;
    configured: boolean;
    models: string[];
    lockedModels?: string[];
  }>;
};

type DocumentStatus = NonNullable<ChatAttachment["documentStatus"]>;

type PendingAttachmentStatus = "queued" | "uploading" | "indexing" | "indexed" | "failed";

export type PendingChatAttachment = ChatAttachment & {
  file?: File;
  uploadStatus?: PendingAttachmentStatus;
};

type UploadedDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  status: DocumentStatus;
  errorMessage: string | null;
  errorRequestId: string | null;
};

type KnowledgeDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
  errorRequestId: string | null;
  updatedAt: string;
};

type UploadPdfResponse = {
  document: UploadedDocument;
  job?: {
    action: "parse" | "index";
    documentId: string;
    messageId: string | null;
    requestId: string;
    topic: string;
  };
};

type IndexPdfResponse = {
  job: {
    action: "parse" | "index";
    documentId: string;
    messageId: string | null;
    requestId: string;
    topic: string;
  };
};

type DocumentDetailsResponse = {
  document: UploadedDocument;
};

type DocumentsResponse = {
  documents: KnowledgeDocument[];
};

const FALLBACK_MODEL_SELECTION: ChatModelSelection = {
  providerId: "deepseek",
  model: "deepseek-v4-flash",
};

const MODEL_SELECTION_STORAGE_KEY = "branchmind.chatModelSelection.v1";
const MODEL_CATALOG_CACHE_KEY = "branchmind.chatModelCatalog.v1";
const MODEL_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;
const PDF_INDEX_POLL_INTERVAL_MS = 2_500;
const PDF_INDEX_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const FALLBACK_MODEL_OPTIONS: ChatModelOption[] = [
  {
    ...FALLBACK_MODEL_SELECTION,
    providerName: "DeepSeek",
    configured: true,
  },
];

const CATALOG_PLACEHOLDER_MODEL_OPTIONS: ChatModelOption[] = [
  { providerId: "anthropic", providerName: "Anthropic", model: "claude-fable-5", configured: false, locked: true },
  { providerId: "anthropic", providerName: "Anthropic", model: "claude-opus-4.6", configured: false, locked: true },
  { providerId: "anthropic", providerName: "Anthropic", model: "claude-sonnet-5", configured: false, locked: true },
  { providerId: "openai", providerName: "OpenAI", model: "gpt-5.6-sol", configured: false, locked: true },
  { providerId: "openai", providerName: "OpenAI", model: "gpt-5.6-terra", configured: false, locked: true },
  { providerId: "openai", providerName: "OpenAI", model: "gpt-5.6-luna", configured: false, locked: true },
  { providerId: "moonshot", providerName: "Kimi", model: "kimi-k3", configured: false, locked: true },
  { providerId: "zhipu", providerName: "Z.ai", model: "glm-5.2", configured: false, locked: true },
];

const AUTO_MODEL_SELECTION: ChatModelSelection = {
  providerId: "deepseek",
  model: "deepseek-v4-flash",
};
const AUTO_STORAGE_SELECTION: ChatModelSelection = {
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

const FLOATING_SUBMENU_GAP_PX = 8;
const FLOATING_SUBMENU_MARGIN_PX = 8;
const FLOATING_SUBMENU_MAX_WIDTH_PX = 224;
const FLOATING_SUBMENU_MAX_HEIGHT_PX = 256;

type FloatingMenuPlacement = "above" | "below";
type FloatingMenuAlignment = "start" | "end";

function getMenuPlacementClass(
  placement: FloatingMenuPlacement,
  alignment: FloatingMenuAlignment,
) {
  const horizontalPosition = alignment === "end" ? "right-0" : "left-0";
  return placement === "below"
    ? `absolute ${horizontalPosition} top-full z-50 mt-2`
    : `absolute bottom-full ${horizontalPosition} z-50 mb-2`;
}

function ModelLogo({
  model,
  size = "md",
}: {
  model: string;
  size?: "sm" | "md";
}) {
  const normalizedModel = model.toLowerCase();
  const boxClass = size === "sm" ? "h-5 w-5" : "h-8 w-8";
  const textClass = size === "sm" ? "text-[10px]" : "text-xs";
  const logo = normalizedModel.includes("kimi")
    ? { path: "/model-logos/kimi.svg", background: "#050505", scale: "68%" }
    : normalizedModel.includes("mimo")
      ? { path: "/model-logos/mimo.svg", background: "#ffffff", scale: "88%" }
      : normalizedModel.includes("deepseek")
        ? { path: "/model-logos/deepseek.svg", background: "#ffffff", scale: "72%" }
        : normalizedModel.includes("glm")
          ? { path: "/model-logos/glm.svg", background: "#ffffff", scale: "72%" }
          : normalizedModel.includes("qwen")
            ? { path: "/model-logos/qwen.svg", background: "#ffffff", scale: "72%" }
            : normalizedModel.includes("gemini")
              ? { path: "/model-logos/gemini.svg", background: "#ffffff", scale: "68%" }
              : normalizedModel.includes("gpt") || normalizedModel.includes("openai")
                ? { path: "/model-logos/openai.svg", background: "#ffffff", scale: "68%" }
                : normalizedModel.includes("claude")
                  ? { path: "/model-logos/claude.svg", background: "#ffffff", scale: "68%" }
                  : null;

  if (logo) {
    return (
      <span
        aria-hidden="true"
        className={`${boxClass} shrink-0 rounded-full border border-neutral-200 bg-center bg-no-repeat`}
        style={{
          backgroundColor: logo.background,
          backgroundImage: `url("${logo.path}")`,
          backgroundSize: logo.scale,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`grid ${boxClass} shrink-0 place-items-center rounded-full border border-neutral-200 bg-white font-black text-neutral-700 ${textClass}`}
    >
      {model.slice(0, 1).toUpperCase()}
    </span>
  );
}

function stopFloatingMenuWheelPropagation(event: ReactWheelEvent<HTMLDivElement>) {
  event.stopPropagation();
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function getAttachmentTypeLabel(attachment: ChatAttachment, unknownTypeLabel: string) {
  return attachment.mimeType || unknownTypeLabel;
}

export function isKnowledgeAttachment(
  attachment: Pick<ChatAttachment, "documentId" | "size">,
) {
  return Boolean(attachment.documentId && attachment.size === 0);
}

export function getAttachmentDetailLabel(
  attachment: ChatAttachment,
  labels = {
    knowledgePdf: "Knowledge PDF",
    unknownType: "Unknown type",
  },
) {
  if (isKnowledgeAttachment(attachment)) return labels.knowledgePdf;
  return `${getAttachmentTypeLabel(attachment, labels.unknownType)} - ${formatFileSize(attachment.size)}`;
}

function getPendingAttachmentStatusLabel(
  attachment: PendingChatAttachment,
  labels: {
    failed: string;
    indexed: string;
    ingesting: string;
    uploading: string;
  },
) {
  if (attachment.uploadStatus === "uploading") return labels.uploading;
  if (attachment.uploadStatus === "queued" || attachment.uploadStatus === "indexing") {
    return labels.ingesting;
  }
  if (attachment.uploadStatus === "indexed") return labels.indexed;
  if (attachment.uploadStatus === "failed") return labels.failed;
  if (attachment.documentId && attachment.documentStatus === "indexed") return labels.indexed;
  return null;
}

function isPdfAttachment(attachment: PendingChatAttachment) {
  return (
    attachment.file?.type === "application/pdf" ||
    attachment.mimeType.toLowerCase() === "application/pdf" ||
    attachment.name.toLowerCase().endsWith(".pdf")
  );
}

function isIndexingStatus(status: DocumentStatus | undefined) {
  return status === "queued" || status === "parsing" || status === "indexing";
}

function shouldEnqueueIndex(status: DocumentStatus | undefined) {
  return (
    status !== "queued" &&
    status !== "parsing" &&
    status !== "indexing" &&
    status !== "indexed"
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForIndexedDocument(documentId: string) {
  const deadline = Date.now() + PDF_INDEX_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const details = await readJsonApi<DocumentDetailsResponse>(
      `/api/documents/${documentId}`,
    );
    const document = details.document;

    if (document.status === "indexed") return document;
    if (document.status === "failed") {
      const reference = document.errorRequestId
        ? ` (Reference: ${document.errorRequestId})`
        : "";
      throw new Error(
        `${document.errorMessage || "PDF indexing failed."}${reference}`,
      );
    }

    await wait(PDF_INDEX_POLL_INTERVAL_MS);
  }

  throw new Error("PDF indexing is still running. Please try sending again shortly.");
}

async function ingestPdfAttachment(
  attachment: PendingChatAttachment,
  onProgress: (next: PendingChatAttachment) => void,
) {
  let current: PendingChatAttachment = {
    ...attachment,
    uploadStatus: attachment.documentId
      ? isIndexingStatus(attachment.documentStatus)
        ? "indexing"
        : "queued"
      : "uploading",
    errorMessage: null,
    errorRequestId: null,
  };
  onProgress(current);

  if (!current.documentId) {
    const formData = new FormData();
    formData.set("file", attachment.file as File);
    const upload = await readJsonApi<UploadPdfResponse>("/api/documents/upload", {
      method: "POST",
      body: formData,
    });

    current = {
      ...current,
      documentId: upload.document.id,
      documentStatus: upload.document.status,
      mimeType: upload.document.mimeType || current.mimeType || "application/pdf",
      uploadStatus: "queued",
    };
    onProgress(current);
  }

  if (!current.documentId) {
    throw new Error("PDF upload did not return a document id.");
  }

  const documentId = current.documentId;
  if (shouldEnqueueIndex(current.documentStatus)) {
    await readJsonApi<IndexPdfResponse>(
      `/api/documents/${documentId}/index`,
      { method: "POST" },
    );
  }

  current = {
    ...current,
    uploadStatus: "indexing",
  };
  onProgress(current);

  const indexed = await waitForIndexedDocument(documentId);
  current = {
    ...current,
    documentStatus: indexed.status,
    errorMessage: indexed.errorMessage,
    errorRequestId: indexed.errorRequestId,
    uploadStatus: "indexed",
  };
  onProgress(current);

  return current;
}

function toSendableAttachment(attachment: PendingChatAttachment): ChatAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt,
    ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
    ...(attachment.documentStatus ? { documentStatus: attachment.documentStatus } : {}),
    ...(attachment.errorMessage ? { errorMessage: attachment.errorMessage } : {}),
    ...(attachment.errorRequestId ? { errorRequestId: attachment.errorRequestId } : {}),
  };
}

function formatModelLabel(model: string) {
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

function matchesModelSelection(
  option: ChatModelSelection,
  selection: ChatModelSelection,
) {
  return option.providerId === selection.providerId && option.model === selection.model;
}

function isStoredModelSelection(value: unknown): value is ChatModelSelection {
  if (!value || typeof value !== "object") return false;

  const selection = value as Partial<ChatModelSelection>;
  return (
    typeof selection.providerId === "string" &&
    selection.providerId.trim().length > 0 &&
    typeof selection.model === "string" &&
    selection.model.trim().length > 0
  );
}

function readStoredModelSelection() {
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

function isAutoModelSelection(selection: ChatModelSelection | null) {
  return (
    selection?.providerId === AUTO_STORAGE_SELECTION.providerId &&
    selection.model === AUTO_STORAGE_SELECTION.model
  );
}

function writeStoredModelSelection(selection: ChatModelSelection) {
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

function normalizeModelCatalog(data: ChatModelCatalogResponse | null) {
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

function readCachedModelCatalog() {
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

function cacheModelCatalog(catalog: ChatModelCatalogResponse) {
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

function replacePendingAttachment(
  attachments: PendingChatAttachment[],
  next: PendingChatAttachment,
) {
  return attachments.map((attachment) => (attachment.id === next.id ? next : attachment));
}

export function useChatComposerControls({
  isBusy,
  maxAttachments = MAX_CHAT_ATTACHMENTS,
  autoPreparePdfAttachments = true,
}: {
  isBusy: boolean;
  maxAttachments?: number;
  autoPreparePdfAttachments?: boolean;
}) {
  const { copy } = useLanguage();
  const [initialModelCatalog] = useState(() => readCachedModelCatalog());
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>(
    () => initialModelCatalog?.options ?? FALLBACK_MODEL_OPTIONS,
  );
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection>(
    AUTO_MODEL_SELECTION,
  );
  const [isAutoSelected, setIsAutoSelected] = useState(true);
  const [hasLoadedModelCatalog, setHasLoadedModelCatalog] = useState(
    Boolean(initialModelCatalog),
  );
  const [isLoadingModelCatalog, setIsLoadingModelCatalog] = useState(
    !initialModelCatalog,
  );
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [modelCatalogRequestId, setModelCatalogRequestId] = useState(0);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isKnowledgeMenuOpen, setIsKnowledgeMenuOpen] = useState(false);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingKnowledgeDocuments, setIsLoadingKnowledgeDocuments] = useState(false);
  const [knowledgeDocumentError, setKnowledgeDocumentError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<ChatSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [isSkillMenuOpen, setIsSkillMenuOpen] = useState(false);
  const [skillImportError, setSkillImportError] = useState<string | null>(null);
  const [isImportingSkill, setIsImportingSkill] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skillDirectoryInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef<PendingChatAttachment[]>([]);
  const inFlightIngestionRef = useRef(new Map<string, Promise<PendingChatAttachment>>());
  const ingestionRunIdsRef = useRef(new Map<string, number>());
  const nextIngestionRunIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const selectedModelOption = modelOptions.find((option) =>
    matchesModelSelection(option, selectedModel),
  );
  const activeSkill = availableSkills.find((skill) => skill.id === activeSkillId) ?? null;
  const selectedModelLabel = isAutoSelected
    ? copy.chat.autoModel
    : formatModelLabel(selectedModelOption?.model ?? selectedModel.model);
  const modelSelection = isAutoSelected ? undefined : selectedModel;
  const controlsBusy = isBusy || isPreparingAttachments;
  const indexedKnowledgeDocuments = knowledgeDocuments.filter(
    (document) => document.status === "indexed",
  );

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    const inFlightIngestion = inFlightIngestionRef.current;
    const ingestionRunIds = ingestionRunIdsRef.current;

    return () => {
      isMountedRef.current = false;
      inFlightIngestion.clear();
      ingestionRunIds.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAvailableSkills(readAvailableChatSkills());
  }, []);

  useEffect(() => {
    const storedSelection = readStoredModelSelection();
    const storedAutoSelection = isAutoModelSelection(storedSelection);
    if (storedAutoSelection || !storedSelection) {
      setIsAutoSelected(true);
      setSelectedModel(AUTO_MODEL_SELECTION);
    } else if (
      !initialModelCatalog ||
      initialModelCatalog.options.some(
          (option) =>
            !option.locked &&
            option.configured &&
            matchesModelSelection(option, storedSelection),
        )
    ) {
      setIsAutoSelected(false);
      setSelectedModel(storedSelection);
    } else {
      setIsAutoSelected(true);
      setSelectedModel(AUTO_MODEL_SELECTION);
      writeStoredModelSelection(AUTO_STORAGE_SELECTION);
    }

    if (initialModelCatalog && modelCatalogRequestId === 0) return;

    let cancelled = false;

    async function loadModelOptions() {
      setIsLoadingModelCatalog(true);
      setModelCatalogError(null);

      try {
        const response = await fetch("/api/chat/models", {
          credentials: "same-origin",
        });
        const data = (await response.json().catch(() => null)) as
          | ChatModelCatalogResponse
          | null;
        if (!response.ok) throw new Error(copy.chat.modelCatalogLoadFailed);

        const catalog = normalizeModelCatalog(data);
        if (!catalog || !data) throw new Error(copy.chat.modelCatalogLoadFailed);
        if (cancelled) return;

        cacheModelCatalog(data);
        setModelOptions(catalog.options);
        setHasLoadedModelCatalog(true);
        setSelectedModel((current) => {
          const storedSelectionIsValid =
            storedSelection &&
            !storedAutoSelection &&
            catalog.options.some(
              (option) =>
                !option.locked &&
                option.configured &&
                matchesModelSelection(option, storedSelection),
            );
          if (storedAutoSelection || !storedSelection) return AUTO_MODEL_SELECTION;
          if (storedSelectionIsValid) return storedSelection;

          const currentSelectionIsValid = catalog.options.some((option) =>
            matchesModelSelection(option, current),
          );
          if (currentSelectionIsValid) {
            if (storedSelection && !storedSelectionIsValid) {
              writeStoredModelSelection(current);
            }
            return current;
          }

          setIsAutoSelected(true);
          writeStoredModelSelection(AUTO_STORAGE_SELECTION);
          return AUTO_MODEL_SELECTION;
        });
      } catch (error) {
        if (!cancelled) {
          setModelCatalogError(
            error instanceof Error ? error.message : copy.chat.modelCatalogLoadFailed,
          );
        }
      } finally {
        if (!cancelled) setIsLoadingModelCatalog(false);
      }
    }

    void loadModelOptions();

    return () => {
      cancelled = true;
    };
  }, [copy.chat.modelCatalogLoadFailed, initialModelCatalog, modelCatalogRequestId]);

  useEffect(() => {
    if (!isModelMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = modelMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsModelMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsModelMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return undefined;

    let cancelled = false;

    async function loadKnowledgeDocuments() {
      setIsLoadingKnowledgeDocuments(true);
      setKnowledgeDocumentError(null);

      try {
        const data = await readJsonApi<DocumentsResponse>("/api/documents", {
          method: "GET",
        });
        if (!cancelled) setKnowledgeDocuments(data.documents ?? []);
      } catch (loadError) {
        if (!cancelled) {
          setKnowledgeDocumentError(
            loadError instanceof Error ? loadError.message : copy.chat.couldNotLoadPdfs,
          );
        }
      } finally {
        if (!cancelled) setIsLoadingKnowledgeDocuments(false);
      }
    }

    void loadKnowledgeDocuments();

    return () => {
      cancelled = true;
    };
  }, [copy.chat.couldNotLoadPdfs, isAttachmentMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = attachmentMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsAttachmentMenuOpen(false);
      setIsKnowledgeMenuOpen(false);
      setIsSkillMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAttachmentMenuOpen(false);
        setIsKnowledgeMenuOpen(false);
        setIsSkillMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (!isSkillMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = attachmentMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsSkillMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsSkillMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSkillMenuOpen]);

  function setAttachmentIngestionProgress(next: PendingChatAttachment) {
    setPendingAttachments((current) => replacePendingAttachment(current, next));
  }

  function hasPendingAttachment(attachmentId: string) {
    return pendingAttachmentsRef.current.some(
      (attachment) => attachment.id === attachmentId,
    );
  }

  function isCurrentIngestionRun(attachmentId: string, runId: number) {
    return ingestionRunIdsRef.current.get(attachmentId) === runId;
  }

  function startPdfIngestion(attachment: PendingChatAttachment) {
    if (
      !isPdfAttachment(attachment) ||
      !attachment.file ||
      attachment.documentStatus === "indexed" ||
      inFlightIngestionRef.current.has(attachment.id)
    ) {
      return;
    }

    const runId = nextIngestionRunIdRef.current + 1;
    nextIngestionRunIdRef.current = runId;
    ingestionRunIdsRef.current.set(attachment.id, runId);

    const ingestion = ingestPdfAttachment(attachment, (next) => {
      if (!isMountedRef.current || !isCurrentIngestionRun(attachment.id, runId)) {
        return;
      }
      setAttachmentIngestionProgress(next);
    });

    inFlightIngestionRef.current.set(attachment.id, ingestion);

    void ingestion
      .catch((ingestionError) => {
        if (
          !isMountedRef.current ||
          !isCurrentIngestionRun(attachment.id, runId) ||
          !hasPendingAttachment(attachment.id)
        ) {
          return;
        }

        const message =
          ingestionError instanceof Error ? ingestionError.message : copy.chat.pdfUploadFailed;
        const errorRequestId =
          ingestionError instanceof ApiRequestError ? ingestionError.requestId : null;
        setAttachmentError(message);
        setPendingAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  uploadStatus: "failed",
                  errorMessage: message,
                  errorRequestId,
                }
              : item,
          ),
        );
      })
      .finally(() => {
        if (isCurrentIngestionRun(attachment.id, runId)) {
          inFlightIngestionRef.current.delete(attachment.id);
        }
      });
  }

  async function prepareAttachmentsForSend() {
    if (isPreparingAttachments) return null;

    let prepared = pendingAttachments;
    const needsPdfPreparation = prepared.some(
      (attachment) =>
        isPdfAttachment(attachment) &&
        attachment.file &&
        attachment.documentStatus !== "indexed",
    );

    if (!needsPdfPreparation) {
      setAttachmentError(null);
      return prepared.map(toSendableAttachment);
    }

    setAttachmentError(null);
    setIsPreparingAttachments(true);

    try {
      for (const attachment of pendingAttachments) {
        if (
          !isPdfAttachment(attachment) ||
          !attachment.file ||
          attachment.documentStatus === "indexed"
        ) {
          continue;
        }

        const inFlightIngestion = inFlightIngestionRef.current.get(attachment.id);
        const indexed = inFlightIngestion
          ? await inFlightIngestion
          : await ingestPdfAttachment(attachment, (next) => {
              prepared = replacePendingAttachment(prepared, next);
              setPendingAttachments(prepared);
            });
        const current = {
          ...indexed,
          uploadStatus: "indexed" as const,
        };
        prepared = replacePendingAttachment(prepared, current);
        setPendingAttachments(prepared);
      }

      return prepared.map(toSendableAttachment);
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : copy.chat.pdfUploadFailed;
      const errorRequestId =
        uploadError instanceof ApiRequestError ? uploadError.requestId : null;
      setAttachmentError(message);
      setPendingAttachments((current) =>
        current.map((attachment) =>
          attachment.uploadStatus === "uploading" ||
          attachment.uploadStatus === "indexing" ||
          attachment.uploadStatus === "queued"
            ? {
                ...attachment,
                uploadStatus: "failed",
                errorMessage: message,
                errorRequestId,
              }
            : attachment,
        ),
      );
      return null;
    } finally {
      setIsPreparingAttachments(false);
    }
  }

  function toggleAttachmentMenu() {
    if (controlsBusy || pendingAttachments.length >= maxAttachments) return;
    if (isAttachmentMenuOpen) {
      setIsKnowledgeMenuOpen(false);
      setIsSkillMenuOpen(false);
    }
    setIsAttachmentMenuOpen((isOpen) => !isOpen);
    setIsModelMenuOpen(false);
  }

  function openFilePicker() {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
    fileInputRef.current?.click();
  }

  function openSkillDirectoryPicker() {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
    skillDirectoryInputRef.current?.click();
  }

  async function handleSkillDirectoryChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setSkillImportError(null);
    setIsImportingSkill(true);

    try {
      const { readSkillFromFileList } = await import("@/lib/chat-skills");
      const result: ParsedChatSkill = await readSkillFromFileList(files);

      if (!result.success) {
        setSkillImportError(
          result.error === "missing-skill-md" || result.error === "invalid-selection"
            ? copy.chat.skillInvalidFile
            : copy.chat.skillImportError,
        );
        return;
      }

      addStoredChatSkill(result.skill);
      setAvailableSkills(readAvailableChatSkills());
      setActiveSkillId(result.skill.id);
      setIsSkillMenuOpen(false);
    } catch {
      setSkillImportError(copy.chat.skillImportError);
    } finally {
      setIsImportingSkill(false);
      event.target.value = "";
    }
  }

  function selectSkill(skillId: string) {
    if (controlsBusy) return;
    setActiveSkillId(skillId);
    setIsSkillMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
  }

  function removeActiveSkill() {
    if (controlsBusy) return;
    setActiveSkillId(null);
  }

  function removeImportedSkill(skillId: string) {
    if (isDefaultChatSkill(skillId)) return;
    removeStoredChatSkill(skillId);
    setAvailableSkills(readAvailableChatSkills());
    if (activeSkillId === skillId) {
      setActiveSkillId(null);
    }
  }

  function prepareSkillForSend(): ChatSkill | undefined {
    return validateChatSkillForSend(activeSkill) ?? undefined;
  }

  function selectModel(option: ChatModelOption) {
    if (!option.configured || option.locked || controlsBusy) return;
    const selection = {
      providerId: option.providerId,
      model: option.model,
    };
    setIsAutoSelected(false);
    setSelectedModel(selection);
    writeStoredModelSelection(selection);
    setIsModelMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
  }

  function selectAutoModel() {
    if (controlsBusy) return;
    setIsAutoSelected(true);
    setSelectedModel(AUTO_MODEL_SELECTION);
    writeStoredModelSelection(AUTO_STORAGE_SELECTION);
    setIsModelMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
  }

  function refreshModelCatalog() {
    if (isLoadingModelCatalog) return;
    setModelCatalogRequestId((current) => current + 1);
  }

  function selectKnowledgeDocument(document: KnowledgeDocument) {
    if (
      controlsBusy ||
      document.status !== "indexed" ||
      pendingAttachments.length >= maxAttachments
    ) {
      return;
    }

    setAttachmentError(null);
    setPendingAttachments((current) => {
      if (
        current.length >= maxAttachments ||
        current.some((attachment) => attachment.documentId === document.id)
      ) {
        return current;
      }

      return [
        ...current,
        {
          id: createId("attachment"),
          name: document.fileName,
          mimeType: document.mimeType || "application/pdf",
          size: 0,
          createdAt: new Date().toISOString(),
          documentId: document.id,
          documentStatus: "indexed",
          uploadStatus: "indexed",
        },
      ];
    });
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const remainingSlots = Math.max(0, maxAttachments - pendingAttachments.length);
    const createdAt = new Date().toISOString();
    const nextAttachments: PendingChatAttachment[] = files
      .slice(0, remainingSlots)
      .map((file) => ({
        id: createId("attachment"),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        createdAt,
        file,
      }));

    setAttachmentError(null);
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, ...nextAttachments];
    setPendingAttachments((current) => {
      return [...current, ...nextAttachments];
    });
    if (autoPreparePdfAttachments) {
      nextAttachments.forEach(startPdfIngestion);
    }
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId: string) {
    setAttachmentError(null);
    ingestionRunIdsRef.current.delete(attachmentId);
    inFlightIngestionRef.current.delete(attachmentId);
    pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter(
      (attachment) => attachment.id !== attachmentId,
    );
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  const resetAttachments = useCallback(() => {
    inFlightIngestionRef.current.clear();
    ingestionRunIdsRef.current.clear();
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    setAttachmentError(null);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
  }, []);

  function toggleModelMenu() {
    if (controlsBusy) return;
    setIsModelMenuOpen((isOpen) => !isOpen);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setIsSkillMenuOpen(false);
  }

  return {
    activeSkill,
    activeSkillId,
    attachmentError,
    attachmentMenuRef,
    controlsBusy,
    fileInputRef,
    handleAttachmentChange,
    handleSkillDirectoryChange,
    availableSkills,
    indexedKnowledgeDocuments,
    isAttachmentMenuOpen,
    isAutoSelected,
    isImportingSkill,
    isKnowledgeMenuOpen,
    hasLoadedModelCatalog,
    isLoadingModelCatalog,
    isLoadingKnowledgeDocuments,
    isModelMenuOpen,
    isPreparingAttachments,
    isSkillMenuOpen,
    knowledgeDocumentError,
    maxAttachments,
    modelMenuRef,
    modelOptions,
    modelCatalogError,
    openFilePicker,
    openSkillDirectoryPicker,
    pendingAttachments,
    prepareAttachmentsForSend,
    prepareSkillForSend,
    refreshModelCatalog,
    removeActiveSkill,
    removeImportedSkill,
    removePendingAttachment,
    resetAttachments,
    selectAutoModel,
    selectKnowledgeDocument,
    selectModel,
    selectSkill,
    selectedModel,
    modelSelection,
    selectedModelLabel,
    setIsKnowledgeMenuOpen,
    setIsSkillMenuOpen,
    skillDirectoryInputRef,
    skillImportError,
    toggleAttachmentMenu,
    toggleModelMenu,
  };
}

type ChatComposerControlsState = ReturnType<typeof useChatComposerControls>;

export function ActiveSkillChip({
  skill,
  disabled,
  onRemove,
}: {
  skill: ChatSkill;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { copy } = useLanguage();

  return (
    <div
      aria-label={`${copy.chat.skillActive}: ${skill.name}`}
      data-testid="active-skill-chip"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-xs font-bold text-brand-800"
    >
      <Sparkles size={14} className="shrink-0" />
      <span className="min-w-0 truncate">{skill.name}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={copy.chat.skillRemove}
        data-testid="remove-active-skill-button"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-brand-700 transition hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function PendingAttachmentChips({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: PendingChatAttachment[];
  disabled: boolean;
  onRemove: (attachmentId: string) => void;
}) {
  const { copy } = useLanguage();

  if (attachments.length === 0) return null;

  return (
    <ul
      aria-label={copy.chat.pendingAttachments}
      data-testid="pending-attachment-list"
      className="flex flex-wrap gap-2"
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          data-testid="pending-attachment-chip"
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-bold text-neutral-700"
        >
          {attachment.uploadStatus === "uploading" ||
          attachment.uploadStatus === "queued" ||
          attachment.uploadStatus === "indexing" ? (
            <Loader2 size={14} className="shrink-0 animate-spin" />
          ) : isKnowledgeAttachment(attachment) ? (
            <BookOpen size={14} className="shrink-0" />
          ) : (
            <Paperclip size={14} className="shrink-0" />
          )}
          <span className="min-w-0 truncate">{attachment.name}</span>
          <span className="shrink-0 opacity-65">
            {getAttachmentDetailLabel(attachment, {
              knowledgePdf: copy.chat.knowledgePdf,
              unknownType: copy.chat.unknownType,
            })}
          </span>
          {getPendingAttachmentStatusLabel(attachment, {
            failed: copy.chat.failed,
            indexed: copy.chat.indexed,
            ingesting: copy.chat.ingesting,
            uploading: copy.chat.uploading,
          }) && (
            <span className="shrink-0 text-brand-700">
              {getPendingAttachmentStatusLabel(attachment, {
                failed: copy.chat.failed,
                indexed: copy.chat.indexed,
                ingesting: copy.chat.ingesting,
                uploading: copy.chat.uploading,
              })}
            </span>
          )}
          {attachment.uploadStatus === "failed" && attachment.errorRequestId && (
            <span className="max-w-36 shrink truncate font-mono text-[11px] text-danger-600">
              Ref: {attachment.errorRequestId}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            disabled={disabled}
            aria-label={`${copy.common.close} ${attachment.name}`}
            data-testid="remove-pending-attachment-button"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-neutral-600 transition hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachmentMenuButton({
  controls,
  placement = "above",
  alignment = "start",
}: {
  controls: ChatComposerControlsState;
  placement?: FloatingMenuPlacement;
  alignment?: FloatingMenuAlignment;
}) {
  const { copy, language } = useLanguage();
  const attachmentHighlight = useHighlightedAction<"attachment">();
  const knowledgeMenuButtonRef = useRef<HTMLButtonElement>(null);
  const skillMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [submenuPosition, setSubmenuPosition] = useState({ top: -320, left: 0 });

  useLayoutEffect(() => {
    const button = controls.isKnowledgeMenuOpen
      ? knowledgeMenuButtonRef.current
      : controls.isSkillMenuOpen
        ? skillMenuButtonRef.current
        : null;
    if (!button) return undefined;

    const updatePosition = () => {
      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const submenuWidth = Math.min(
        FLOATING_SUBMENU_MAX_WIDTH_PX,
        Math.max(0, viewportWidth - FLOATING_SUBMENU_MARGIN_PX * 2),
      );
      const canPlaceOnLeft =
        rect.left >=
        submenuWidth + FLOATING_SUBMENU_GAP_PX + FLOATING_SUBMENU_MARGIN_PX;
      const left = canPlaceOnLeft
        ? rect.left - submenuWidth - FLOATING_SUBMENU_GAP_PX
        : Math.min(
            rect.right + FLOATING_SUBMENU_GAP_PX,
            viewportWidth - submenuWidth - FLOATING_SUBMENU_MARGIN_PX,
          );
      const top = Math.max(
        FLOATING_SUBMENU_MARGIN_PX,
        Math.min(
          rect.top,
          viewportHeight - FLOATING_SUBMENU_MAX_HEIGHT_PX - FLOATING_SUBMENU_MARGIN_PX,
        ),
      );

      setSubmenuPosition({ top, left: Math.max(FLOATING_SUBMENU_MARGIN_PX, left) });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [controls.isKnowledgeMenuOpen, controls.isSkillMenuOpen]);

  return (
    <>
      <input
        ref={controls.fileInputRef}
        type="file"
        multiple
        onChange={controls.handleAttachmentChange}
        disabled={
          controls.controlsBusy ||
          controls.pendingAttachments.length >= controls.maxAttachments
        }
        aria-label={copy.chat.chooseFiles}
        data-testid="message-attachment-input"
        className="sr-only"
      />
      <input
        ref={controls.skillDirectoryInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is a non-standard attribute needed for directory selection.
        webkitdirectory="true"
        directory=""
        onChange={controls.handleSkillDirectoryChange}
        disabled={controls.controlsBusy || controls.isImportingSkill}
        aria-label={copy.chat.skillImport}
        data-testid="skill-directory-input"
        className="sr-only"
      />
      <div ref={controls.attachmentMenuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={controls.toggleAttachmentMenu}
          {...attachmentHighlight.getPointerHoverHandlers("attachment", {
            clearOnMouseLeave: true,
          })}
          disabled={
            controls.controlsBusy ||
            controls.pendingAttachments.length >= controls.maxAttachments
          }
          aria-label={copy.chat.addFilesKnowledge}
          aria-haspopup="menu"
          aria-expanded={controls.isAttachmentMenuOpen}
          title={copy.chat.addFilesKnowledge}
          data-testid="add-message-attachment-button"
          data-highlighted={attachmentHighlight.getDataHighlighted("attachment")}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[14px] border border-brand-200 text-brand-700 shadow-sm ring-1 ring-white/70 transition focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50 ${getHighlightedActionClass(
            attachmentHighlight.isHighlighted("attachment"),
            "bg-white text-brand-700",
          )}`}
        >
          <Plus size={16} />
        </button>
        {controls.isAttachmentMenuOpen && (
          <div
            role="menu"
            aria-label={copy.chat.addAttachment}
            data-testid="attachment-menu"
            className={`${getMenuPlacementClass(placement, alignment)} chat-model-menu-scrollable nowheel max-h-[min(11rem,calc(100svh-8rem))] w-[min(14rem,calc(100vw-1rem))] overflow-visible overscroll-contain rounded-[14px] border border-neutral-200 bg-white/95 p-1 shadow-xl shadow-neutral-900/10 backdrop-blur`}
          >
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => controls.setIsKnowledgeMenuOpen(false)}
              onFocus={() => controls.setIsKnowledgeMenuOpen(false)}
              onClick={controls.openFilePicker}
              data-testid="upload-new-file-button"
              className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                <Upload size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-black">
                {copy.chat.uploadNewFile}
              </span>
            </button>

            <div className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={controls.isKnowledgeMenuOpen}
                ref={knowledgeMenuButtonRef}
                onClick={() => {
                  controls.setIsKnowledgeMenuOpen((isOpen) => !isOpen);
                  controls.setIsSkillMenuOpen(false);
                }}
                data-testid="knowledge-menu-button"
                className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                  <BookOpen size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  {copy.chat.knowledgeBase}
                </span>
                <ChevronRight
                  size={15}
                  className={`shrink-0 text-neutral-500 transition ${
                    controls.isKnowledgeMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {controls.isKnowledgeMenuOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                      onPointerDown={(event) => event.stopPropagation()}
                  role="menu"
                  aria-label={copy.chat.knowledgePdfs}
                  data-testid="knowledge-document-menu"
                  onWheel={stopFloatingMenuWheelPropagation}
                  style={{ top: submenuPosition.top, left: submenuPosition.left }}
                  className="nowheel fixed z-[100] max-h-64 w-[min(14rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-[16px] border border-neutral-200 bg-brand-50 p-1 shadow-xl shadow-neutral-900/10"
                >
                  {controls.isLoadingKnowledgeDocuments && (
                    <p
                      role="status"
                      className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600"
                    >
                      <Loader2 size={15} className="animate-spin" />
                      {copy.chat.loadingPdfs}
                    </p>
                  )}

                  {controls.knowledgeDocumentError && (
                    <p className="rounded-[12px] bg-danger-100 px-3 py-3 text-sm font-bold text-danger-600">
                      {controls.knowledgeDocumentError}
                    </p>
                  )}

                  {!controls.isLoadingKnowledgeDocuments &&
                    !controls.knowledgeDocumentError &&
                    controls.indexedKnowledgeDocuments.length === 0 && (
                      <p className="rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600">
                        {copy.chat.noIndexedPdfs}
                      </p>
                    )}

                  {!controls.isLoadingKnowledgeDocuments &&
                    !controls.knowledgeDocumentError &&
                    controls.indexedKnowledgeDocuments.map((document) => {
                      const isAlreadySelected = controls.pendingAttachments.some(
                        (attachment) => attachment.documentId === document.id,
                      );
                      const canSelect =
                        !isAlreadySelected &&
                        controls.pendingAttachments.length < controls.maxAttachments;
                      const title = document.title || document.fileName;
                      const detail = isAlreadySelected
                        ? copy.chat.selected
                        : language === "zh"
                          ? `${document.pageCount || "-"} 页`
                          : `${document.pageCount || "-"} pages`;

                      return (
                        <button
                          key={document.id}
                          type="button"
                          role="menuitem"
                          disabled={!canSelect}
                          onClick={() => controls.selectKnowledgeDocument(document)}
                          data-testid="knowledge-document-option"
                          className="chat-menu-highlightable flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left text-neutral-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                            <BookOpen size={16} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black">
                              {title}
                            </span>
                            <span className="block truncate text-xs font-bold text-neutral-500">
                              {detail}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    </div>,
                    document.body,
                  )
                : null}
            </div>

            <div className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={controls.isSkillMenuOpen}
                ref={skillMenuButtonRef}
                onClick={() => {
                  controls.setIsSkillMenuOpen((isOpen) => !isOpen);
                  controls.setIsKnowledgeMenuOpen(false);
                }}
                data-testid="skill-menu-button"
                className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                  <Sparkles size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  {copy.chat.skill}
                </span>
                <ChevronRight
                  size={15}
                  className={`shrink-0 text-neutral-500 transition ${
                    controls.isSkillMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {controls.isSkillMenuOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                      onPointerDown={(event) => event.stopPropagation()}
                  role="menu"
                  aria-label={copy.chat.skill}
                  data-testid="skill-document-menu"
                  onWheel={stopFloatingMenuWheelPropagation}
                  style={{ top: submenuPosition.top, left: submenuPosition.left }}
                  className="nowheel fixed z-[100] max-h-64 w-[min(14rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-[16px] border border-neutral-200 bg-brand-50 p-1 shadow-xl shadow-neutral-900/10"
                >
                  {controls.availableSkills.length === 0 && (
                    <p className="rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600">
                      {copy.chat.skillEmpty}
                    </p>
                  )}

                  {controls.availableSkills.map((skill) => {
                    const isSelected = controls.activeSkillId === skill.id;
                    const isDefault = isDefaultChatSkill(skill.id);

                    return (
                      <button
                        key={skill.id}
                        type="button"
                        role="menuitem"
                        onClick={() => controls.selectSkill(skill.id)}
                        data-testid="skill-option"
                        className={`chat-menu-highlightable flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 ${
                          isSelected
                            ? "bg-white text-brand-800"
                            : "text-neutral-700 hover:bg-white"
                        }`}
                      >
                        <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                          <Sparkles size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="block truncate text-sm font-black">
                              {skill.name}
                            </span>
                            {isDefault && (
                              <span className="chat-menu-item-badge shrink-0 rounded-full border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                                {copy.chat.skillDefault}
                              </span>
                            )}
                          </span>
                          {skill.description && (
                            <span className="block truncate text-xs font-bold text-neutral-500">
                              {skill.description}
                            </span>
                          )}
                        </span>
                        {isSelected && <Check size={16} className="shrink-0 text-brand-700" />}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={controls.openSkillDirectoryPicker}
                    disabled={controls.isImportingSkill}
                    data-testid="import-skill-button"
                    className="chat-menu-highlightable flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-neutral-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="chat-menu-item-icon grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                      <Upload size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-black">
                      {copy.chat.skillImport}
                    </span>
                  </button>

                  {controls.skillImportError && (
                    <p className="rounded-[12px] bg-danger-100 px-3 py-3 text-sm font-bold text-danger-600">
                      {controls.skillImportError}
                    </p>
                  )}
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function ModelSelectorButton({
  controls,
  placement = "above",
  alignment = "start",
}: {
  controls: ChatComposerControlsState;
  placement?: FloatingMenuPlacement;
  alignment?: FloatingMenuAlignment;
}) {
  const { copy } = useLanguage();
  const modelHighlight = useHighlightedAction<"model">();

  return (
    <div ref={controls.modelMenuRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={controls.toggleModelMenu}
        {...modelHighlight.getPointerHoverHandlers("model", {
          clearOnMouseLeave: true,
        })}
        disabled={controls.controlsBusy}
        aria-label={copy.chat.chooseChatModel}
        aria-haspopup="listbox"
        aria-expanded={controls.isModelMenuOpen}
        data-testid="chat-model-selector-button"
        data-highlighted={modelHighlight.getDataHighlighted("model")}
        className={`inline-flex h-9 w-full min-w-0 max-w-[150px] items-center justify-center gap-1.5 rounded-[18px] border border-brand-200 px-2.5 text-xs font-black shadow-sm transition hover:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50 ${getHighlightedActionClass(
          modelHighlight.isHighlighted("model"),
          "bg-white/82 text-neutral-800",
        )}`}
      >
        {controls.isAutoSelected ? (
          <InfinityIcon size={18} strokeWidth={2.4} className="shrink-0 text-neutral-800" />
        ) : (
          <ModelLogo model={controls.selectedModel.model} size="sm" />
        )}
        <span className="min-w-0 truncate">{controls.selectedModelLabel}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-neutral-500 transition ${
            controls.isModelMenuOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {controls.isModelMenuOpen && (
        <div
          role="listbox"
          aria-label={copy.chat.chatModels}
          data-testid="chat-model-menu"
          onWheel={stopFloatingMenuWheelPropagation}
          className={`${getMenuPlacementClass(placement, alignment)} chat-model-menu-scrollable nowheel max-h-[min(11rem,calc(100svh-8rem))] w-[min(14rem,calc(100vw-1rem))] overflow-auto overscroll-contain rounded-[18px] border border-[var(--theme-border-default)] bg-white/95 p-1 shadow-xl shadow-neutral-900/10 backdrop-blur`}
        >
          <button
            type="button"
            role="option"
            aria-selected={controls.isAutoSelected}
            disabled={controls.controlsBusy}
            onClick={controls.selectAutoModel}
            data-testid="chat-model-auto-option"
            className={`chat-menu-highlightable mb-0.5 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-45 ${
              controls.isAutoSelected
                ? "text-neutral-900"
                : "text-neutral-700 hover:bg-brand-50"
            }`}
          >
            <span className="chat-menu-item-icon grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--theme-border-default)] bg-transparent text-neutral-800">
              <InfinityIcon size={16} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{copy.chat.autoModel}</span>
            {controls.isAutoSelected && <Check size={16} className="shrink-0 text-neutral-900" />}
          </button>
          {controls.isLoadingModelCatalog && !controls.hasLoadedModelCatalog && (
            <div
              role="status"
              data-testid="chat-model-loading"
              className="flex items-center gap-2 px-2.5 py-2 text-[13px] font-medium text-neutral-500"
            >
              <Loader2 size={15} className="animate-spin" />
              {copy.chat.modelCatalogLoading}
            </div>
          )}
          {controls.modelCatalogError && !controls.isLoadingModelCatalog && (
            <button
              type="button"
              onClick={controls.refreshModelCatalog}
              data-testid="retry-chat-model-catalog-button"
              className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-danger-600 transition hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-100"
            >
              <span className="truncate">{controls.modelCatalogError}</span>
              <span className="shrink-0 font-bold">{copy.chat.retryModelCatalog}</span>
            </button>
          )}
          {controls.isLoadingModelCatalog && controls.hasLoadedModelCatalog && (
            <div
              role="status"
              className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium text-neutral-500"
            >
              <Loader2 size={13} className="animate-spin" />
              {copy.chat.modelCatalogLoading}
            </div>
          )}
          {controls.hasLoadedModelCatalog && controls.modelOptions.map((option) => {
            const isSelected = matchesModelSelection(option, controls.selectedModel);
            const isLocked = option.locked || !option.configured;

            return (
              <button
                key={`${option.providerId}:${option.model}`}
                type="button"
                role="option"
                aria-selected={!controls.isAutoSelected && isSelected}
                aria-disabled={isLocked || controls.controlsBusy}
                disabled={controls.controlsBusy}
                onClick={() => controls.selectModel(option)}
                data-testid="chat-model-option"
                className={`chat-menu-highlightable flex w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-45 ${
                  isLocked
                    ? "cursor-not-allowed text-neutral-600"
                    : !controls.isAutoSelected && isSelected
                    ? "bg-brand-50 text-brand-800"
                    : "text-neutral-700 hover:bg-brand-50"
                }`}
              >
                <ModelLogo model={option.model} size="md" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {formatModelLabel(option.model)}
                </span>
                {isLocked ? (
                  <LockKeyhole
                    size={16}
                    className="shrink-0 text-neutral-300"
                    aria-label={
                      !option.configured
                        ? copy.chat.modelApiNotConfigured
                        : copy.chat.modelLocked
                    }
                  />
                ) : (
                  !controls.isAutoSelected &&
                  isSelected && <Check size={16} className="shrink-0 text-neutral-900" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
