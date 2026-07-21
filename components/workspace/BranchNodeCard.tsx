"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useState,
} from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Loader2, Send, Sparkles, Ribbon } from "lucide-react";
import {
  ActiveSkillChip,
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import { ThinkingElapsedTimer } from "./ThinkingElapsedTimer";
import {
  getHighlightedActionClass,
  useHighlightedAction,
} from "@/components/ui/highlighted-action";
import type { ChatAttachment, ChatModelSelection, ChatSkill, MindNode } from "@/lib/types";

export type InlineNodeComposerData = {
  nodeId: string;
  isBusy: boolean;
  error: string | null;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  isAwaitingPersistence?: boolean;
  variant?: "default" | "home";
  suggestions?: string[];
  suggestionsAnimationPhase?: "idle" | "leaving" | "entering";
  autoPreparePdfAttachments?: boolean;
  onBeforeSubmit?: (resumeSubmit: () => void) => boolean | Promise<boolean>;
  onSubmit: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
};

export type MobileLongPressStart = {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  isPrimary: boolean;
};

export type BranchNodeData = {
  mindNode: MindNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  onCreate: (nodeId: string, mode: "continue" | "branch") => void;
  onToggle: (nodeId: string) => void;
  isStreaming: boolean;
  creationDisabled: boolean;
  mobileLongPressDragEnabled: boolean;
  mobileLongPressDragging: boolean;
  onMobileLongPressStart: (nodeId: string, event: MobileLongPressStart) => void;
  consumeMobileNodeClickSuppression: (nodeId: string) => boolean;
  inlineComposer?: InlineNodeComposerData;
};

type QuickActionItem = "branch" | "fold";

function isBlockedMobileLongPressTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;

  return Boolean(
    target.closest(
      [
        "textarea",
        "input",
        "select",
        "a",
        "[contenteditable='true']",
        "[data-mobile-node-drag-blocker='true']",
        ".branchmind-handle-branch",
        ".branchmind-handle-continue",
        ".home-inline-composer",
        ".branch-node-quick-action",
        "button:not([data-testid='open-node-button'])",
      ].join(","),
    ),
  );
}

