"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  Paperclip,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
  GitBranch,
  NotebookPen,
  PanelRightClose,
  Ribbon,
  Send,
  Sprout,
  Trash2,
  Upload,
} from "lucide-react";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import { createId } from "@/lib/ids";
import type {
  ChatAttachment,
  ChatMessage,
  ChatModelSelection,
  MindNode,
} from "@/lib/types";
import { MarkdownMessage } from "./MarkdownMessage";

type NodeDetailPanelProps = {
  node: MindNode | null;
  onCreateNode: (
    nodeId: string,
    mode: "continue" | "branch",
    instruction: string,
    sourceText?: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
  ) => Promise<string | null>;
  onEditUserMessage: (
    nodeId: string,
    userMessageId: string,
    instruction: string,
    modelSelection?: ChatModelSelection,
  ) => Promise<boolean>;
  onRetryAssistantMessage: (
    nodeId: string,
    assistantMessageId: string,
    modelSelection?: ChatModelSelection,
  ) => Promise<boolean>;
  onToggleNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  isCreating: boolean;
  isNotesOpen: boolean;
  error: string | null;
  onToggleNotes: () => void;
  onCollapse: () => void;
};

const DEFAULT_SELECTION_BRANCH_INSTRUCTION = "Explain the selected text in a focused branch.";
const SELECTION_PREVIEW_LIMIT = 180;

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

type PendingChatAttachment = ChatAttachment & {
  file?: File;
  uploadStatus?: PendingAttachmentStatus;
};

type UploadedDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  status: DocumentStatus;
  errorMessage: string | null;
};

type KnowledgeDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
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

type MessageActionButtonProps = {
  label: string;
  testId: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function getSelectionPreview(sourceText: string) {
  const compact = sourceText.replace(/\s+/g, " ").trim();
  return compact.length > SELECTION_PREVIEW_LIMIT
    ? `${compact.slice(0, SELECTION_PREVIEW_LIMIT)}...`
    : compact;
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

function isKnowledgeAttachment(attachment: Pick<ChatAttachment, "documentId" | "size">) {
  return Boolean(attachment.documentId && attachment.size === 0);
}

function getAttachmentDetailLabel(attachment: ChatAttachment) {
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
  };
}

function getApiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

async function readApi<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
  });
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data) ?? "Request failed.");
  }

  return data as T;
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

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed.");
  } finally {
    textarea.remove();
  }
}

