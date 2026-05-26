"use client";

import { type FormEvent, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import {
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import type { ChatAttachment, ChatModelSelection } from "@/lib/types";

type HomeStartComposerProps = {
  isBusy: boolean;
  error: string | null;
  placeholder: string;
  submitLabel: string;
  suggestions: string[];
  suggestionsAnimationPhase: "idle" | "leaving" | "entering";
  testIdsEnabled?: boolean;
  autoPreparePdfAttachments?: boolean;
  onBeforeSubmit?: (resumeSubmit: () => void) => boolean | Promise<boolean>;
  onSubmit: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
  ) => Promise<string | null>;
};

export function HomeStartComposer({
  isBusy,
  error,
  placeholder,
  submitLabel,
  suggestions,
  suggestionsAnimationPhase,
  testIdsEnabled = true,
  autoPreparePdfAttachments = true,
  onBeforeSubmit,
  onSubmit,
}: HomeStartComposerProps) {
  const { copy } = useLanguage();
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isCheckingSubmit, setIsCheckingSubmit] = useState(false);
  const composerControls = useChatComposerControls({
    isBusy: isBusy || isCheckingSubmit,
    autoPreparePdfAttachments,
  });
  const displayError = composerControls.attachmentError ?? (submitted ? error : null);
  const isComposerBusy = composerControls.controlsBusy;
  const errorId = "mobile-home-start-composer-error";

  async function submitComposer() {
    const trimmed = input.trim();
    if (!trimmed || isComposerBusy) return;

    if (onBeforeSubmit) {
      setIsCheckingSubmit(true);
      try {
        const canSubmit = await onBeforeSubmit(() => {
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

    const projectId = await onSubmit(
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitComposer();
  }

  return (
    <form
      aria-label={copy.workspace.messageComposer}
      aria-busy={isComposerBusy}
      aria-describedby={displayError ? errorId : undefined}
      data-testid={testIdsEnabled ? "message-composer" : undefined}
      onSubmit={handleSubmit}
      className="branchmind-mobile-home-composer space-y-3 rounded-xl border border-neutral-200 bg-white/94 p-3 shadow-lg shadow-neutral-900/5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ModelSelectorButton controls={composerControls} placement="below" />
          <AttachmentMenuButton controls={composerControls} placement="below" />
        </div>
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
        aria-label={copy.workspace.messageInstruction}
        aria-describedby={displayError ? errorId : undefined}
        data-testid={testIdsEnabled ? "message-instruction-input" : undefined}
        placeholder={placeholder}
        rows={3}
        className="min-h-[78px] w-full resize-none rounded-lg border border-neutral-200 bg-surface-soft px-3 py-3 text-[15px] leading-6 text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-65"
      />

      {suggestions.length > 0 && (
        <div
          className={`home-prompt-suggestion-rotator home-prompt-suggestion-rotator-${suggestionsAnimationPhase} flex max-h-[82px] flex-wrap gap-2 overflow-hidden`}
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={isComposerBusy}
              onClick={() => setInput(suggestion)}
              data-testid={testIdsEnabled ? "home-prompt-suggestion" : undefined}
              className="home-prompt-suggestion-button inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm font-bold text-neutral-700 shadow-sm transition hover:border-brand-200 hover:bg-neutral-50 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Sparkles size={14} className="shrink-0 text-brand-500" />
              <span className="truncate">{suggestion}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={isComposerBusy || !input.trim()}
        aria-label={copy.workspace.send}
        data-testid={testIdsEnabled ? "send-message-button" : undefined}
        className="branchmind-primary-action inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {composerControls.isPreparingAttachments || isBusy || isCheckingSubmit ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Send size={16} />
        )}
        <span className="mobile-home-send-label">
          {composerControls.isPreparingAttachments
            ? copy.chat.preparing
            : isBusy || isCheckingSubmit
              ? copy.common.creating
              : submitLabel}
        </span>
      </button>

      {displayError && (
        <p
          id={errorId}
          role="alert"
          data-testid={testIdsEnabled ? "message-error-alert" : undefined}
          className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700"
        >
          {displayError}
        </p>
      )}
    </form>
  );
}