export function BranchNodeCard({ data }: NodeProps) {
  const { copy } = useLanguage();
  const nodeData = data as BranchNodeData;
  const {
    mindNode,
    selected,
    onSelect,
    onCreate,
    onToggle,
    isStreaming,
    creationDisabled,
    mobileLongPressDragEnabled,
    mobileLongPressDragging,
    onMobileLongPressStart,
    consumeMobileNodeClickSuppression,
    inlineComposer,
  } = nodeData;
  const nodeTitleId = `branch-node-${mindNode.id}-title`;
  const nodeSummaryId = `branch-node-${mindNode.id}-summary`;
  const hasChildren = mindNode.children.length > 0;
  const hasInlineComposer = Boolean(inlineComposer);
  const isHomeInlineComposer = inlineComposer?.variant === "home";
  const quickActionHighlight = useHighlightedAction<QuickActionItem>();
  const isBranchQuickActionHighlighted = quickActionHighlight.isHighlighted("branch");
  const isFoldQuickActionHighlighted = quickActionHighlight.isHighlighted("fold");
  const canLongPressDragNode =
    mobileLongPressDragEnabled && !hasInlineComposer && !isHomeInlineComposer;

  function handleMobileLongPressPointerDownCapture(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (!canLongPressDragNode) return;
    if (isBlockedMobileLongPressTarget(event.target)) return;

    onMobileLongPressStart(mindNode.id, {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      isPrimary: event.isPrimary,
    });
  }

  function handleMobileLongPressMouseDownCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!canLongPressDragNode) return;
    if (isBlockedMobileLongPressTarget(event.target)) return;

    onMobileLongPressStart(mindNode.id, {
      pointerId: -1,
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      isPrimary: true,
    });
  }

  function handleMobileLongPressTouchStartCapture(event: ReactTouchEvent<HTMLElement>) {
    if (!canLongPressDragNode) return;
    if (isBlockedMobileLongPressTarget(event.target)) return;

    const touch = event.changedTouches.item(0);
    if (!touch) return;

    onMobileLongPressStart(mindNode.id, {
      pointerId: touch.identifier,
      clientX: touch.clientX,
      clientY: touch.clientY,
      button: 0,
      isPrimary: true,
    });
  }

  function handleSuppressedMobileClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!consumeMobileNodeClickSuppression(mindNode.id)) return;

    event.preventDefault();
    event.stopPropagation();
  }

  function handleSelectNodeClick(event: ReactMouseEvent<HTMLElement>) {
    event.stopPropagation();
    if (consumeMobileNodeClickSuppression(mindNode.id)) {
      event.preventDefault();
      return;
    }

    onSelect(mindNode.id);
  }

  return (
    <article
      aria-labelledby={nodeTitleId}
      aria-describedby={nodeSummaryId}
      data-testid="branch-node-card"
      data-node-id={mindNode.id}
      data-selected={selected ? "true" : "false"}
      data-inline-composer={hasInlineComposer ? "true" : undefined}
      data-home-composer={isHomeInlineComposer ? "true" : undefined}
      data-mobile-long-press-dragging={mobileLongPressDragging ? "true" : undefined}
      onPointerDownCapture={handleMobileLongPressPointerDownCapture}
      onMouseDownCapture={handleMobileLongPressMouseDownCapture}
      onTouchStartCapture={handleMobileLongPressTouchStartCapture}
      onClickCapture={handleSuppressedMobileClickCapture}
      className={`branch-node-card-surface branch-node-edge-hit-area group text-left transition ${
        canLongPressDragNode ? "branch-node-mobile-long-press-root " : ""
      }${
        isHomeInlineComposer
          ? `w-[min(312px,calc(100vw-72px))] rounded-xl border border-neutral-200/90 bg-white/92 p-2.5 shadow-lg backdrop-blur sm:w-[360px] sm:rounded-[18px] sm:p-5 md:w-[400px] lg:w-[min(760px,calc(100vw-48px))] lg:p-6 ${
              selected
                ? "ring-2 ring-brand-200/70"
                : "hover:shadow-xl"
            }`
          : hasInlineComposer
            ? `w-[400px] max-w-[calc(100vw-48px)] rounded-[30px] border-2 bg-white p-5 shadow-xl ${
                selected
                  ? "border-brand-300 ring-2 ring-brand-200"
                  : "border-white/90 hover:shadow-2xl"
            }`
          : `w-[292px] rounded-2xl border bg-white p-4 shadow-md ${
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
        onClick={handleSelectNodeClick}
        data-testid="branch-node-inner-hit-area"
        data-node-id={mindNode.id}
        className={`branch-node-inner-hit-area rounded-[18px] ${
          canLongPressDragNode ? "branch-node-mobile-long-press-area" : "nodrag"
        } ${
          isHomeInlineComposer ? "" : "nopan"
        }`}
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
            onClick={handleSelectNodeClick}
            aria-label={copy.workspace.openNode(mindNode.title)}
            aria-pressed={selected}
            data-testid="open-node-button"
            data-node-id={mindNode.id}
            className={`block w-full text-left outline-none transition focus-visible:ring-4 focus-visible:ring-brand-100 ${
              canLongPressDragNode ? "branch-node-mobile-long-press-area " : ""
            }${
              hasInlineComposer ? "rounded-[22px]" : "rounded-[18px]"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                  {mindNode.branchType === "root"
                    ? copy.workspace.root
                    : mindNode.branchType === "branch"
                      ? copy.workspace.branch
                      : copy.workspace.continue}
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
                aria-label={copy.workspace.childCount(mindNode.children.length)}
                className="branch-node-child-count grid h-8 min-w-8 place-items-center rounded-full bg-brand-100 px-2 text-sm font-black text-brand-700"
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
        <div
          onMouseLeave={quickActionHighlight.clearHighlightedAction}
          className="mt-4 hidden items-center gap-2 sm:flex"
        >
          <button
            type="button"
            disabled={creationDisabled}
            data-testid="branch-right-button"
            data-node-id={mindNode.id}
            data-highlighted={quickActionHighlight.getDataHighlighted("branch")}
            {...quickActionHighlight.getHoverHandlers("branch")}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
              onCreate(mindNode.id, "branch");
            }}
            aria-label={copy.workspace.newBranchRight}
            title={copy.workspace.newBranchRight}
            className={`branch-node-quick-action branch-node-quick-action-branch nodrag nopan grid h-9 w-9 place-items-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 ${getHighlightedActionClass(
              isBranchQuickActionHighlighted,
              "bg-brand-100 text-brand-700",
            )}`}
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
                  ? copy.workspace.expandChildrenFor(mindNode.title)
                  : copy.workspace.collapseChildrenFor(mindNode.title)
                : copy.workspace.toggleChildren(mindNode.title)
            }
            aria-expanded={hasChildren ? !mindNode.collapsed : undefined}
            title={copy.workspace.toggleChildrenTitle}
            data-testid="toggle-children-button"
            data-node-id={mindNode.id}
            data-highlighted={quickActionHighlight.getDataHighlighted("fold")}
            {...quickActionHighlight.getHoverHandlers("fold")}
            className={`branch-node-quick-action branch-node-quick-action-toggle nodrag nopan grid h-9 w-9 place-items-center rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 ${getHighlightedActionClass(
              isFoldQuickActionHighlighted,
              "bg-danger-100 text-danger-600",
            )}`}
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
  const { copy } = useLanguage();
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isCheckingSubmit, setIsCheckingSubmit] = useState(false);
  const composerControls = useChatComposerControls({
    isBusy: composer.isBusy || isCheckingSubmit,
    autoPreparePdfAttachments: composer.autoPreparePdfAttachments ?? true,
  });
  const displayError = composerControls.attachmentError ?? (submitted ? composer.error : null);
  const isComposerBusy = composerControls.controlsBusy;
  const isSubmitPending = composer.isAwaitingPersistence ?? false;
  const errorId = `inline-node-composer-${composer.nodeId}-error`;
  const isHomeComposer = composer.variant === "home";
  const suggestionsAnimationPhase = composer.suggestionsAnimationPhase ?? "idle";
  const homeSuggestions = composer.suggestions ?? [];

  async function submitComposer() {
    const trimmed = input.trim();
    if (!trimmed || isComposerBusy || isSubmitPending) return;

    if (composer.onBeforeSubmit) {
      setIsCheckingSubmit(true);
      try {
        const canSubmit = await composer.onBeforeSubmit(() => {
          void submitComposer();
        });
        if (!canSubmit) return;
      } finally {
        setIsCheckingSubmit(false);
      }
    }

    setSubmitted(true);
    const preparedAttachments = await composerControls.prepareAttachmentsForSend();
    if (!preparedAttachments) return;

    const skill = composerControls.prepareSkillForSend();
    const projectId = await composer.onSubmit(
      trimmed,
      preparedAttachments,
      composerControls.selectedModel,
      skill,
    );

    if (projectId) {
      setInput("");
      setSubmitted(false);
      composerControls.resetAttachments();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    void submitComposer();
  }

  function handleInstructionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitComposer();
  }

  if (isHomeComposer) {
    return (
      <form
        aria-label={copy.workspace.messageComposer}
        aria-busy={isComposerBusy || isSubmitPending}
        aria-describedby={displayError ? errorId : undefined}
        data-testid="message-composer"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="home-inline-composer nodrag space-y-2 sm:space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ModelSelectorButton controls={composerControls} placement="below" />
            <AttachmentMenuButton controls={composerControls} placement="below" />
          </div>
        </div>
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
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInstructionKeyDown}
          autoFocus={composer.autoFocus}
          disabled={isComposerBusy}
          aria-label={copy.workspace.messageInstruction}
          aria-describedby={displayError ? errorId : undefined}
          data-testid="message-instruction-input"
          placeholder={composer.placeholder}
          enterKeyHint="send"
          rows={2}
          className="min-h-[58px] w-full resize-none bg-transparent px-1 py-1 text-base leading-7 text-neutral-900 outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-65 sm:min-h-[86px]"
        />
        <div className="flex items-center justify-between gap-3">
          {homeSuggestions.length > 0 && (
            <div
              className={`home-prompt-suggestion-rotator home-prompt-suggestion-rotator-${suggestionsAnimationPhase} flex max-h-[82px] min-w-0 flex-1 flex-wrap gap-2 overflow-hidden`}
            >
              {homeSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isComposerBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    setInput(suggestion);
                  }}
                  data-testid="home-prompt-suggestion"
                  className={`home-prompt-suggestion-button min-h-9 max-w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-700 shadow-sm transition hover:border-brand-200 hover:bg-neutral-50 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-55 ${
                    index === 0 ? "inline-flex" : "hidden lg:inline-flex"
                  }`}
                >
                  <Sparkles size={15} className="shrink-0 text-brand-500" />
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={isComposerBusy || isSubmitPending || !input.trim()}
            aria-label={copy.workspace.send}
            data-testid="send-message-button"
            className="branchmind-primary-action home-inline-send-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 p-0 text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {composerControls.isPreparingAttachments || composer.isBusy || isCheckingSubmit || isSubmitPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
        {(isComposerBusy || isSubmitPending) && (
          <p
            role="status"
            data-testid="home-thinking-status"
            className="flex items-center gap-2 px-1 text-xs font-bold text-neutral-500"
          >
            <Loader2 size={13} className="animate-spin" />
            {copy.workspace.generatingAnswer}
            {" · "}
            <ThinkingElapsedTimer />
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
    );
  }

  return (
    <form
      aria-label={copy.workspace.messageComposer}
      aria-busy={isComposerBusy || isSubmitPending}
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
      {composerControls.activeSkill && (
        <ActiveSkillChip
          skill={composerControls.activeSkill}
          disabled={isComposerBusy}
          onRemove={composerControls.removeActiveSkill}
        />
      )}
      <div className="relative rounded-[22px] border border-neutral-200/80 bg-surface-soft shadow-sm transition focus-within:border-brand-300 focus-within:bg-white focus-within:shadow-md focus-within:shadow-brand-100/25 focus-within:ring-4 focus-within:ring-brand-100/35">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInstructionKeyDown}
          autoFocus={composer.autoFocus}
          disabled={isComposerBusy}
          aria-label={copy.workspace.messageInstruction}
          aria-describedby={displayError ? errorId : undefined}
          data-testid="message-instruction-input"
          placeholder={composer.placeholder}
          rows={3}
          className="w-full resize-none bg-transparent px-4 pt-4 pb-16 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-65"
        />
        <div className="absolute bottom-3 right-14 flex max-w-[calc(100%-4.75rem)] items-center justify-end gap-2">
          <AttachmentMenuButton controls={composerControls} placement="below" />
          <ModelSelectorButton controls={composerControls} placement="below" />
        </div>
        <div className="absolute bottom-3 right-3">
          <button
            type="submit"
            disabled={isComposerBusy || isSubmitPending || !input.trim()}
            aria-label={copy.workspace.send}
            data-testid="send-message-button"
            className="branchmind-primary-action inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 p-0 text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {composerControls.isPreparingAttachments || composer.isBusy || isCheckingSubmit || isSubmitPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
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
