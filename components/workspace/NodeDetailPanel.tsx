"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
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
import type { ChatMessage, MindNode } from "@/lib/types";
import { MarkdownMessage } from "./MarkdownMessage";

type NodeDetailPanelProps = {
  node: MindNode | null;
  onCreateNode: (
    nodeId: string,
    mode: "continue" | "branch",
    instruction: string,
    sourceText?: string,
  ) => Promise<string | null>;
  onEditUserMessage: (
    nodeId: string,
    userMessageId: string,
    instruction: string,
  ) => Promise<boolean>;
  onRetryAssistantMessage: (nodeId: string, assistantMessageId: string) => Promise<boolean>;
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
      className="grid h-8 w-8 place-items-center rounded-full text-current opacity-75 transition hover:bg-white/70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/25 disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
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
  const [mode, setMode] = useState<"continue" | "branch">("continue");
  const [selectedSourceText, setSelectedSourceText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const lastMessage = node?.messages[node.messages.length - 1] ?? null;
  const streamingMessageId =
    isCreating && lastMessage?.role === "assistant" ? lastMessage.id : null;
  const streamingContent = streamingMessageId ? lastMessage?.content ?? "" : "";

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!node || !input.trim() || isCreating) return;
    const sourceText = mode === "branch" && selectedSourceText ? selectedSourceText : undefined;
    const createdNodeId = await onCreateNode(node.id, mode, input.trim(), sourceText);
    if (createdNodeId) {
      setInput("");
      clearSelectedSourceText();
    }
  }

  async function handleBranchFromSelection() {
    if (!node || !selectedSourceText || isCreating) return;
    const instruction = input.trim() || DEFAULT_SELECTION_BRANCH_INSTRUCTION;
    const createdNodeId = await onCreateNode(node.id, "branch", instruction, selectedSourceText);
    if (createdNodeId) {
      setInput("");
      clearSelectedSourceText();
    }
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

    const started = await onEditUserMessage(node.id, editingMessageId, trimmed);
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
    void onRetryAssistantMessage(node.id, message.id);
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
        aria-busy={isCreating}
        aria-describedby={error ? errorId : isCreating ? statusId : undefined}
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
              disabled={isCreating}
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
            disabled={isCreating}
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
            disabled={isCreating}
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
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isCreating}
          aria-label="Message instruction"
          aria-describedby={error ? errorId : undefined}
          data-testid="message-instruction-input"
          placeholder="Ask the next question..."
          rows={3}
          className="w-full resize-none rounded-[20px] border border-white bg-white/82 p-3 text-sm text-[#332b38] outline-none placeholder:text-[#665a70] focus:border-[#b696d4] focus:ring-4 focus:ring-[#eadcf7] disabled:cursor-not-allowed disabled:opacity-65"
        />
        <button
          type="submit"
          disabled={isCreating || !input.trim()}
          aria-label="Send message"
          data-testid="send-message-button"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[#7c5fb1] font-black text-white transition hover:bg-[#6f52a5] disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Send size={17} />
          {isCreating ? "Streaming..." : "Send"}
        </button>
        {isCreating && (
          <p id={statusId} role="status" data-testid="message-send-status" className="sr-only">
            Streaming answer for this node.
          </p>
        )}
        {error && (
          <p
            id={errorId}
            role="alert"
            data-testid="message-error-alert"
            className="rounded-[18px] bg-[#ffeceb] px-3 py-2 text-sm font-bold text-[#8f3f3a]"
          >
            {error}
          </p>
        )}
      </form>
    </aside>
  );
}
