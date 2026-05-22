"use client";

import { type FormEvent, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Loader2, Send, Sparkles, Ribbon } from "lucide-react";
import {
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import type { ChatAttachment, ChatModelSelection, MindNode } from "@/lib/types";

export type InlineNodeComposerData = {
  nodeId: string;
  isBusy: boolean;
  error: string | null;
  placeholder: string;
  submitLabel: string;
  variant?: "default" | "home";
  suggestions?: string[];
  onSubmit: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
  ) => Promise<string | null>;
};

export type BranchNodeData = {
  mindNode: MindNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  onCreate: (nodeId: string, mode: "continue" | "branch") => void;
  onToggle: (nodeId: string) => void;
  isStreaming: boolean;
  creationDisabled: boolean;
  inlineComposer?: InlineNodeComposerData;
};

export function BranchNodeCard({ data }: NodeProps) {
  const nodeData = data as BranchNodeData;
  const {
    mindNode,
    selected,
    onSelect,
    onCreate,
    onToggle,
    isStreaming,
    creationDisabled,
    inlineComposer,
  } = nodeData;
  const nodeTitleId = `branch-node-${mindNode.id}-title`;
  const nodeSummaryId = `branch-node-${mindNode.id}-summary`;
  const hasChildren = mindNode.children.length > 0;
  const hasInlineComposer = Boolean(inlineComposer);
  const isHomeInlineComposer = inlineComposer?.variant === "home";

  return (
    <article
      aria-labelledby={nodeTitleId}
      aria-describedby={nodeSummaryId}
      data-testid="branch-node-card"
      data-node-id={mindNode.id}
      data-selected={selected ? "true" : "false"}
      data-inline-composer={hasInlineComposer ? "true" : undefined}
      data-home-composer={isHomeInlineComposer ? "true" : undefined}
      className={`branch-node-edge-hit-area group bg-white text-left transition ${
        isHomeInlineComposer
          ? `w-[min(760px,calc(100vw-48px))] rounded-[18px] border border-neutral-200/90 p-4 shadow-lg sm:p-6 ${
              selected
                ? "ring-2 ring-brand-200/70"
                : "hover:shadow-xl"
            }`
          : hasInlineComposer
            ? `w-[400px] max-w-[calc(100vw-48px)] rounded-[30px] border-2 p-5 shadow-xl ${
                selected
                  ? "border-brand-300 ring-2 ring-brand-200"
                  : "border-white/90 hover:shadow-2xl"
            }`
          : `w-[292px] rounded-2xl border p-4 shadow-md ${
              selected
                ? "border-brand-400 shadow-lg ring-2 ring-brand-300"
                : "border-white/90 hover:-translate-y-1 hover:shadow-lg"
            }`
      }`}
    >
      {!isHomeInlineComposer && (
        <>
          <Handle
            id="branch-target"
            type="target"
            position={Position.Left}
            className="branchmind-handle-branch nodrag"
          />
          <Handle
            id="continue-target"
            type="target"
            position={Position.Top}
            className="branchmind-handle-continue nodrag"
          />
          <Handle
            id="branch-source"
            type="source"
            position={Position.Right}
            className="branchmind-handle-branch nodrag"
          />
          <Handle
            id="continue-source"
            type="source"
            position={Position.Bottom}
            className="branchmind-handle-continue nodrag"
          />
        </>
      )}

      <div
        role="presentation"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(mindNode.id);
        }}
        data-testid="branch-node-inner-hit-area"
        data-node-id={mindNode.id}
        className="branch-node-inner-hit-area nodrag nopan rounded-[18px]"
      >
        {isHomeInlineComposer ? (
          <>
            <span id={nodeTitleId} className="sr-only">
              {mindNode.title}
            </span>
            <span id={nodeSummaryId} className="sr-only">
              {mindNode.summary}
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
            }}
            aria-label={`Open node ${mindNode.title}`}
            aria-pressed={selected}
            data-testid="open-node-button"
            data-node-id={mindNode.id}
            className={`block w-full text-left outline-none transition focus-visible:ring-4 focus-visible:ring-brand-100 ${
              hasInlineComposer ? "rounded-[22px]" : "rounded-[18px]"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                  {mindNode.branchType === "root"
                    ? "Root"
                    : mindNode.branchType === "branch"
                      ? "Branch"
                      : "Continue"}
                </span>
                <span
                  id={nodeTitleId}
                  className={`mt-1 line-clamp-2 block font-black text-neutral-900 ${
                    hasInlineComposer ? "text-lg" : "text-base"
                  }`}
                >
                  {mindNode.title}
                </span>
              </span>
              <span
                aria-label={`${mindNode.children.length} child nodes`}
                className="grid h-8 min-w-8 place-items-center rounded-full bg-brand-100 px-2 text-sm font-black text-brand-700"
              >
                {mindNode.children.length}
              </span>
            </span>

            {hasInlineComposer ? (
              <span id={nodeSummaryId} className="sr-only">
                {mindNode.summary}
              </span>
            ) : (
              <span
                id={nodeSummaryId}
                className="mt-3 line-clamp-3 block text-sm leading-6 text-neutral-600"
              >
                {mindNode.summary}
              </span>
            )}
          </button>
        )}

        {inlineComposer && <InlineNodeComposer composer={inlineComposer} />}

        {!hasInlineComposer && (
        <div className="mt-4 hidden items-center gap-2 sm:flex">
          <button
            type="button"
            disabled={creationDisabled}
            data-testid="branch-right-button"
            data-node-id={mindNode.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
              onCreate(mindNode.id, "branch");
            }}
            aria-label="Branch right"
            title="Branch right"
            className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-brand-700 transition hover:scale-110 hover:bg-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch size={17} />
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
              onToggle(mindNode.id);
            }}
            aria-label={
              hasChildren
                ? mindNode.collapsed
                  ? `Expand children for ${mindNode.title}`
                  : `Collapse children for ${mindNode.title}`
                : `Toggle children for ${mindNode.title}`
            }
            aria-expanded={hasChildren ? !mindNode.collapsed : undefined}
            title="Toggle children"
            data-testid="toggle-children-button"
            data-node-id={mindNode.id}
            className="grid h-9 w-9 place-items-center rounded-full bg-danger-100 text-danger-600 transition hover:scale-110 hover:bg-danger-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Ribbon size={17} />
          </button>
        </div>
        )}
      </div>
    </article>
  );
}

function InlineNodeComposer({ composer }: { composer: InlineNodeComposerData }) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const composerControls = useChatComposerControls({ isBusy: composer.isBusy });
  const displayError = composerControls.attachmentError ?? (submitted ? composer.error : null);
  const isComposerBusy = composerControls.controlsBusy;
  const errorId = `inline-node-composer-${composer.nodeId}-error`;
  const isHomeComposer = composer.variant === "home";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();

    const trimmed = input.trim();
    if (!trimmed || isComposerBusy) return;

    setSubmitted(true);
    const preparedAttachments = await composerControls.prepareAttachmentsForSend();
    if (!preparedAttachments) return;

    const projectId = await composer.onSubmit(
      trimmed,
      preparedAttachments,
      composerControls.selectedModel,
    );

    if (projectId) {
      setInput("");
      setSubmitted(false);
      composerControls.resetAttachments();
    }
  }

  if (isHomeComposer) {
    return (
      <form
        aria-label="Message composer"
        aria-busy={isComposerBusy}
        aria-describedby={displayError ? errorId : undefined}
        data-testid="message-composer"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="nodrag nopan space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModelSelectorButton controls={composerControls} placement="below" />
            <AttachmentMenuButton controls={composerControls} placement="below" />
          </div>
          <span className="hidden text-sm font-bold text-neutral-400 sm:inline">?</span>
        </div>
        <PendingAttachmentChips
          attachments={composerControls.pendingAttachments}
          disabled={isComposerBusy}
          onRemove={composerControls.removePendingAttachment}
        />
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isComposerBusy}
          aria-label="Message instruction"
          aria-describedby={displayError ? errorId : undefined}
          data-testid="message-instruction-input"
          placeholder={composer.placeholder}
          rows={2}
          className="min-h-[86px] w-full resize-none bg-transparent px-1 py-1 text-base leading-7 text-neutral-900 outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-65"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {composer.suggestions && composer.suggestions.length > 0 && (
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              {composer.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isComposerBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    setInput(suggestion);
                  }}
                  data-testid="home-prompt-suggestion"
                  className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-700 shadow-sm transition hover:border-brand-200 hover:bg-neutral-50 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Sparkles size={15} className="shrink-0 text-brand-500" />
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={isComposerBusy || !input.trim()}
            aria-label="Send message"
            data-testid="send-message-button"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {composerControls.isPreparingAttachments || composer.isBusy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            {composerControls.isPreparingAttachments
              ? "Preparing..."
              : composer.isBusy
                ? "Creating..."
                : composer.submitLabel}
          </button>
        </div>
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
    );
  }

  return (
    <form
      aria-label="Message composer"
      aria-busy={isComposerBusy}
      aria-describedby={displayError ? errorId : undefined}
      data-testid="message-composer"
      onSubmit={handleSubmit}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className="nodrag nopan mt-5 space-y-3"
    >
      <PendingAttachmentChips
        attachments={composerControls.pendingAttachments}
        disabled={isComposerBusy}
        onRemove={composerControls.removePendingAttachment}
      />
      <div className="relative rounded-[22px] border border-neutral-200/80 bg-surface-soft shadow-sm transition focus-within:border-brand-300 focus-within:bg-white focus-within:shadow-md focus-within:shadow-brand-100/25 focus-within:ring-4 focus-within:ring-brand-100/35">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isComposerBusy}
          aria-label="Message instruction"
          aria-describedby={displayError ? errorId : undefined}
          data-testid="message-instruction-input"
          placeholder={composer.placeholder}
          rows={3}
          className="w-full resize-none bg-transparent px-4 pt-4 pb-16 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-65"
        />
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <AttachmentMenuButton controls={composerControls} placement="below" />
          <ModelSelectorButton controls={composerControls} placement="below" />
        </div>
        <div className="absolute bottom-3 right-3">
          <button
            type="submit"
            disabled={isComposerBusy || !input.trim()}
            aria-label="Send message"
            data-testid="send-message-button"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {composerControls.isPreparingAttachments || composer.isBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            {composerControls.isPreparingAttachments
              ? "Preparing..."
              : composer.isBusy
                ? "Creating..."
                : composer.submitLabel}
          </button>
        </div>
      </div>
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
  );
}
