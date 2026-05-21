"use client";

import {
  type FormEvent,
  type KeyboardEvent,
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
  AttachmentMenuButton,
  getAttachmentDetailLabel,
  isKnowledgeAttachment,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import type { ConversationMessageItem } from "@/lib/graph";
import type {
  ChatAttachment,
  ChatMessage,
  ChatModelSelection,
  MindNode,
} from "@/lib/types";
import { MarkdownMessage } from "./MarkdownMessage";

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
  onUpdateNodeTitle: (nodeId: string, title: string) => Promise<boolean>;
  onToggleNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  isCreating: boolean;
  isNotesOpen: boolean;
  error: string | null;
  onToggleNotes: () => void;
  onCollapse: () => void;
  initialSubmit?: boolean;
  onStartProject?: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
  ) => Promise<string | null>;
  showNotesAction?: boolean;
  showCollapseButton?: boolean;
  showComposer?: boolean;
  composerPlaceholder?: string;
  submitLabel?: string;
};

const DEFAULT_SELECTION_BRANCH_INSTRUCTION = "Explain the selected text in a focused branch.";
const SELECTION_PREVIEW_LIMIT = 180;

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
      className="grid h-11 w-11 place-items-center rounded-full text-current opacity-75 transition hover:bg-white/70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/25 disabled:cursor-not-allowed disabled:opacity-35 sm:h-8 sm:w-8"
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