function MessageActionButton({
  label,
  testId,
  title = label,
  disabled = false,
  onClick,
  children,
}: MessageActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-testid={testId}
      className="grid h-8 w-8 place-items-center rounded-full text-current opacity-75 transition hover:bg-white/70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/25 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function MessageAttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <ul
      aria-label="Message attachments"
      data-testid="message-attachment-list"
      className="mt-3 flex flex-wrap gap-2"
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          data-testid="message-attachment"
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#5f5368]"
        >
          {isKnowledgeAttachment(attachment) ? (
            <BookOpen size={14} className="shrink-0" />
          ) : (
            <Paperclip size={14} className="shrink-0" />
          )}
          <span className="min-w-0 truncate">{attachment.name}</span>
          <span className="shrink-0 opacity-65">
            {getAttachmentDetailLabel(attachment)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NodeDetailPanel({
  node,
  onCreateNode,
  onEditUserMessage,
  onRetryAssistantMessage,
  onToggleNode,
  onDeleteNode,
  isCreating,
  isNotesOpen,
  error,
  onToggleNotes,
  onCollapse,
}: NodeDetailPanelProps) {
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const errorId = `${panelId}-error`;
  const statusId = `${panelId}-status`;
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [mode, setMode] = useState<"continue" | "branch">("continue");
  const [selectedSourceText, setSelectedSourceText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [modelOptions, setModelOptions] =
    useState<ChatModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [selectedModel, setSelectedModel] =
    useState<ChatModelSelection>(FALLBACK_MODEL_SELECTION);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isKnowledgeMenuOpen, setIsKnowledgeMenuOpen] = useState(false);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingKnowledgeDocuments, setIsLoadingKnowledgeDocuments] = useState(false);
  const [knowledgeDocumentError, setKnowledgeDocumentError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const lastMessage = node?.messages[node.messages.length - 1] ?? null;
  const streamingMessageId =
    isCreating && lastMessage?.role === "assistant" ? lastMessage.id : null;
  const streamingContent = streamingMessageId ? lastMessage?.content ?? "" : "";
  const selectedModelOption =
    modelOptions.find((option) => matchesModelSelection(option, selectedModel)) ??
    modelOptions[0];
  const selectedModelLabel = selectedModelOption
    ? formatModelLabel(selectedModelOption.model)
    : "Model";
  const isComposerBusy = isCreating || isPreparingAttachments;
  const displayError = attachmentError ?? error;
  const indexedKnowledgeDocuments = knowledgeDocuments.filter(
    (document) => document.status === "indexed",
  );

  const clearSelectedSourceText = useCallback(() => {
    setSelectedSourceText("");
    window.getSelection()?.removeAllRanges();
  }, []);

  const captureSelectedSourceText = useCallback(() => {
    const container = messagesRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectedSourceText("");
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectedSourceText("");
      return;
    }

    setSelectedSourceText(selection.toString().trim());
  }, []);

  useEffect(() => {
    let cancelled = false;

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
        setSelectedModel((current) =>
          catalog.options.some((option) => matchesModelSelection(option, current))
            ? current
            : catalog.defaultSelection,
        );
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
        const data = await readApi<DocumentsResponse>("/api/documents", {
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

  useEffect(() => {
    clearSelectedSourceText();
    setPendingAttachments([]);
    setAttachmentError(null);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    setEditingMessageId(null);
    setEditingValue("");
  }, [clearSelectedSourceText, node?.id]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isCreating) return;
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight });
  }, [isCreating, node?.id, streamingContent]);

  function replacePendingAttachment(attachments: PendingChatAttachment[], next: PendingChatAttachment) {
    return attachments.map((attachment) => (attachment.id === next.id ? next : attachment));
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
          const upload = await readApi<UploadPdfResponse>("/api/documents/upload", {
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

        const indexed = await readApi<IndexPdfResponse>(
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
      setAttachmentError(message);
      setPendingAttachments((current) =>
        current.map((attachment) =>
          attachment.uploadStatus === "uploading" || attachment.uploadStatus === "indexing"
            ? { ...attachment, uploadStatus: "failed", errorMessage: message }
            : attachment,
        ),
      );
      return null;
    } finally {
      setIsPreparingAttachments(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!node || !input.trim() || isComposerBusy) return;
    const sourceText = mode === "branch" && selectedSourceText ? selectedSourceText : undefined;
    const preparedAttachments = await prepareAttachmentsForSend();
    if (!preparedAttachments) return;
    const createdNodeId = await onCreateNode(
      node.id,
      mode,
      input.trim(),
      sourceText,
      preparedAttachments,
      selectedModel,
    );
    if (createdNodeId) {
      setInput("");
      setPendingAttachments([]);
      setAttachmentError(null);
      clearSelectedSourceText();
    }
  }

  async function handleBranchFromSelection() {
    if (!node || !selectedSourceText || isComposerBusy) return;
    const instruction = input.trim() || DEFAULT_SELECTION_BRANCH_INSTRUCTION;
    const preparedAttachments = await prepareAttachmentsForSend();
    if (!preparedAttachments) return;
    const createdNodeId = await onCreateNode(
      node.id,
      "branch",
      instruction,
      selectedSourceText,
      preparedAttachments,
      selectedModel,
    );
    if (createdNodeId) {
      setInput("");
      setPendingAttachments([]);
      setAttachmentError(null);
      clearSelectedSourceText();
    }
  }

  function handleToggleAttachmentMenu() {
    if (isComposerBusy || pendingAttachments.length >= MAX_CHAT_ATTACHMENTS) return;
    if (isAttachmentMenuOpen) setIsKnowledgeMenuOpen(false);
    setIsAttachmentMenuOpen((isOpen) => !isOpen);
    setIsModelMenuOpen(false);
  }

  function handleOpenFilePicker() {
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
    fileInputRef.current?.click();
  }

  function handleSelectModel(option: ChatModelOption) {
    if (!option.configured || isComposerBusy) return;
    setSelectedModel({
      providerId: option.providerId,
      model: option.model,
    });
    setIsModelMenuOpen(false);
    setIsAttachmentMenuOpen(false);
    setIsKnowledgeMenuOpen(false);
  }

  function handleSelectKnowledgeDocument(document: KnowledgeDocument) {
    if (
      isComposerBusy ||
      document.status !== "indexed" ||
      pendingAttachments.length >= MAX_CHAT_ATTACHMENTS
    ) {
      return;
    }

    setAttachmentError(null);
    setPendingAttachments((current) => {
      if (
        current.length >= MAX_CHAT_ATTACHMENTS ||
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
      const remainingSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - current.length);
      const createdAt = new Date().toISOString();
      const nextAttachments: PendingChatAttachment[] = files.slice(0, remainingSlots).map((file) => ({
        id: createId("attachment"),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        createdAt,
        file,
        uploadStatus: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? "queued"
          : undefined,
      }));

      return [...current, ...nextAttachments];
    });
    event.target.value = "";
  }

  function handleRemovePendingAttachment(attachmentId: string) {
    setAttachmentError(null);
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  async function handleCopyMessage(message: ChatMessage) {
    if (!message.content) return;

    try {
      await copyTextToClipboard(message.content);
      setCopiedMessageId(message.id);
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId((currentId) => (currentId === message.id ? null : currentId));
      }, 1800);
    } catch {
      setCopiedMessageId(null);
    }
  }

  function handleStartEdit(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditingValue(message.content);
    clearSelectedSourceText();
  }

  async function handleSaveEdit() {
    if (!node || !editingMessageId || isCreating) return;
    const trimmed = editingValue.trim();
    if (!trimmed) return;

    const started = await onEditUserMessage(
      node.id,
      editingMessageId,
      trimmed,
      selectedModel,
    );
    if (started) {
      setEditingMessageId(null);
      setEditingValue("");
      clearSelectedSourceText();
    }
  }

  function handleCancelEdit() {
    setEditingMessageId(null);
    setEditingValue("");
  }

  function handleRetryMessage(message: ChatMessage) {
    if (!node || isCreating) return;
    void onRetryAssistantMessage(node.id, message.id, selectedModel);
  }

  if (!node) {
    return (
      <aside
        aria-label="Node details"
        data-testid="node-detail-panel"
        className="flex min-h-0 w-full max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/72 p-4 shadow-lg shadow-[#e4d6ef]/40 lg:h-full lg:max-h-full"
      >
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse node details panel"
          aria-expanded="true"
          data-testid="collapse-node-detail-panel-button"
          className="grid h-10 w-10 place-items-center self-end rounded-full bg-white/75 text-[#6c538d] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
        >
          <PanelRightClose size={18} />
        </button>
        <div className="grid min-h-[128px] flex-1 place-items-center text-center text-sm font-bold text-[#665a70]">
          <span role="status" aria-live="polite" data-testid="node-detail-empty-state">
            Select a node
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-labelledby={titleId}
      data-testid="node-detail-panel"
      className="flex min-h-0 w-full max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/72 p-4 shadow-lg shadow-[#e4d6ef]/40 lg:h-full lg:max-h-full"
    >
      <div className="shrink-0 space-y-3 border-b border-[#eadff1] pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#74687c]">
              {node.branchType}
            </p>
            <h2 id={titleId} className="text-xl font-black leading-snug text-[#332a39]">
              {node.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse node details panel"
            aria-controls="conversation-history"
            aria-expanded="true"
            data-testid="collapse-node-detail-panel-button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/75 text-[#6c538d] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
          >
            <PanelRightClose size={18} />
          </button>
        </div>
        <p className="text-sm leading-6 text-[#5f5368]">{node.summary}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isCreating}
            onClick={() => onToggleNode(node.id)}
            aria-label={node.collapsed ? "Expand node" : "Fold node"}
            aria-expanded={node.children.length > 0 ? !node.collapsed : undefined}
            aria-controls="mind-map"
            data-testid="toggle-node-button"
            className="inline-flex h-10 items-center gap-2 rounded-[16px] bg-[#ffe4ec] px-3 text-sm font-black text-[#9a4c64] transition hover:bg-[#ffd3df] disabled:cursor-not-allowed disabled:opacity-65"
          >
            <Ribbon size={16} />
            {node.collapsed ? "Expand" : "Fold"}
          </button>
          {node.parentId && (
            <button
              type="button"
              disabled={isCreating}
              onClick={() => onDeleteNode(node.id)}
              aria-label="Delete node"
              data-testid="delete-node-button"
              className="inline-flex h-10 items-center gap-2 rounded-[16px] bg-[#ffeceb] px-3 text-sm font-black text-[#a4514b] transition hover:bg-[#ffd7d4] disabled:cursor-not-allowed disabled:opacity-65"
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onToggleNotes}
            aria-label={isNotesOpen ? "Close project notes" : "Open project notes"}
            aria-controls="project-notes-panel"
            aria-expanded={isNotesOpen}
            data-testid="node-detail-notes-button"
            className={`inline-flex h-10 items-center gap-2 rounded-[16px] px-3 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-[#eadcf7] ${
              isNotesOpen
                ? "bg-[#eadcf7] text-[#6e4ca0] hover:bg-[#dfc9f3]"
                : "bg-white/75 text-[#776c80] hover:bg-white"
            }`}
          >
            <NotebookPen size={16} />
            Notes
          </button>
        </div>
      </div>

      <section
        id="conversation-history"
        ref={messagesRef}
        aria-label="Conversation history"
        aria-busy={isCreating}
        data-testid="conversation-history"
        onKeyUp={captureSelectedSourceText}
        onMouseUp={captureSelectedSourceText}
        onTouchEnd={captureSelectedSourceText}
        className="min-h-0 flex-1 space-y-3 overflow-auto overscroll-contain py-4 pr-1"
      >
        {node.messages.length === 0 ? (
          <div
            role="status"
            data-testid="conversation-empty-state"
            className="rounded-[20px] bg-white/70 p-4 text-center text-sm font-bold text-[#665a70]"
          >
            No messages in this node yet.
          </div>
        ) : (
          node.messages.map((message) => {
            const isStreamingAssistant = message.id === streamingMessageId;
            const isEditingMessage =
              message.role === "user" && message.id === editingMessageId;
            const isCopied = copiedMessageId === message.id;

            return (
              <div
                key={message.id}
                data-testid="conversation-message"
                data-message-id={message.id}
                data-streaming={isStreamingAssistant ? "true" : undefined}
                className={`group text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-6 text-[#315e45]"
                    : "mr-6 text-[#514062]"
                }`}
              >
                <article
                  aria-label={`${message.role} message`}
                  aria-live={isStreamingAssistant ? "polite" : undefined}
                  className={`rounded-[20px] p-3 ${
                    message.role === "user" ? "bg-[#e7f5ed]" : "bg-[#f5effc]"
                  }`}
                >
                  <p className="mb-1 text-xs font-black uppercase opacity-65">{message.role}</p>
                  {isEditingMessage ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        disabled={isCreating}
                        aria-label="Edit user message"
                        data-testid="message-edit-input"
                        rows={4}
                        className="w-full resize-none rounded-[16px] border border-white/80 bg-white/78 p-3 text-sm leading-6 text-[#315e45] outline-none focus:border-[#8fc7aa] focus:ring-4 focus:ring-[#d7f0e2] disabled:cursor-not-allowed disabled:opacity-65"
                      />
                      <div className="flex justify-end gap-2">
                        <MessageActionButton
                          label="Cancel message edit"
                          testId="cancel-message-edit-button"
                          onClick={handleCancelEdit}
                          disabled={isCreating}
                        >
                          <X size={15} />
                        </MessageActionButton>
                        <MessageActionButton
                          label="Save message edit"
                          testId="save-message-edit-button"
                          onClick={handleSaveEdit}
                          disabled={isCreating || !editingValue.trim()}
                        >
                          <Save size={15} />
                        </MessageActionButton>
                      </div>
                    </div>
                  ) : (
                    <MarkdownMessage
                      content={
                        message.content || (isStreamingAssistant ? "Generating answer..." : "")
                      }
                      isStreaming={isStreamingAssistant}
                    />
                  )}
                  <MessageAttachmentList attachments={message.attachments ?? []} />
                  {isStreamingAssistant && (
                    <p
                      role="status"
                      aria-live="polite"
                      data-testid="message-streaming-status"
                      className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#6c5b75]"
                    >
                      Generating answer
                    </p>
                  )}
                </article>
                {!isEditingMessage && (
                  <div
                    role="group"
                    aria-label={`${message.role} message actions`}
                    data-testid="conversation-message-actions"
                    className={`mt-1 flex h-8 gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${
                      message.role === "user" ? "justify-end pr-2" : "justify-start pl-2"
                    }`}
                  >
                    <MessageActionButton
                      label={`Copy ${message.role} message`}
                      title={isCopied ? "Copied" : `Copy ${message.role} message`}
                      testId="copy-message-button"
                      onClick={() => void handleCopyMessage(message)}
                      disabled={!message.content}
                    >
                      {isCopied ? <Check size={15} /> : <Copy size={15} />}
                    </MessageActionButton>
                    {message.role === "user" ? (
                      <MessageActionButton
                        label="Edit user message"
                        testId="edit-message-button"
                        onClick={() => handleStartEdit(message)}
                        disabled={isCreating}
                      >
                        <Pencil size={15} />
                      </MessageActionButton>
                    ) : (
                      <MessageActionButton
                        label="Retry assistant response"
                        testId="retry-message-button"
                        onClick={() => handleRetryMessage(message)}
                        disabled={isCreating}
                      >
                        <RotateCcw size={15} />
                      </MessageActionButton>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      <form
        aria-label="Message composer"
        aria-busy={isComposerBusy}
        aria-describedby={displayError ? errorId : isComposerBusy ? statusId : undefined}
        data-testid="message-composer"
        onSubmit={handleSubmit}
        className="shrink-0 space-y-3 border-t border-[#eadff1] pt-4"
      >
        {selectedSourceText && (
          <div
            aria-label="Selected source text"
            data-testid="selected-source-text"
            className="space-y-2 rounded-[20px] bg-white/70 p-3 text-sm text-[#5d5168]"
          >
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8f7d9a]">
              Selected text
            </p>
            <p className="line-clamp-3 leading-6">{getSelectionPreview(selectedSourceText)}</p>
            <button
              type="button"
              onClick={handleBranchFromSelection}
              disabled={isComposerBusy}
              aria-label="Branch from selection"
              data-testid="branch-from-selection-button"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[16px] bg-[#eadcf7] text-sm font-black text-[#6e4ca0] transition hover:bg-[#dfc9f3] disabled:cursor-not-allowed disabled:opacity-65"
            >
              <GitBranch size={16} />
              Branch from selection
            </button>
          </div>
        )}

        <div
          role="group"
          aria-label="Message branch mode"
          data-testid="message-branch-mode"
          className="grid grid-cols-2 gap-2"
        >
          <button
            type="button"
            onClick={() => setMode("continue")}
            disabled={isComposerBusy}
            aria-label="Continue down"
            aria-pressed={mode === "continue"}
            data-testid="continue-down-button"
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-[16px] text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-65 ${
              mode === "continue"
                ? "bg-[#dff5ea] text-[#376b50]"
                : "bg-white/75 text-[#776c80] hover:bg-white"
            }`}
          >
            <Sprout size={16} />
            Continue
          </button>
          <button
            type="button"
            onClick={() => setMode("branch")}
            disabled={isComposerBusy}
            aria-label="Branch right"
            aria-pressed={mode === "branch"}
            data-testid="branch-right-button"
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-[16px] text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-65 ${
              mode === "branch"
                ? "bg-[#eadcf7] text-[#6e4ca0]"
                : "bg-white/75 text-[#776c80] hover:bg-white"
            }`}
          >
            <GitBranch size={16} />
            Branch
          </button>
        </div>
        {pendingAttachments.length > 0 && (
          <ul
            aria-label="Pending attachments"
            data-testid="pending-attachment-list"
            className="flex flex-wrap gap-2"
          >
            {pendingAttachments.map((attachment) => (
              <li
                key={attachment.id}
                data-testid="pending-attachment-chip"
                className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-bold text-[#5f5368]"
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
                  <span className="shrink-0 text-[#6e4ca0]">
                    {getPendingAttachmentStatusLabel(attachment)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemovePendingAttachment(attachment.id)}
                  disabled={isComposerBusy}
                  aria-label={`Remove ${attachment.name}`}
                  data-testid="remove-pending-attachment-button"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#776c80] transition hover:bg-[#eadcf7] focus:outline-none focus:ring-2 focus:ring-[#b696d4] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleAttachmentChange}
            disabled={isComposerBusy || pendingAttachments.length >= MAX_CHAT_ATTACHMENTS}
            aria-label="Choose files"
            data-testid="message-attachment-input"
            className="sr-only"
          />
          <div ref={attachmentMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={handleToggleAttachmentMenu}
              disabled={isComposerBusy || pendingAttachments.length >= MAX_CHAT_ATTACHMENTS}
              aria-label="Add files or knowledge"
              aria-haspopup="menu"
              aria-expanded={isAttachmentMenuOpen}
              title="Add files or knowledge"
              data-testid="add-message-attachment-button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[16px] border border-[#dcccea] bg-gradient-to-b from-white to-[#f7f0ff] text-[#6c538d] shadow-[0_8px_20px_rgba(112,84,148,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-white/70 transition hover:border-[#b696d4] hover:from-white hover:to-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={18} />
            </button>
            {isAttachmentMenuOpen && (
              <div
                role="menu"
                aria-label="Add attachment"
                data-testid="attachment-menu"
                onMouseLeave={() => setIsKnowledgeMenuOpen(false)}
                className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-[20px] border border-white/80 bg-white/95 p-2 shadow-2xl shadow-[#d4c2e7]/55 backdrop-blur"
              >
                <button
                  type="button"
                  role="menuitem"
                  onMouseEnter={() => setIsKnowledgeMenuOpen(false)}
                  onFocus={() => setIsKnowledgeMenuOpen(false)}
                  onClick={handleOpenFilePicker}
                  data-testid="upload-new-file-button"
                  className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-[#4e4556] transition hover:bg-[#f7f1fc] focus:outline-none focus:ring-2 focus:ring-[#b696d4]"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[#eadff1] bg-white text-[#7c5fb1]">
                    <Upload size={16} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-black">
                    Upload new file
                  </span>
                </button>

                <div
                  className="relative"
                  onMouseEnter={() => setIsKnowledgeMenuOpen(true)}
                  onFocus={() => setIsKnowledgeMenuOpen(true)}
                  onBlur={(event) => {
                    const nextFocus = event.relatedTarget;
                    if (!nextFocus || !event.currentTarget.contains(nextFocus as Node)) {
                      setIsKnowledgeMenuOpen(false);
                    }
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={isKnowledgeMenuOpen}
                    onClick={() => setIsKnowledgeMenuOpen(true)}
                    data-testid="knowledge-menu-button"
                    className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-[#4e4556] transition hover:bg-[#f7f1fc] focus:outline-none focus:ring-2 focus:ring-[#b696d4]"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[#eadff1] bg-white text-[#7c5fb1]">
                      <BookOpen size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-black">
                      知识库
                    </span>
                    <ChevronRight
                      size={15}
                      className={`shrink-0 text-[#8f7d9a] transition ${
                        isKnowledgeMenuOpen ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {isKnowledgeMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Knowledge PDFs"
                      data-testid="knowledge-document-menu"
                      className="mt-1 max-h-64 overflow-auto rounded-[16px] border border-[#eadff1] bg-[#fbf8ff] p-1"
                    >
                      {isLoadingKnowledgeDocuments && (
                        <p
                          role="status"
                          className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm font-bold text-[#76667f]"
                        >
                          <Loader2 size={15} className="animate-spin" />
                          Loading PDFs
                        </p>
                      )}

                      {knowledgeDocumentError && (
                        <p className="rounded-[12px] bg-[#ffeceb] px-3 py-3 text-sm font-bold text-[#8f3f3a]">
                          {knowledgeDocumentError}
                        </p>
                      )}

                      {!isLoadingKnowledgeDocuments &&
                        !knowledgeDocumentError &&
                        indexedKnowledgeDocuments.length === 0 && (
                          <p className="rounded-[12px] px-3 py-3 text-sm font-bold text-[#76667f]">
                            No indexed PDFs yet.
                          </p>
                        )}

                      {!isLoadingKnowledgeDocuments &&
                        !knowledgeDocumentError &&
                        indexedKnowledgeDocuments.map((document) => {
                          const isAlreadySelected = pendingAttachments.some(
                            (attachment) => attachment.documentId === document.id,
                          );
                          const canSelect =
                            !isAlreadySelected &&
                            pendingAttachments.length < MAX_CHAT_ATTACHMENTS;
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
                              onClick={() => handleSelectKnowledgeDocument(document)}
                              data-testid="knowledge-document-option"
                              className="flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[#4e4556] transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#b696d4] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[#eadff1] bg-white text-[#7c5fb1]">
                                <BookOpen size={16} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-black">
                                  {title}
                                </span>
                                <span className="block truncate text-xs font-bold text-[#86788f]">
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
          <div ref={modelMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsModelMenuOpen((isOpen) => !isOpen);
                setIsAttachmentMenuOpen(false);
                setIsKnowledgeMenuOpen(false);
              }}
              disabled={isComposerBusy}
              aria-label="Choose chat model"
              aria-haspopup="listbox"
              aria-expanded={isModelMenuOpen}
              data-testid="chat-model-selector-button"
              className="inline-flex h-11 w-[128px] min-w-0 items-center justify-center gap-2 rounded-[16px] border border-[#dcccea] bg-white/82 px-3 text-sm font-black text-[#4c4057] shadow-[0_8px_20px_rgba(112,84,148,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:border-[#b696d4] hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <BrainCircuit size={16} className="shrink-0 text-[#7c5fb1]" />
              <span className="min-w-0 truncate">{selectedModelLabel}</span>
              <ChevronDown
                size={15}
                className={`shrink-0 text-[#8f7d9a] transition ${
                  isModelMenuOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {isModelMenuOpen && (
              <div
                role="listbox"
                aria-label="Chat models"
                data-testid="chat-model-menu"
                className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-72 overflow-auto rounded-[20px] border border-white/80 bg-white/95 p-2 shadow-2xl shadow-[#d4c2e7]/55 backdrop-blur"
              >
                {modelOptions.map((option) => {
                  const isSelected = matchesModelSelection(option, selectedModel);

                  return (
                    <button
                      key={`${option.providerId}:${option.model}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={!option.configured || isComposerBusy}
                      onClick={() => handleSelectModel(option)}
                      data-testid="chat-model-option"
                      className={`flex w-full min-w-0 items-center gap-3 rounded-[14px] px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-[#b696d4] disabled:cursor-not-allowed disabled:opacity-45 ${
                        isSelected
                          ? "bg-[#f1e8fb] text-[#5d427d]"
                          : "text-[#4e4556] hover:bg-[#f7f1fc]"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-[10px] border border-[#eadff1] bg-white text-xs font-black text-[#7c5fb1]"
                      >
                        {option.providerName.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black">
                          {formatModelLabel(option.model)}
                        </span>
                        <span className="block truncate text-xs font-bold text-[#86788f]">
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
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isComposerBusy}
            aria-label="Message instruction"
            aria-describedby={displayError ? errorId : undefined}
            data-testid="message-instruction-input"
            placeholder="Ask the next question..."
            rows={3}
            className="min-w-[180px] flex-1 resize-none rounded-[20px] border border-white bg-white/82 p-3 text-sm text-[#332b38] outline-none placeholder:text-[#665a70] focus:border-[#b696d4] focus:ring-4 focus:ring-[#eadcf7] disabled:cursor-not-allowed disabled:opacity-65"
          />
        </div>
        <button
          type="submit"
          disabled={isComposerBusy || !input.trim()}
          aria-label="Send message"
          data-testid="send-message-button"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[#7c5fb1] font-black text-white transition hover:bg-[#6f52a5] disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isPreparingAttachments ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <Send size={17} />
          )}
          {isPreparingAttachments ? "Preparing PDF..." : isCreating ? "Streaming..." : "Send"}
        </button>
        {isComposerBusy && (
          <p id={statusId} role="status" data-testid="message-send-status" className="sr-only">
            {isPreparingAttachments
              ? "Preparing PDF attachments for this node."
              : "Streaming answer for this node."}
          </p>
        )}
        {displayError && (
          <p
            id={errorId}
            role="alert"
            data-testid="message-error-alert"
            className="rounded-[18px] bg-[#ffeceb] px-3 py-2 text-sm font-bold text-[#8f3f3a]"
          >
            {displayError}
          </p>
        )}
      </form>
    </aside>
  );
}
