"use client";

import {
  type ChangeEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  Paperclip,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { ApiRequestError, readJsonApi } from "@/lib/client/api";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import { createId } from "@/lib/ids";
import type { ChatAttachment, ChatModelSelection } from "@/lib/types";

type ChatModelOption = ChatModelSelection & {
  providerName: string;
  configured: boolean;
};

type ChatModelCatalogResponse = {
  defaultSelection?: ChatModelSelection;
  providers?: Array<{
    id: string;
    displayName: string;
    configured: boolean;
    models: string[];
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
};

type IndexPdfResponse = {
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

const FALLBACK_MODEL_OPTIONS: ChatModelOption[] = [
  {
    ...FALLBACK_MODEL_SELECTION,
    providerName: "DeepSeek",
    configured: true,
  },
];

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
  "kimi-k2.6": "Kimi K2.6",
  "mimo-v2.5-pro": "Mimo V2.5 Pro",
  "qwen3.6-plus": "Qwen 3.6 Plus",
};

type FloatingMenuPlacement = "above" | "below";

function getMenuPlacementClass(placement: FloatingMenuPlacement) {
  return placement === "below" ? "absolute left-0 top-full z-50 mt-2" : "absolute bottom-full left-0 z-50 mb-2";
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

function getAttachmentTypeLabel(attachment: ChatAttachment) {
  return attachment.mimeType || "Unknown type";
}

export function isKnowledgeAttachment(
  attachment: Pick<ChatAttachment, "documentId" | "size">,
) {
  return Boolean(attachment.documentId && attachment.size === 0);
}

export function getAttachmentDetailLabel(attachment: ChatAttachment) {
  if (isKnowledgeAttachment(attachment)) return "Knowledge PDF";
  return `${getAttachmentTypeLabel(attachment)} - ${formatFileSize(attachment.size)}`;
}

function getPendingAttachmentStatusLabel(attachment: PendingChatAttachment) {
  if (attachment.uploadStatus === "uploading") return "Uploading";
  if (attachment.uploadStatus === "indexing") return "Indexing";
  if (attachment.uploadStatus === "indexed") return "Indexed";
  if (attachment.uploadStatus === "failed") return "Failed";
  if (attachment.documentId && attachment.documentStatus === "indexed") return "Indexed";
  return null;
}

function isPdfAttachment(attachment: PendingChatAttachment) {
  return (
    attachment.file?.type === "application/pdf" ||
    attachment.mimeType.toLowerCase() === "application/pdf" ||
    attachment.name.toLowerCase().endsWith(".pdf")
  );
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

  const options = data.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      providerName: provider.displayName,
      model,
      configured: provider.configured,
    })),
  );

  if (options.length === 0) return null;

  const responseDefault = data.defaultSelection;
  const defaultSelection =
    responseDefault &&
    options.some((option) => matchesModelSelection(option, responseDefault))
      ? responseDefault
      : options[0];

  return {
    options,
    defaultSelection,
  };
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
}: {
  isBusy: boolean;
  maxAttachments?: number;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [modelOptions, setModelOptions] =
    useState<ChatModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection>(
    FALLBACK_MODEL_SELECTION,
  );
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isKnowledgeMenuOpen, setIsKnowledgeMenuOpen] = useState(false);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingKnowledgeDocuments, setIsLoadingKnowledgeDocuments] = useState(false);
  const [knowledgeDocumentError, setKnowledgeDocumentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const selectedModelOption = modelOptions.find((option) =>
    matchesModelSelection(option, selectedModel),
  );
  const selectedModelLabel = formatModelLabel(
    selectedModelOption?.model ?? selectedModel.model,
  );
  const controlsBusy = isBusy || isPreparingAttachments;
  const indexedKnowledgeDocuments = knowledgeDocuments.filter(
    (document) => document.status === "indexed",
  );

  useEffect(() => {
    let cancelled = false;
    const storedSelection = readStoredModelSelection();
    if (storedSelection) setSelectedModel(storedSelection);

    async function loadModelOptions() {
      try {
        const response = await fetch("/api/chat/models", {
          credentials: "same-origin",
        });
        const data = (await response.json().catch(() => null)) as
          | ChatModelCatalogResponse
          | null;
        if (!response.ok || cancelled) return;

        const catalog = normalizeModelCatalog(data);
        if (!catalog) return;

        setModelOptions(catalog.options);
        setSelectedModel((current) => {
          const storedSelectionIsValid =
            storedSelection &&
            catalog.options.some((option) => matchesModelSelection(option, storedSelection));
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

          writeStoredModelSelection(catalog.defaultSelection);
          return catalog.defaultSelection;
        });
      } catch {
        // Keep the local default; the server still validates the selected model on send.
      }
    }

    void loadModelOptions();

    return () => {
      cancelled = true;
    };
  }, []);

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
            loadError instanceof Error ? loadError.message : "Could not load PDFs.",
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
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return undefined;

    function handlePointerDown(event: globalThis.PointerEvent) {
      const menu = attachmentMenuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setIsAttachmentMenuOpen(false);
      setIsKnowledgeMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAttachmentMenuOpen(false);
        setIsKnowledgeMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAttachmentMenuOpen]);

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

        let current: PendingChatAttachment = {
          ...attachment,
          uploadStatus: attachment.documentId ? "indexing" : "uploading",
          errorMessage: null,
        };
        prepared = replacePendingAttachment(prepared, current);
        setPendingAttachments(prepared);

        if (!current.documentId) {
          const formData = new FormData();
          formData.set("file", attachment.file);
          const upload = await readJsonApi<UploadPdfResponse>("/api/documents/upload", {
            method: "POST",
            body: formData,
          });

          current = {
            ...current,
            documentId: upload.document.id,
            documentStatus: upload.document.status,
            mimeType: upload.document.mimeType || current.mimeType || "application/pdf",
            uploadStatus: "indexing",
          };
          prepared = replacePendingAttachment(prepared, current);
          setPendingAttachments(prepared);
        }

        if (!current.documentId) {
          throw new Error("PDF upload did not return a document id.");
        }

        const indexed = await readJsonApi<IndexPdfResponse>(
          `/api/documents/${current.documentId}/index`,
          { method: "POST" },
        );

        current = {
          ...current,
          documentStatus: indexed.document.status,
          errorMessage: indexed.document.errorMessage,
          uploadStatus: "indexed",
        };
        prepared = replacePendingAttachment(prepared, current);
        setPendingAttachments(prepared);
      }

      return prepared.map(toSendableAttachment);
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "PDF upload failed.";
      const errorRequestId =
        uploadError instanceof ApiRequestError ? uploadError.requestId : null;
      setAttachmentError(message);
      setPendingAttachments((current) =>
        current.map((attachment) =>
          attachment.uploadStatus === "uploading" || attachment.uploadStatus === "indexing"
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
    if (isAttachmentMenuOpen) setIsKnowledgeMenuOpen(false);
    setIsAttachmentMenuOpen((isOpen) => !isOpen);
    setIsModelMenuOpen(false);
  }

  function openFilePicker() {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    fileInputRef.current?.click();
  }

  function selectModel(option: ChatModelOption) {
    if (!option.configured || controlsBusy) return;
    const selection = {
      providerId: option.providerId,
      model: option.model,
    };
    setSelectedModel(selection);
    writeStoredModelSelection(selection);
    setIsModelMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
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

    setAttachmentError(null);
    setPendingAttachments((current) => {
      const remainingSlots = Math.max(0, maxAttachments - current.length);
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
          uploadStatus:
            file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
              ? "queued"
              : undefined,
        }));

      return [...current, ...nextAttachments];
    });
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId: string) {
    setAttachmentError(null);
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  const resetAttachments = useCallback(() => {
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
  }

  return {
    attachmentError,
    attachmentMenuRef,
    controlsBusy,
    fileInputRef,
    handleAttachmentChange,
    indexedKnowledgeDocuments,
    isAttachmentMenuOpen,
    isKnowledgeMenuOpen,
    isLoadingKnowledgeDocuments,
    isModelMenuOpen,
    isPreparingAttachments,
    knowledgeDocumentError,
    maxAttachments,
    modelMenuRef,
    modelOptions,
    openFilePicker,
    pendingAttachments,
    prepareAttachmentsForSend,
    removePendingAttachment,
    resetAttachments,
    selectKnowledgeDocument,
    selectModel,
    selectedModel,
    selectedModelLabel,
    setIsKnowledgeMenuOpen,
    toggleAttachmentMenu,
    toggleModelMenu,
  };
}

type ChatComposerControlsState = ReturnType<typeof useChatComposerControls>;

export function PendingAttachmentChips({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: PendingChatAttachment[];
  disabled: boolean;
  onRemove: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <ul
      aria-label="Pending attachments"
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
          attachment.uploadStatus === "indexing" ? (
            <Loader2 size={14} className="shrink-0 animate-spin" />
          ) : isKnowledgeAttachment(attachment) ? (
            <BookOpen size={14} className="shrink-0" />
          ) : (
            <Paperclip size={14} className="shrink-0" />
          )}
          <span className="min-w-0 truncate">{attachment.name}</span>
          <span className="shrink-0 opacity-65">
            {getAttachmentDetailLabel(attachment)}
          </span>
          {getPendingAttachmentStatusLabel(attachment) && (
            <span className="shrink-0 text-brand-700">
              {getPendingAttachmentStatusLabel(attachment)}
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
            aria-label={`Remove ${attachment.name}`}
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
}: {
  controls: ChatComposerControlsState;
  placement?: FloatingMenuPlacement;
}) {
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
        aria-label="Choose files"
        data-testid="message-attachment-input"
        className="sr-only"
      />
      <div ref={controls.attachmentMenuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={controls.toggleAttachmentMenu}
          disabled={
            controls.controlsBusy ||
            controls.pendingAttachments.length >= controls.maxAttachments
          }
          aria-label="Add files or knowledge"
          aria-haspopup="menu"
          aria-expanded={controls.isAttachmentMenuOpen}
          title="Add files or knowledge"
          data-testid="add-message-attachment-button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] border border-brand-200 bg-gradient-to-b from-white to-brand-50 text-brand-700 shadow-sm ring-1 ring-white/70 transition hover:border-brand-400 hover:from-white hover:to-white focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} />
        </button>
        {controls.isAttachmentMenuOpen && (
          <div
            role="menu"
            aria-label="Add attachment"
            data-testid="attachment-menu"
            onMouseLeave={() => controls.setIsKnowledgeMenuOpen(false)}
            className={`${getMenuPlacementClass(placement)} w-80 max-w-[calc(100vw-2rem)] rounded-[20px] border border-white/80 bg-white/95 p-2 shadow-2xl shadow-brand-100/55 backdrop-blur`}
          >
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => controls.setIsKnowledgeMenuOpen(false)}
              onFocus={() => controls.setIsKnowledgeMenuOpen(false)}
              onClick={controls.openFilePicker}
              data-testid="upload-new-file-button"
              className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                <Upload size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-black">
                Upload new file
              </span>
            </button>

            <div
              className="relative"
              onMouseEnter={() => controls.setIsKnowledgeMenuOpen(true)}
              onFocus={() => controls.setIsKnowledgeMenuOpen(true)}
              onBlur={(event) => {
                const nextFocus = event.relatedTarget;
                if (!nextFocus || !event.currentTarget.contains(nextFocus as Node)) {
                  controls.setIsKnowledgeMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={controls.isKnowledgeMenuOpen}
                onClick={() => controls.setIsKnowledgeMenuOpen(true)}
                data-testid="knowledge-menu-button"
                className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-neutral-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
                  <BookOpen size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  知识库
                </span>
                <ChevronRight
                  size={15}
                  className={`shrink-0 text-neutral-500 transition ${
                    controls.isKnowledgeMenuOpen ? "rotate-90" : ""
                  }`}
                />
              </button>

              {controls.isKnowledgeMenuOpen && (
                <div
                  role="menu"
                  aria-label="Knowledge PDFs"
                  data-testid="knowledge-document-menu"
                  onWheel={stopFloatingMenuWheelPropagation}
                  className="nowheel mt-1 max-h-64 overflow-auto overscroll-contain rounded-[16px] border border-neutral-200 bg-brand-50/55 p-1"
                >
                  {controls.isLoadingKnowledgeDocuments && (
                    <p
                      role="status"
                      className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm font-bold text-neutral-600"
                    >
                      <Loader2 size={15} className="animate-spin" />
                      Loading PDFs
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
                        No indexed PDFs yet.
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
                        ? "Selected"
                        : `${document.pageCount || "-"} pages`;

                      return (
                        <button
                          key={document.id}
                          type="button"
                          role="menuitem"
                          disabled={!canSelect}
                          onClick={() => controls.selectKnowledgeDocument(document)}
                          data-testid="knowledge-document-option"
                          className="flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left text-neutral-700 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-brand-600">
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
                </div>
              )}
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
}: {
  controls: ChatComposerControlsState;
  placement?: FloatingMenuPlacement;
}) {
  return (
    <div ref={controls.modelMenuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={controls.toggleModelMenu}
        disabled={controls.controlsBusy}
        aria-label="Choose chat model"
        aria-haspopup="listbox"
        aria-expanded={controls.isModelMenuOpen}
        data-testid="chat-model-selector-button"
        className="inline-flex h-9 min-w-[90px] max-w-[150px] items-center justify-center gap-1.5 rounded-[14px] border border-brand-200 bg-white/82 px-2.5 text-xs font-black text-neutral-800 shadow-sm transition hover:border-brand-400 hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <BrainCircuit size={14} className="shrink-0 text-brand-600" />
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
          aria-label="Chat models"
          data-testid="chat-model-menu"
          onWheel={stopFloatingMenuWheelPropagation}
          className={`${getMenuPlacementClass(placement)} nowheel max-h-72 w-72 overflow-auto overscroll-contain rounded-[20px] border border-white/80 bg-white/95 p-2 shadow-2xl shadow-brand-100/55 backdrop-blur`}
        >
          {controls.modelOptions.map((option) => {
            const isSelected = matchesModelSelection(option, controls.selectedModel);

            return (
              <button
                key={`${option.providerId}:${option.model}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={!option.configured || controls.controlsBusy}
                onClick={() => controls.selectModel(option)}
                data-testid="chat-model-option"
                className={`flex w-full min-w-0 items-center gap-3 rounded-[14px] px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-45 ${
                  isSelected
                    ? "bg-brand-50 text-brand-800"
                    : "text-neutral-700 hover:bg-brand-50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[10px] border border-neutral-200 bg-white text-xs font-black text-brand-600"
                >
                  {option.providerName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black">
                    {formatModelLabel(option.model)}
                  </span>
                  <span className="block truncate text-xs font-bold text-neutral-500">
                    {option.providerName}
                    {!option.configured ? " - not configured" : ""}
                  </span>
                </span>
                {isSelected && <Check size={15} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