function NodeBriefCard({ node }: { node: MindNode }) {
  const summary = node.summary.trim();

  return (
    <article
      aria-label="Node brief"
      data-testid="node-brief-card"
      className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-neutral-700"
    >
      <p className="mb-1 text-[11px] font-black uppercase tracking-wider text-neutral-500">Node brief</p>
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
  onEditUserMessage,
  onRetryAssistantMessage,
  onUpdateNodeTitle,
  onToggleNode,
  onDeleteNode,
  isCreating,
  isNotesOpen,
  error,
  onToggleNotes,
  onCollapse,
  initialSubmit = false,
  onStartProject,
  showNotesAction = true,
  showCollapseButton = true,
  showComposer = true,
  composerPlaceholder = "Ask the next question...",
  submitLabel = "Send",
}: NodeDetailPanelProps) {
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const errorId = `${panelId}-error`;
  const statusId = `${panelId}-status`;
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"continue" | "branch">("continue");
  const [selectedSourceText, setSelectedSourceText] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState("");
  const composerControls = useChatComposerControls({ isBusy: isCreating });
  const resetComposerAttachments = composerControls.resetAttachments;
  const messagesRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const lastMessage = node?.messages[node.messages.length - 1] ?? null;
  const streamingMessageId =
    isCreating && lastMessage?.role === "assistant" ? lastMessage.id : null;
  const streamingContent = streamingMessageId ? lastMessage?.content ?? "" : "";
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
  const isComposerBusy = composerControls.controlsBusy;
  const displayError = composerControls.attachmentError ?? error;
  const isInitialSubmit = initialSubmit;
  const isTitleEditBusy = isCreating || isComposerBusy;
  const titleEditTrimmed = titleEditValue.trim();
  const isTitleSaveDisabled =
    isTitleEditBusy || !node || !titleEditTrimmed || titleEditTrimmed === node.title.trim();

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
    clearSelectedSourceText();
    resetComposerAttachments();
    setEditingMessageId(null);
    setEditingValue("");
    setIsEditingTitle(false);
    setTitleEditValue("");
  }, [clearSelectedSourceText, node?.id, resetComposerAttachments]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!node || !trimmed || isComposerBusy) return;
    const preparedAttachments = await composerControls.prepareAttachmentsForSend();
    if (!preparedAttachments) return;

    if (isInitialSubmit) {
      const projectId = await onStartProject?.(
        trimmed,
        preparedAttachments,
        composerControls.selectedModel,
      );
      if (projectId) {
        setInput("");
        composerControls.resetAttachments();
        clearSelectedSourceText();
      }
      return;
    }

    const sourceText = mode === "branch" && selectedSourceText ? selectedSourceText : undefined;
    const createdNodeId = await onCreateNode(
      node.id,
      mode,
      trimmed,
      sourceText,
      preparedAttachments,
      composerControls.selectedModel,
    );
    if (createdNodeId) {
      setInput("");
      composerControls.resetAttachments();
      clearSelectedSourceText();
    }
  }

  async function handleBranchFromSelection() {
    if (isInitialSubmit || !node || !selectedSourceText || isComposerBusy) return;
    const instruction = input.trim() || DEFAULT_SELECTION_BRANCH_INSTRUCTION;
    const preparedAttachments = await composerControls.prepareAttachmentsForSend();
    if (!preparedAttachments) return;
    const createdNodeId = await onCreateNode(
      node.id,
      "branch",
      instruction,
      selectedSourceText,
      preparedAttachments,
      composerControls.selectedModel,
    );
    if (createdNodeId) {
      setInput("");
      composerControls.resetAttachments();
      clearSelectedSourceText();
    }
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
      composerControls.selectedModel,
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
    clearSelectedSourceText();
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
    void onRetryAssistantMessage(node.id, message.id, composerControls.selectedModel);
  }

  if (!node) {
    return (
      <aside
        aria-label="Node details"
        data-testid="node-detail-panel"
        className="flex h-full min-h-0 w-full max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-lg lg:max-h-full lg:self-start lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none"
      >
        {showCollapseButton && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse node details panel"
            aria-expanded="true"
            data-testid="collapse-node-detail-panel-button"
            className="grid h-11 w-11 place-items-center self-end rounded-full bg-white/75 text-[#6c538d] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
          >
            <PanelRightClose size={18} />
          </button>
        )}
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
      className={`grid h-full min-h-0 w-full max-h-[calc(100vh-2rem)] overflow-hidden rounded-[28px] border border-white/80 bg-white/72 p-4 shadow-lg shadow-[#e4d6ef]/40 lg:max-h-full lg:self-start lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none ${
        showComposer
          ? "grid-rows-[auto_minmax(0,1fr)_auto]"
          : "grid-rows-[auto_minmax(0,1fr)]"
      }`}
    >
        <div className="shrink-0 space-y-3 border-b border-neutral-200 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
              {node.branchType}
            </p>
            {isEditingTitle ? (
              <div className="flex items-start gap-2">
                <input
                  ref={titleInputRef}
                  id={titleId}
                  value={titleEditValue}
                  onChange={(event) => setTitleEditValue(event.target.value)}
                  onKeyDown={handleTitleEditKeyDown}
                  disabled={isTitleEditBusy}
                  aria-label="Edit node title"
                  data-testid="node-title-edit-input"
                  maxLength={120}
                  className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xl font-black leading-snug text-neutral-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
                />
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={handleCancelTitleEdit}
                    disabled={isTitleEditBusy}
                    aria-label="Cancel node title edit"
                    title="Cancel"
                    data-testid="cancel-node-title-edit-button"
                    className="grid h-10 w-10 place-items-center rounded-full bg-white/75 text-[#776c80] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <X size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveTitleEdit()}
                    disabled={isTitleSaveDisabled}
                    aria-label="Save node title"
                    title="Save"
                    data-testid="save-node-title-edit-button"
                    className="grid h-10 w-10 place-items-center rounded-full bg-[#dff5ea] text-[#376f51] transition hover:bg-[#ccefdc] focus:outline-none focus:ring-4 focus:ring-[#d7f0e2] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Save size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <h2 id={titleId} className="text-xl font-black leading-snug text-neutral-900">
                {node.title}
              </h2>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isInitialSubmit && !isEditingTitle && (
              <button
                type="button"
                onClick={handleStartTitleEdit}
                disabled={isTitleEditBusy}
                aria-label="Edit node title"
                title="Edit title"
                data-testid="edit-node-title-button"
                className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-brand-600 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Pencil size={16} />
              </button>
            )}
            {showCollapseButton && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Collapse node details panel"
                aria-controls="conversation-history"
                aria-expanded="true"
                data-testid="collapse-node-detail-panel-button"
                className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <PanelRightClose size={18} />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm leading-6 text-neutral-600">{node.summary}</p>
        <div className="flex flex-wrap gap-2">
          {node.children.length > 0 && (
            <button
              type="button"
              disabled={isCreating}
              onClick={() => onToggleNode(node.id)}
              aria-label={node.collapsed ? "Expand node" : "Fold node"}
              aria-expanded={!node.collapsed}
              aria-controls="mind-map"
              data-testid="toggle-node-button"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-danger-100 px-3 text-sm font-black text-danger-700 transition hover:bg-danger-200 disabled:cursor-not-allowed disabled:opacity-65"
            >
              <Ribbon size={16} />
              {node.collapsed ? "Expand" : "Fold"}
            </button>
          )}
          {node.parentId && (
            <button
              type="button"
              disabled={isCreating}
              onClick={() => onDeleteNode(node.id)}
              aria-label="Delete node"
              data-testid="delete-node-button"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-danger-50 px-3 text-sm font-black text-danger-600 transition hover:bg-danger-100 disabled:cursor-not-allowed disabled:opacity-65"
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          {showNotesAction && (
            <button
              type="button"
              onClick={onToggleNotes}
              aria-label={isNotesOpen ? "Close project notes" : "Open project notes"}
              aria-controls="project-notes-panel"
              aria-expanded={isNotesOpen}
              data-testid="node-detail-notes-button"
              className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                isNotesOpen
                  ? "bg-brand-100 text-brand-800 hover:bg-brand-200"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              <NotebookPen size={16} />
              Notes
            </button>
          )}
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
        {displayMessages.length === 0 ? (
          <NodeBriefCard node={node} />
        ) : (
          displayMessages.map(({ sourceNodeId, message, inherited }) => {
            const messageKey = `${sourceNodeId}:${message.id}`;
            const isStreamingAssistant =
              sourceNodeId === node.id && message.id === streamingMessageId;
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
                    ? "ml-6 text-success-800"
                    : "mr-6 text-neutral-700"
                }`}
              >
                <article
                  aria-label={`${message.role} message`}
                  aria-live={isStreamingAssistant ? "polite" : undefined}
                  className={`rounded-xl border p-3 ${
                    message.role === "user"
                      ? "border-success-100 bg-success-50"
                      : "border-brand-100 bg-brand-50"
                  }`}
                >
                  <p className="mb-1 text-[11px] font-black uppercase tracking-wider opacity-65">{message.role}</p>
                  {isEditingMessage ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        disabled={isCreating}
                        aria-label="Edit user message"
                        data-testid="message-edit-input"
                        rows={4}
                        className="w-full resize-none rounded-xl border border-neutral-200 bg-white p-3 text-sm leading-6 text-success-800 outline-none focus:border-success-400 focus:ring-2 focus:ring-success-200 disabled:cursor-not-allowed disabled:opacity-65"
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
                      onClick={() => void handleCopyMessage(message, messageKey)}
                      disabled={!message.content}
                    >
                      {isCopied ? <Check size={15} /> : <Copy size={15} />}
                    </MessageActionButton>
                    {!inherited && (
                      message.role === "user" ? (
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
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {showComposer && (
        <form
        aria-label="Message composer"
        aria-busy={isComposerBusy}
        aria-describedby={displayError ? errorId : isComposerBusy ? statusId : undefined}
        data-testid="message-composer"
        onSubmit={handleSubmit}
        className="shrink-0 space-y-3 border-t border-neutral-200 pt-4"
      >
        {!isInitialSubmit && selectedSourceText && (
          <div
            aria-label="Selected source text"
            data-testid="selected-source-text"
            className="space-y-2 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-neutral-700"
          >
            <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
              Selected text
            </p>
            <p className="line-clamp-3 leading-6">{getSelectionPreview(selectedSourceText)}</p>
            <button
              type="button"
              onClick={handleBranchFromSelection}
              disabled={isComposerBusy}
              aria-label="Branch from selection"
              data-testid="branch-from-selection-button"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-100 text-sm font-black text-brand-800 transition hover:bg-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
            >
              <GitBranch size={16} />
              Branch from selection
            </button>
          </div>
        )}

        {!isInitialSubmit && (
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
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-65 ${
                mode === "continue"
                  ? "bg-success-100 text-success-800"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
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
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-65 ${
                mode === "branch"
                  ? "bg-brand-100 text-brand-800"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              <GitBranch size={16} />
              Branch
            </button>
          </div>
        )}
        <PendingAttachmentChips
          attachments={composerControls.pendingAttachments}
          disabled={isComposerBusy}
          onRemove={composerControls.removePendingAttachment}
        />
        <div className="relative rounded-[20px] border border-neutral-200/80 bg-white shadow-sm transition focus-within:border-brand-300 focus-within:shadow-md focus-within:shadow-brand-100/20 focus-within:ring-4 focus-within:ring-brand-100/30">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isComposerBusy}
            aria-label="Message instruction"
            aria-describedby={displayError ? errorId : undefined}
            data-testid="message-instruction-input"
            placeholder={composerPlaceholder}
            rows={3}
            className="w-full resize-none bg-transparent px-4 pt-4 pb-16 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 transition disabled:cursor-not-allowed disabled:opacity-65"
          />
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <AttachmentMenuButton controls={composerControls} />
            <ModelSelectorButton controls={composerControls} />
          </div>
          <div className="absolute bottom-3 right-3">
            <button
              type="submit"
              disabled={isComposerBusy || !input.trim()}
              aria-label="Send message"
              data-testid="send-message-button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {composerControls.isPreparingAttachments ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {composerControls.isPreparingAttachments
                ? "Preparing..."
                : isCreating
                  ? isInitialSubmit
                    ? "Creating..."
                    : "Streaming..."
                  : submitLabel}
            </button>
          </div>
        </div>
        {isComposerBusy && (
          <p id={statusId} role="status" data-testid="message-send-status" className="sr-only">
            {composerControls.isPreparingAttachments
              ? "Preparing PDF attachments for this node."
              : isInitialSubmit
                ? "Creating your workspace."
                : "Streaming answer for this node."}
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
      </form>
      )}
    </aside>
  );
}
