"use client";

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  Copy,
  Paperclip,
  Loader2,
  MessageSquare,
  Pencil,
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
} from "lucide-react";
import {
  ActiveSkillChip,
  AttachmentMenuButton,
  getAttachmentDetailLabel,
  isKnowledgeAttachment,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  getHighlightedActionClass,
  useHighlightedAction,
} from "@/components/ui/highlighted-action";
import type { ConversationMessageItem } from "@/lib/graph";
import { resolveRegenerateTargets } from "@/lib/message-regeneration";
import type {
  ChatAttachment,
  ChatMessage,
  ChatModelSelection,
  ChatSkill,
  MindNode,
} from "@/lib/types";
import { MarkdownMessage } from "./MarkdownMessage";
import { ThinkingElapsedTimer } from "./ThinkingElapsedTimer";
import {
  getResizeInputMode,
  type ResizeStartEvent,
} from "./WorkspaceResizeHandle";

const RESIZE_STORAGE_KEY = "branchmind:node-detail-resize";
const MIN_COMPOSER_HEIGHT = 120;
const MIN_HEADER_HEIGHT = 96;

function readStoredResize(): {
  composerHeight: number | null;
  headerHeight: number | null;
} {
  if (typeof window === "undefined") return { composerHeight: null, headerHeight: null };

  try {
    const raw = localStorage.getItem(RESIZE_STORAGE_KEY);
    if (!raw) return { composerHeight: null, headerHeight: null };
    const parsed = JSON.parse(raw) as {
      composerHeight?: number;
      headerHeight?: number;
    };
    return {
      composerHeight:
        typeof parsed.composerHeight === "number" ? parsed.composerHeight : null,
      headerHeight:
        typeof parsed.headerHeight === "number" ? parsed.headerHeight : null,
    };
  } catch {
    return { composerHeight: null, headerHeight: null };
  }
}

