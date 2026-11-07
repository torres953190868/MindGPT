"use client";

import type {
  FormEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import {
  GitBranch,
  Loader2,
  MessageSquare,
  Send,
  Sprout,
  X,
} from "lucide-react";
import {
  ActiveSkillChip,
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  type useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  getHighlightedActionClass,
  type useHighlightedAction,
} from "@/components/ui/highlighted-action";
import type { ModeActionItem } from "./node-detail-helpers";

type NodeDetailComposerProps = {
  input: string;
  mode: "continue" | "branch";
  isInitialSubmit: boolean;
  isBlankNode: boolean;
  hasSelectedTextContext: boolean;
  isComposerBusy: boolean;
  isCheckingInitialSubmit: boolean;
  displayError: string | null;
  errorId: string;
  statusId: string;
  composerPlaceholder: string;
  composerControls: ReturnType<typeof useChatComposerControls>;
  modeHighlight: ReturnType<typeof useHighlightedAction<ModeActionItem>>;
  onInputChange: (value: string) => void;
  onModeChange: (mode: "continue" | "branch") => void;
  onClearSelectedSourceText: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export function NodeDetailComposer({
  input,
  mode,
  isInitialSubmit,
  isBlankNode,
  hasSelectedTextContext,
  isComposerBusy,
  isCheckingInitialSubmit,
  displayError,
  errorId,
  statusId,
  composerPlaceholder,
  composerControls,
  modeHighlight,
  onInputChange,
  onModeChange,
  onClearSelectedSourceText,
  onSubmit,
  onResizePointerDown,
  onResizeMouseDown,
}: NodeDetailComposerProps) {
  const { copy } = useLanguage();
  const isContinueModeHighlighted = modeHighlight.isHighlighted("continue");
  const isBranchModeHighlighted = modeHighlight.isHighlighted("branch");

  return (
    <section className="node-detail-composer relative flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-neutral-200 bg-inherit pt-3">
      <div
        role="separator"
        aria-label={copy.workspace.resizeConversationComposer}
        aria-orientation="horizontal"
        data-testid="resize-conversation-composer-handle"
        onPointerDown={onResizePointerDown}
        onMouseDown={onResizeMouseDown}
        className="absolute -top-2 left-0 z-10 h-4 w-full cursor-row-resize transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
      />
      <form
        aria-label={copy.workspace.messageComposer}
        aria-busy={isComposerBusy}
        aria-describedby={
          displayError ? errorId : isComposerBusy ? statusId : undefined
        }
        data-testid="message-composer"
        onSubmit={onSubmit}
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
                onClick={() => onModeChange("continue")}
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
                onClick={() => onModeChange("branch")}
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
                  <span className="min-w-0 truncate">
                    {copy.workspace.selectedTextCount}
                  </span>
                  <button
                    type="button"
                    onClick={onClearSelectedSourceText}
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
              onChange={(event) => onInputChange(event.target.value)}
              disabled={isComposerBusy}
              aria-label={copy.workspace.messageInstruction}
              aria-describedby={displayError ? errorId : undefined}
              data-testid="message-instruction-input"
              placeholder={composerPlaceholder}
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
            <p
              id={statusId}
              role="status"
              data-testid="message-send-status"
              className="sr-only"
            >
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
  );
}