function clampHeight(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type NodeDetailPanelProps = {
  node: MindNode | null;
  conversationMessages?: ConversationMessageItem[];
  onCreateNode: (
    nodeId: string,
    mode: "continue" | "branch",
    instruction: string,
    sourceText?: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  onPopulateNode: (
    nodeId: string,
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onEditUserMessage: (
    nodeId: string,
    userMessageId: string,
    instruction: string,
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onRetryAssistantMessage: (
    nodeId: string,
    assistantMessageId: string,
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onUpdateNodeTitle: (nodeId: string, title: string) => Promise<boolean>;
  onToggleNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  isCreating: boolean;
  streamingMessageId?: string | null;
  isNotesOpen: boolean;
  error: string | null;
  onToggleNotes: () => void;
  onCollapse: () => void;
  initialSubmit?: boolean;
  autoPreparePdfAttachments?: boolean;
  onBeforeInitialSubmit?: (resumeSubmit: () => void) => boolean | Promise<boolean>;
  onStartProject?: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  showNotesAction?: boolean;
  showCollapseButton?: boolean;
  showComposer?: boolean;
  composerPlaceholder?: string;
  submitLabel?: string;
};

const SELECTION_ACTION_WIDTH = 176;
const SELECTION_ACTION_MARGIN = 12;
const SELECTION_ACTION_VERTICAL_OFFSET = 52;

type MessageActionButtonProps = {
  label: string;
  testId: string;
  title?: string;
  disabled?: boolean;
  highlightedHover?: boolean;
  onClick: () => void;
  children: ReactNode;
};

type HeaderActionItem = "edit" | "delete" | "notes";
type ModeActionItem = "continue" | "branch";

type SelectionAction = {
  text: string;
  x: number;
  y: number;
};

function clampSelectionActionPosition(value: number, max: number) {
  return Math.min(Math.max(value, SELECTION_ACTION_MARGIN), max);
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
  highlightedHover = false,
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
      className={`grid h-11 w-11 place-items-center rounded-full opacity-75 focus:outline-none focus:ring-2 focus:ring-current/25 disabled:cursor-not-allowed disabled:opacity-35 sm:h-8 sm:w-8 ${
        highlightedHover
          ? "text-current transition-all duration-100 ease-in hover:bg-neutral-900 hover:text-white hover:opacity-100 hover:shadow-lg hover:duration-1000 hover:ease-out"
          : "text-current transition hover:bg-white/70 hover:opacity-100"
      }`}
    >
      {children}
    </button>
  );
}

function MessageAttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  const { copy } = useLanguage();

  if (attachments.length === 0) return null;

  return (
    <ul
      aria-label={copy.chat.pendingAttachments}
      data-testid="message-attachment-list"
      className="mt-3 flex flex-wrap gap-2"
    >
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          data-testid="message-attachment"
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-neutral-700"
        >
          {isKnowledgeAttachment(attachment) ? (
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
        </li>
      ))}
    </ul>
  );
}

function NodeBriefCard({ node }: { node: MindNode }) {
  const { copy } = useLanguage();
  const summary = node.summary.trim();

  return (
    <article
      aria-label={copy.workspace.nodeBrief}
      data-testid="node-brief-card"
      className="node-brief-card rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-neutral-700"
    >
      <p className="mb-1 text-[11px] font-black uppercase tracking-wider text-neutral-500">{copy.workspace.nodeBrief}</p>
      <h3 className="text-base font-black leading-snug text-neutral-900">
        {node.title}
      </h3>
      {summary && <p className="mt-2 text-neutral-600">{summary}</p>}
    </article>
  );
}

export function NodeDetailPanel({
  node,
  conversationMessages,
  onCreateNode,
  onPopulateNode,
  onEditUserMessage,
  onRetryAssistantMessage,
  onUpdateNodeTitle,
  onToggleNode,
  onDeleteNode,
  isCreating,
  streamingMessageId,
  isNotesOpen,
  error,
  onToggleNotes,
  onCollapse,
  initialSubmit = false,
  autoPreparePdfAttachments = true,
  onBeforeInitialSubmit,
  onStartProject,
  showNotesAction = true,
  showCollapseButton = true,
  showComposer = true,
  composerPlaceholder,
}: NodeDetailPanelProps) {
  const { copy } = useLanguage();
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const errorId = `${panelId}-error`;
  const statusId = `${panelId}-status`;
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"continue" | "branch">("continue");
  const [selectedSourceText, setSelectedSourceText] = useState("");
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isCheckingInitialSubmit, setIsCheckingInitialSubmit] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState("");
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headerHighlight = useHighlightedAction<HeaderActionItem>();
  const modeHighlight = useHighlightedAction<ModeActionItem>({ defaultAction: mode });
  const clearHeaderHighlightedAction = headerHighlight.clearHighlightedAction;
  const clearModeHighlightedAction = modeHighlight.clearHighlightedAction;
  const composerControls = useChatComposerControls({
    isBusy: isCreating || isCheckingInitialSubmit,
    autoPreparePdfAttachments,
  });
  const resolvedComposerPlaceholder = composerPlaceholder ?? copy.workspace.askNextQuestion;
  const resetComposerAttachments = composerControls.resetAttachments;
  const messagesRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const headerResizePointerStartedAtRef = useRef(-Infinity);
  const composerResizePointerStartedAtRef = useRef(-Infinity);
  const streamingContent =
    node?.messages.find((message) => message.id === streamingMessageId)?.content ?? "";
  const displayMessages =
    node && conversationMessages
      ? conversationMessages
      : node
        ? node.messages.map((message) => ({
            sourceNodeId: node.id,
            message,
            inherited: false,
          }))
        : [];
  const shouldShowNodeBrief = Boolean(node && node.messages.length === 0);
  let lastNodeUserMessage: ChatMessage | null = null;
  let lastNodeAssistantMessage: ChatMessage | null = null;
  if (node) {
    for (let index = node.messages.length - 1; index >= 0; index -= 1) {
      const message = node.messages[index];
      if (!lastNodeAssistantMessage && message.role === "assistant") {
        lastNodeAssistantMessage = message;
      }
      if (!lastNodeUserMessage && message.role === "user") {
        lastNodeUserMessage = message;
      }
      if (lastNodeUserMessage && lastNodeAssistantMessage) break;
    }
  }
  const latestEditableUserMessageId =
    node && lastNodeUserMessage &&
    resolveRegenerateTargets(node.messages, {
      userMessageId: lastNodeUserMessage.id,
    })?.isLatestAssistant
      ? lastNodeUserMessage.id
      : null;
  const latestRetryableAssistantMessageId =
    node && lastNodeAssistantMessage &&
    resolveRegenerateTargets(node.messages, {
      assistantMessageId: lastNodeAssistantMessage.id,
    })?.isLatestAssistant
      ? lastNodeAssistantMessage.id
      : null;
  const isComposerBusy = composerControls.controlsBusy;
  const displayError = composerControls.attachmentError ?? error;
  const isInitialSubmit = initialSubmit;
  const isBlankNode = !isInitialSubmit && Boolean(node && node.messages.length === 0);
  const hasSelectedTextContext =
    !isInitialSubmit && !isBlankNode && selectedSourceText.length > 0;
  const isTitleEditBusy = isCreating || isComposerBusy;
  const titleEditTrimmed = titleEditValue.trim();
  const isTitleSaveDisabled =
    isTitleEditBusy || !node || !titleEditTrimmed || titleEditTrimmed === node.title.trim();

  const clearSelectedSourceText = useCallback(() => {
    setSelectedSourceText("");
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const clearSelectionAction = useCallback(() => {
    setSelectionAction(null);
  }, []);

  const captureSelectionAction = useCallback(() => {
    const container = messagesRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectionAction(null);
      return;
    }

    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      setSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const fallbackRect = Array.from(range.getClientRects()).find(
      (item) => item.width > 0 || item.height > 0,
    );
    const selectionRect = rect.width > 0 || rect.height > 0 ? rect : fallbackRect;
    if (!selectionRect) {
      setSelectionAction(null);
      return;
    }

    const maxLeft = Math.max(
      SELECTION_ACTION_MARGIN,
      window.innerWidth - SELECTION_ACTION_WIDTH - SELECTION_ACTION_MARGIN,
    );
    const x = clampSelectionActionPosition(
      selectionRect.left + selectionRect.width / 2 - SELECTION_ACTION_WIDTH / 2,
      maxLeft,
    );
    const topAbove = selectionRect.top - SELECTION_ACTION_VERTICAL_OFFSET;
    const topBelow = selectionRect.bottom + 8;
    const maxTop = Math.max(SELECTION_ACTION_MARGIN, window.innerHeight - 48);
    const y = clampSelectionActionPosition(
      topAbove >= SELECTION_ACTION_MARGIN ? topAbove : topBelow,
      maxTop,
    );

    setSelectionAction({ text, x, y });
  }, []);

  useEffect(() => {
    const stored = readStoredResize();
    setComposerHeight(stored.composerHeight);
    setHeaderHeight(stored.headerHeight);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(
        RESIZE_STORAGE_KEY,
        JSON.stringify({ composerHeight, headerHeight }),
      );
    } catch {
      // Storage may be unavailable in private mode or due to quota.
    }
  }, [composerHeight, headerHeight]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;

    function clampHeights() {
      const panelHeight = panel?.clientHeight ?? 0;
      if (!panelHeight) return;
      const maxHeight = Math.floor(panelHeight * 0.5);
      setComposerHeight((current) =>
        current === null ? null : clampHeight(current, MIN_COMPOSER_HEIGHT, maxHeight),
      );
    }

    clampHeights();
    window.addEventListener("resize", clampHeights);
    return () => window.removeEventListener("resize", clampHeights);
  }, []);

  useEffect(() => {
    clearSelectedSourceText();
    resetComposerAttachments();
    setEditingMessageId(null);
    setEditingValue("");
    setIsEditingTitle(false);
    setTitleEditValue("");
    clearHeaderHighlightedAction();
    clearModeHighlightedAction();
  }, [
    clearSelectedSourceText,
    clearHeaderHighlightedAction,
    clearModeHighlightedAction,
    node?.id,
    resetComposerAttachments,
  ]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  useEffect(() => {
    if (!selectionAction) return undefined;

    window.addEventListener("resize", clearSelectionAction);
    window.addEventListener("scroll", clearSelectionAction, true);

    return () => {
      window.removeEventListener("resize", clearSelectionAction);
      window.removeEventListener("scroll", clearSelectionAction, true);
    };
  }, [clearSelectionAction, selectionAction]);

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

  async function submitComposer() {
    const trimmed = input.trim();
    if (!node || !trimmed || isComposerBusy) return;

    if (isInitialSubmit && onBeforeInitialSubmit) {
      setIsCheckingInitialSubmit(true);
      try {
        const canSubmit = await onBeforeInitialSubmit(() => {
          void submitComposer();
        });
        if (!canSubmit) return;
      } finally {
        setIsCheckingInitialSubmit(false);
      }
    }

    const preparedAttachments = await composerControls.prepareAttachmentsForSend();
    if (!preparedAttachments) return;

    const skill = composerControls.prepareSkillForSend();

    if (isInitialSubmit) {
      const projectId = await onStartProject?.(
        trimmed,
        preparedAttachments,
        composerControls.modelSelection,
        skill,
      );
      if (projectId) {
        setInput("");
        composerControls.resetAttachments();
        clearSelectedSourceText();
      }
      return;
    }

    if (isBlankNode) {
      const populated = await onPopulateNode(
        node.id,
        trimmed,
        preparedAttachments,
        composerControls.modelSelection,
        skill,
      );
      if (populated) {
        setInput("");
        composerControls.resetAttachments();
        clearSelectedSourceText();
      }
      return;
    }

    const sourceText = hasSelectedTextContext ? selectedSourceText : undefined;
    const createdNodeId = await onCreateNode(
      node.id,
      mode,
      trimmed,
      sourceText,
      preparedAttachments,
      composerControls.modelSelection,
      skill,
    );
    if (createdNodeId) {
      setInput("");
      composerControls.resetAttachments();
      clearSelectedSourceText();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitComposer();
  }

  function handleAskBranchMindSelection() {
    if (isInitialSubmit || isBlankNode || !node || !selectionAction || isComposerBusy) return;
    setSelectedSourceText(selectionAction.text);
    setMode("branch");
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }

  async function handleCopyMessage(message: ChatMessage, messageKey: string) {
    if (!message.content) return;

    try {
      await copyTextToClipboard(message.content);
      setCopiedMessageKey(messageKey);
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageKey((currentKey) =>
          currentKey === messageKey ? null : currentKey,
        );
      }, 1800);
    } catch {
      setCopiedMessageKey(null);
    }
  }

  function handleStartEdit(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditingValue(message.content);
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }

  async function handleSaveEdit() {
    if (!node || !editingMessageId || isCreating) return;
    const trimmed = editingValue.trim();
    if (!trimmed) return;

    const skill = composerControls.prepareSkillForSend();
    const started = await onEditUserMessage(
      node.id,
      editingMessageId,
      trimmed,
      composerControls.modelSelection,
      skill,
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

  function handleStartTitleEdit() {
    if (!node || isInitialSubmit || isTitleEditBusy) return;
    setEditingMessageId(null);
    setEditingValue("");
    setTitleEditValue(node.title);
    setIsEditingTitle(true);
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }

  function handleCancelTitleEdit() {
    setIsEditingTitle(false);
    setTitleEditValue("");
  }

  async function handleSaveTitleEdit() {
    if (!node || isTitleSaveDisabled) return;

    const saved = await onUpdateNodeTitle(node.id, titleEditTrimmed);
    if (saved) {
      setIsEditingTitle(false);
      setTitleEditValue("");
    }
  }

  function handleTitleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelTitleEdit();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void handleSaveTitleEdit();
    }
  }

  function handleRetryMessage(message: ChatMessage) {
    if (!node || isCreating) return;
    const skill = composerControls.prepareSkillForSend();
    void onRetryAssistantMessage(node.id, message.id, composerControls.modelSelection, skill);
  }

  function getPanelMaxResizeHeight() {
    const panelHeight = panelRef.current?.clientHeight ?? 0;
    return panelHeight > 0 ? Math.floor(panelHeight * 0.5) : Number.MAX_SAFE_INTEGER;
  }

  function getCurrentComposerHeight() {
    const composerElement = panelRef.current?.querySelector(
      ".node-detail-composer",
    ) as HTMLElement | null;
    return composerElement?.clientHeight ?? MIN_COMPOSER_HEIGHT;
  }

  const handleComposerResizeStart = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";
    const startY = event.clientY;
    const startHeight = composerHeight ?? getCurrentComposerHeight();
    const maxHeight = getPanelMaxResizeHeight();

    function resizeTo(clientY: number) {
      const deltaY = startY - clientY;
      const nextHeight = clampHeight(
        startHeight + deltaY,
        MIN_COMPOSER_HEIGHT,
        maxHeight,
      );
      setComposerHeight(nextHeight);
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      resizeTo(moveEvent.clientY);
    }

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      resizeTo(moveEvent.clientY);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    if (isPointerResize) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    } else {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp, { once: true });
    }
  }, [composerHeight]);

  const handleComposerResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    composerResizePointerStartedAtRef.current = event.timeStamp;
    handleComposerResizeStart(event);
  }, [handleComposerResizeStart]);

  const handleComposerResizeMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.timeStamp - composerResizePointerStartedAtRef.current < 100) return;
    handleComposerResizeStart(event);
  }, [handleComposerResizeStart]);

  function getCurrentHeaderHeight() {
    const headerElement = panelRef.current?.querySelector(
      ".node-detail-header-region",
    ) as HTMLElement | null;
    return headerElement?.clientHeight ?? MIN_HEADER_HEIGHT;
  }

  const handleHeaderResizeStart = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";
    const startY = event.clientY;
    const startHeight = headerHeight ?? getCurrentHeaderHeight();
    const maxHeight = getPanelMaxResizeHeight();

    function resizeTo(clientY: number) {
      const deltaY = clientY - startY;
      const nextHeight = clampHeight(
        startHeight + deltaY,
        MIN_HEADER_HEIGHT,
        maxHeight,
      );
      setHeaderHeight(nextHeight);
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      resizeTo(moveEvent.clientY);
    }

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      resizeTo(moveEvent.clientY);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    if (isPointerResize) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    } else {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp, { once: true });
    }
  }, [headerHeight]);

  const handleHeaderResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    headerResizePointerStartedAtRef.current = event.timeStamp;
    handleHeaderResizeStart(event);
  }, [handleHeaderResizeStart]);

  const handleHeaderResizeMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.timeStamp - headerResizePointerStartedAtRef.current < 100) return;
    handleHeaderResizeStart(event);
  }, [handleHeaderResizeStart]);

  if (!node) {
    return (
      <aside
        aria-label={copy.workspace.nodeDetails}
        data-testid="node-detail-panel"
        className="node-detail-panel-surface flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none"
      >
        {showCollapseButton && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={copy.workspace.collapseNodeDetails}
            aria-expanded="true"
            data-testid="collapse-node-detail-panel-button"
            className="node-detail-icon-button grid h-10 w-10 place-items-center self-end rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <PanelRightClose size={18} />
          </button>
        )}
        <div className="grid min-h-[128px] flex-1 place-items-center text-center text-sm font-bold text-neutral-600">
          <span role="status" aria-live="polite" data-testid="node-detail-empty-state">
            {copy.workspace.nodeNotSelected}
          </span>
        </div>
      </aside>
    );
  }

  const isTitleEditButtonEnabled = !isInitialSubmit && !isEditingTitle && !isTitleEditBusy;
  const isDeleteButtonEnabled = Boolean(node.parentId && !isCreating);
  const isTitleEditButtonHighlighted = headerHighlight.isHighlighted("edit", {
    enabled: isTitleEditButtonEnabled,
  });
  const isDeleteButtonHighlighted = headerHighlight.isHighlighted("delete", {
    enabled: isDeleteButtonEnabled,
  });
  const isNotesButtonHighlighted = headerHighlight.isHighlighted("notes", {
    active: isNotesOpen,
  });
  const isContinueModeHighlighted = modeHighlight.isHighlighted("continue");
  const isBranchModeHighlighted = modeHighlight.isHighlighted("branch");

  const panelStyle = {
    "--node-detail-composer-height":
      composerHeight === null ? undefined : `${composerHeight}px`,
    "--node-detail-header-height":
      headerHeight === null ? undefined : `${headerHeight}px`,
  } as CSSProperties;

  return (
    <aside
      ref={panelRef}
      aria-labelledby={titleId}
      data-testid="node-detail-panel"
      data-has-composer={showComposer ? "true" : "false"}
      className="node-detail-panel-surface grid h-full min-h-0 w-full overflow-visible rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none"
      style={panelStyle}
    >
      <div className="node-detail-header-region relative min-h-0 shrink-0 overflow-hidden border-b border-neutral-200 pb-3 sm:pb-4">
        <section className="node-detail-header min-h-0 space-y-3 overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex shrink-0 items-center gap-2">
              {showCollapseButton && (
                <button
                  type="button"
                  onClick={onCollapse}
                  aria-label={copy.workspace.collapseNodeDetails}
                  aria-controls="conversation-history"
                  aria-expanded="true"
                  data-testid="collapse-node-detail-panel-button"
                  className="node-detail-icon-button grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <PanelRightClose size={18} />
                </button>
              )}
              {!isInitialSubmit && !isEditingTitle && (
                <button
                  type="button"
                  onClick={handleStartTitleEdit}
                  disabled={isTitleEditBusy}
                  aria-label={copy.workspace.editNodeTitle}
                  title={copy.workspace.editNodeTitle}
                  data-testid="edit-node-title-button"
                  data-highlighted={headerHighlight.getDataHighlighted("edit", {
                    enabled: isTitleEditButtonEnabled,
                  })}
                  {...headerHighlight.getHoverHandlers("edit", { clearOnMouseLeave: true })}
                  className={`node-detail-icon-button grid h-10 w-10 place-items-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-45 ${getHighlightedActionClass(
                    isTitleEditButtonHighlighted,
                    "bg-neutral-100 text-brand-600",
                  )}`}
                >
                  <Pencil size={16} />
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3 text-right">
              <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
                {node.branchType}
              </p>
              {isEditingTitle ? (
                <div className="flex items-start justify-end gap-2">
                  <input
                    ref={titleInputRef}
                    id={titleId}
                    value={titleEditValue}
                    onChange={(event) => setTitleEditValue(event.target.value)}
                    onKeyDown={handleTitleEditKeyDown}
                    disabled={isTitleEditBusy}
                    aria-label={copy.workspace.editNodeTitle}
                    data-testid="node-title-edit-input"
                    maxLength={120}
                    className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-right text-lg font-black leading-snug text-neutral-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65 sm:text-xl"
                  />
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={handleCancelTitleEdit}
                      disabled={isTitleEditBusy}
                      aria-label={copy.common.cancel}
                      title={copy.common.cancel}
                      data-testid="cancel-node-title-edit-button"
                      className="node-detail-icon-button grid h-10 w-10 place-items-center rounded-full bg-white/75 text-neutral-600 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <X size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveTitleEdit()}
                      disabled={isTitleSaveDisabled}
                      aria-label={copy.workspace.saveNodeTitle}
                      title={copy.common.save}
                      data-testid="save-node-title-edit-button"
                      className="node-detail-icon-button node-detail-icon-button-save grid h-10 w-10 place-items-center rounded-full bg-success-100 text-success-700 transition hover:bg-success-200 focus:outline-none focus:ring-4 focus:ring-success-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Save size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <h2 id={titleId} className="text-lg font-black leading-snug text-neutral-900 sm:text-xl">
                  {node.title}
                </h2>
              )}
              <p className="text-sm leading-6 text-neutral-600">{node.summary}</p>
              <div className="flex flex-wrap justify-end gap-2">
                {node.children.length > 0 && (
                  <button
                    type="button"
                    disabled={isCreating}
                    onClick={() => onToggleNode(node.id)}
                    aria-label={node.collapsed ? copy.workspace.expandNode : copy.workspace.foldNode}
                    aria-expanded={!node.collapsed}
                    aria-controls="mind-map"
                    data-testid="toggle-node-button"
                    className="node-detail-tertiary-action node-detail-fold-action inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-100 px-3 text-sm font-black text-neutral-600 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <Ribbon size={16} />
                    {node.collapsed ? copy.workspace.expandNode : copy.workspace.fold}
                  </button>
                )}
                {node.parentId && (
                  <button
                    type="button"
                    disabled={isCreating}
                    onClick={() => onDeleteNode(node.id)}
                    aria-label={copy.workspace.deleteNode}
                    data-testid="delete-node-button"
                    data-highlighted={headerHighlight.getDataHighlighted("delete", {
                      enabled: isDeleteButtonEnabled,
                    })}
                    {...headerHighlight.getHoverHandlers("delete", { clearOnMouseLeave: true })}
                    className={`node-detail-tertiary-action node-detail-delete-action inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-black transition-all focus:outline-none focus:ring-2 focus:ring-danger-100 disabled:cursor-not-allowed disabled:opacity-65 ${getHighlightedActionClass(
                      isDeleteButtonHighlighted,
                      "bg-danger-50 text-danger-600",
                    )}`}
                  >
                    <Trash2 size={16} />
                    {copy.common.delete}
                  </button>
                )}
                {showNotesAction && (
                  <button
                    type="button"
                    onClick={onToggleNotes}
                    aria-label={isNotesOpen ? copy.workspace.closeProjectNotes : copy.workspace.openProjectNotes}
                    aria-controls="project-notes-panel"
                    aria-expanded={isNotesOpen}
                    data-testid="node-detail-notes-button"
                    data-highlighted={headerHighlight.getDataHighlighted("notes", {
                      active: isNotesOpen,
                    })}
                    {...headerHighlight.getHoverHandlers("notes", { clearOnMouseLeave: true })}
                    className={`node-detail-tertiary-action node-detail-notes-action inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-black transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 ${getHighlightedActionClass(
                      isNotesButtonHighlighted,
                      "bg-neutral-100 text-neutral-700",
                    )}`}
                  >
                    <NotebookPen size={16} />
                    {copy.common.notes}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
        <div
          role="separator"
          aria-label={copy.workspace.resizeConversationHeader}
          aria-orientation="horizontal"
          data-testid="resize-conversation-header-handle"
          onPointerDown={handleHeaderResizePointerDown}
          onMouseDown={handleHeaderResizeMouseDown}
          className="absolute -bottom-2 left-0 z-10 h-4 w-full cursor-row-resize transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
        />
      </div>

      <section
        id="conversation-history"
        ref={messagesRef}
        aria-label={copy.workspace.conversationHistory}
        aria-busy={isCreating}
        data-testid="conversation-history"
        onKeyUp={captureSelectionAction}
        onMouseUp={captureSelectionAction}
        onTouchEnd={captureSelectionAction}
        className="conversation-history-scrollable relative min-h-0 flex-1 space-y-3 overflow-auto overscroll-contain py-4 pr-1"
      >
        {displayMessages.length === 0 && node ? (
          <NodeBriefCard node={node} />
        ) : (
          <>
            {shouldShowNodeBrief && node && <NodeBriefCard node={node} />}
            {displayMessages.map(({ sourceNodeId, message, inherited }) => {
            const messageKey = `${sourceNodeId}:${message.id}`;
            const isStreamingAssistant =
              isCreating &&
              sourceNodeId === node.id &&
              message.id === streamingMessageId &&
              message.role === "assistant";
            const isEditingMessage =
              !inherited && message.role === "user" && message.id === editingMessageId;
            const isCopied = copiedMessageKey === messageKey;

            return (
                  <div
                key={messageKey}
                data-testid="conversation-message"
                data-message-id={message.id}
                data-source-node-id={sourceNodeId}
                data-inherited={inherited ? "true" : undefined}
                data-streaming={isStreamingAssistant ? "true" : undefined}
                className={`group text-sm leading-6 ${
                  message.role === "user"
                    ? "text-text-primary sm:ml-6"
                    : "text-text-primary sm:mr-6"
                }`}
              >
                <article
                  aria-label={`${message.role === "user" ? copy.workspace.user : copy.workspace.assistant} message`}
                  aria-live={isStreamingAssistant ? "polite" : undefined}
                  data-role={message.role}
                  className={`rounded-xl border p-3 ${
                    message.role === "user"
                      ? "border-brand-200 bg-brand-50"
                      : "border-neutral-200 bg-surface-muted"
                  }`}
                >
                  <p
                    className={`mb-1 text-[11px] font-black uppercase tracking-wider ${
                      message.role === "user" ? "text-brand-600" : "text-text-muted"
                    }`}
                  >
                    {message.role === "user" ? copy.workspace.userShort : copy.workspace.assistant}
                  </p>
                  {isEditingMessage ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        disabled={isCreating}
                        aria-label={copy.workspace.editUserMessage}
                        data-testid="message-edit-input"
                        rows={4}
                        className="w-full resize-none rounded-xl border border-neutral-200 bg-white p-3 text-sm leading-6 text-text-primary outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
                      />
                      <div className="flex justify-end gap-2">
                        <MessageActionButton
                          label={copy.workspace.cancelMessageEdit}
                          testId="cancel-message-edit-button"
                          onClick={handleCancelEdit}
                          disabled={isCreating}
                        >
                          <X size={15} />
                        </MessageActionButton>
                        <MessageActionButton
                          label={copy.workspace.saveMessageEdit}
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
                        message.content || ""
                      }
                      citations={message.citations ?? []}
                      isStreaming={isStreamingAssistant}
                    />
                  )}
                  <MessageAttachmentList attachments={message.attachments ?? []} />
                  {isStreamingAssistant && (
                    <p
                      role="status"
                      aria-live="polite"
                      data-testid="message-streaming-status"
                      className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-600"
                    >
                      <ThinkingElapsedTimer />
                    </p>
                  )}
                </article>
                {!isEditingMessage && (
                  <div
                    role="group"
                    aria-label={copy.workspace.messageActions(message.role)}
                    data-testid="conversation-message-actions"
                    className={`mt-1 flex h-8 gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${
                      message.role === "user" ? "justify-end pr-2" : "justify-start pl-2"
                    }`}
                  >
                    <MessageActionButton
                      label={copy.workspace.copyRoleMessage(message.role)}
                      title={isCopied ? copy.common.copied : copy.workspace.copyRoleMessage(message.role)}
                      testId="copy-message-button"
                      onClick={() => void handleCopyMessage(message, messageKey)}
                      disabled={!message.content}
                    >
                      {isCopied ? <Check size={15} /> : <Copy size={15} />}
                    </MessageActionButton>
                    {!inherited && sourceNodeId === node.id && (
                      message.role === "user" ? (
                        message.id === latestEditableUserMessageId && (
                          <MessageActionButton
                            label={copy.workspace.editUserMessage}
                            testId="edit-message-button"
                            onClick={() => handleStartEdit(message)}
                            disabled={isCreating}
                            highlightedHover
                          >
                            <Pencil size={15} />
                          </MessageActionButton>
                        )
                      ) : (
                        message.id === latestRetryableAssistantMessageId && (
                          <MessageActionButton
                            label={copy.workspace.retryAssistant}
                            testId="retry-message-button"
                            onClick={() => handleRetryMessage(message)}
                            disabled={isCreating}
                          >
                            <RotateCcw size={15} />
                          </MessageActionButton>
                        )
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </>
        )}
      </section>

      {selectionAction && !isInitialSubmit && !isBlankNode && !isComposerBusy && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleAskBranchMindSelection}
          aria-label={copy.workspace.askBranchMindSelection}
          data-testid="ask-branchmind-selection-button"
          style={{ left: selectionAction.x, top: selectionAction.y }}
          className="node-selection-action fixed z-50 inline-flex h-9 min-w-[154px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-neutral-200/90 bg-white/95 px-3.5 text-[13px] font-bold leading-none tracking-normal text-neutral-800 shadow-lg shadow-neutral-900/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
        >
          <MessageSquare size={14} className="shrink-0 text-brand-700" />
          {copy.workspace.askBranchMind}
        </button>
      )}

      {showComposer && (
        <section className="node-detail-composer relative flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-neutral-200 bg-inherit pt-3">
          <div
            role="separator"
            aria-label={copy.workspace.resizeConversationComposer}
            aria-orientation="horizontal"
            data-testid="resize-conversation-composer-handle"
            onPointerDown={handleComposerResizePointerDown}
            onMouseDown={handleComposerResizeMouseDown}
            className="absolute -top-2 left-0 z-10 h-4 w-full cursor-row-resize transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
          />
          <form
            aria-label={copy.workspace.messageComposer}
            aria-busy={isComposerBusy}
            aria-describedby={displayError ? errorId : isComposerBusy ? statusId : undefined}
            data-testid="message-composer"
            onSubmit={handleSubmit}
            className="flex h-full min-h-0 flex-1 flex-col justify-end overflow-visible"
          >
          <div className="flex shrink-0 flex-col gap-3">
          {!isInitialSubmit && !isBlankNode && (
            <div
              role="group"
              aria-label={copy.workspace.branch}
              data-testid="message-branch-mode"
              onMouseLeave={modeHighlight.clearHighlightedAction}
              className="grid grid-cols-2 gap-2"
            >
              <button
                type="button"
                onClick={() => setMode("continue")}
                disabled={isComposerBusy}
                aria-label={copy.workspace.continueDown}
                aria-pressed={mode === "continue"}
                data-testid="continue-down-button"
                data-highlighted={modeHighlight.getDataHighlighted("continue")}
                {...modeHighlight.getPointerHoverHandlers("continue")}
                className={`node-detail-mode-button node-detail-mode-continue inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65 sm:h-11 ${getHighlightedActionClass(
                  isContinueModeHighlighted,
                  "bg-neutral-100 text-neutral-700",
                )}`}
              >
                <Sprout size={16} />
                {copy.workspace.continue}
              </button>
              <button
                type="button"
                onClick={() => setMode("branch")}
                disabled={isComposerBusy}
                aria-label={copy.workspace.branchRight}
                aria-pressed={mode === "branch"}
                data-testid="branch-right-button"
                data-highlighted={modeHighlight.getDataHighlighted("branch")}
                {...modeHighlight.getPointerHoverHandlers("branch")}
                className={`node-detail-mode-button node-detail-mode-branch inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-black transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65 sm:h-11 ${getHighlightedActionClass(
                  isBranchModeHighlighted,
                  "bg-neutral-100 text-neutral-700",
                )}`}
              >
                <GitBranch size={16} />
                {copy.workspace.branch}
              </button>
            </div>
          )}
          <PendingAttachmentChips
            attachments={composerControls.pendingAttachments}
            disabled={isComposerBusy}
            onRemove={composerControls.removePendingAttachment}
          />
          {composerControls.activeSkill && (
            <ActiveSkillChip
              skill={composerControls.activeSkill}
              disabled={isComposerBusy}
              onRemove={composerControls.removeActiveSkill}
            />
          )}
          <div className="node-detail-composer-box relative h-[132px] shrink-0 rounded-[20px] border border-neutral-200/80 bg-white shadow-sm transition focus-within:border-brand-300 focus-within:shadow-md focus-within:shadow-brand-100/20 focus-within:ring-4 focus-within:ring-brand-100/30">
            {hasSelectedTextContext && (
              <div className="px-3 pt-3">
                <div
                  aria-label={copy.workspace.selectedTextCount}
                  data-testid="selected-text-context-chip"
                  className="node-selected-text-chip inline-flex max-w-full items-center gap-2 rounded-full border border-neutral-200/70 bg-white/75 px-3 py-1.5 text-xs font-bold tracking-normal text-neutral-700 shadow-sm"
                >
                  <MessageSquare size={14} className="shrink-0 text-neutral-500" />
                  <span className="min-w-0 truncate">{copy.workspace.selectedTextCount}</span>
                  <button
                    type="button"
                    onClick={clearSelectedSourceText}
                    disabled={isComposerBusy}
                    aria-label={copy.workspace.removeSelectedText}
                    data-testid="remove-selected-text-context-button"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-neutral-500 transition hover:bg-white hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={isComposerBusy}
              aria-label={copy.workspace.messageInstruction}
              aria-describedby={displayError ? errorId : undefined}
              data-testid="message-instruction-input"
              placeholder={resolvedComposerPlaceholder}
              rows={3}
              className={`message-instruction-input-scrollable h-full min-h-0 w-full overflow-y-auto resize-none bg-transparent px-3 pb-16 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 transition disabled:cursor-not-allowed disabled:opacity-65 sm:px-4 ${
                hasSelectedTextContext ? "pt-3" : "pt-4"
              }`}
            />
            <div className="absolute bottom-3 right-14 flex max-w-[calc(100%-4.75rem)] items-center justify-end gap-2">
              <AttachmentMenuButton controls={composerControls} alignment="end" />
              <ModelSelectorButton controls={composerControls} alignment="end" />
            </div>
            <div className="absolute bottom-3 right-3">
              <button
                type="submit"
                disabled={isComposerBusy || !input.trim()}
                aria-label={copy.workspace.send}
                data-testid="send-message-button"
                className="branchmind-primary-action inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 p-0 text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {composerControls.isPreparingAttachments || isCheckingInitialSubmit ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </button>
            </div>
          </div>
          {isComposerBusy && (
            <p id={statusId} role="status" data-testid="message-send-status" className="sr-only">
              {composerControls.isPreparingAttachments
                ? copy.workspace.preparingPdfAttachments
                : isInitialSubmit
                  ? copy.workspace.createWorkspace
                  : copy.workspace.streamingAnswer}
            </p>
          )}
          {displayError && (
            <p
              id={errorId}
              role="alert"
              data-testid="message-error-alert"
              className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700"
            >
              {displayError}
            </p>
          )}
          </div>
        </form>
      </section>
      )}
    </aside>
  );
}
