"use client";

import {
  Fragment,
  type ReactNode,
  type RefObject,
} from "react";
import {
  BookOpen,
  Check,
  Copy,
  MessageSquare,
  Paperclip,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import {
  getAttachmentDetailLabel,
  isKnowledgeAttachment,
} from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import type { ConversationMessageItem } from "@/lib/graph";
import type {
  ChatAttachment,
  ChatMessage,
  MindNode,
} from "@/lib/types";
import { MarkdownMessage } from "../MarkdownMessage";
import { ThinkingElapsedTimer } from "../ThinkingElapsedTimer";
import type { SelectionAction } from "./node-detail-helpers";

type MessageActionButtonProps = {
  label: string;
  testId: string;
  title?: string;
  disabled?: boolean;
  highlightedHover?: boolean;
  onClick: () => void;
  children: ReactNode;
};

export function MessageActionButton({
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

export function MessageAttachmentList({
  attachments,
}: {
  attachments: ChatAttachment[];
}) {
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
              knowledgeCurriculum: copy.chat.knowledgeCurriculum,
              unknownType: copy.chat.unknownType,
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NodeBriefCard({ node }: { node: MindNode }) {
  const { copy } = useLanguage();
  const summary = node.summary.trim();

  return (
    <article
      aria-label={copy.workspace.nodeBrief}
      data-testid="node-brief-card"
      className="node-brief-card rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-neutral-700"
    >
      <p className="mb-1 text-[11px] font-black uppercase tracking-wider text-neutral-500">
        {copy.workspace.nodeBrief}
      </p>
      <h3 className="text-base font-black leading-snug text-neutral-900">
        {node.title}
      </h3>
      {summary && <p className="mt-2 text-neutral-600">{summary}</p>}
    </article>
  );
}

type SelectionActionFloatingButtonProps = {
  selectionAction: SelectionAction | null;
  visible: boolean;
  onSelectAction: () => void;
};

export function SelectionActionFloatingButton({
  selectionAction,
  visible,
  onSelectAction,
}: SelectionActionFloatingButtonProps) {
  const { copy } = useLanguage();

  if (!selectionAction || !visible) return null;

  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelectAction}
      aria-label={copy.workspace.askBranchMindSelection}
      data-testid="ask-branchmind-selection-button"
      style={{ left: selectionAction.x, top: selectionAction.y }}
      className="node-selection-action fixed z-50 inline-flex h-9 min-w-[154px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-neutral-200/90 bg-white/95 px-3.5 text-[13px] font-bold leading-none tracking-normal text-neutral-800 shadow-lg shadow-neutral-900/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
    >
      <MessageSquare size={14} className="shrink-0 text-brand-700" />
      {copy.workspace.askBranchMind}
    </button>
  );
}

type NodeConversationHistoryProps = {
  node: MindNode;
  messagesRef: RefObject<HTMLDivElement | null>;
  displayMessages: ConversationMessageItem[];
  inheritedMessageCount: number;
  shouldShowNodeBrief: boolean;
  isCreating: boolean;
  streamingMessageId?: string | null;
  editingMessageId: string | null;
  editingValue: string;
  copiedMessageKey: string | null;
  latestEditableUserMessageId: string | null;
  latestRetryableAssistantMessageId: string | null;
  onCaptureSelectionAction: () => void;
  onEditingValueChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<void> | void;
  onCopyMessage: (message: ChatMessage, messageKey: string) => Promise<void> | void;
  onStartEdit: (message: ChatMessage) => void;
  onRetryMessage: (message: ChatMessage) => void;
};

export function NodeConversationHistory({
  node,
  messagesRef,
  displayMessages,
  inheritedMessageCount,
  shouldShowNodeBrief,
  isCreating,
  streamingMessageId,
  editingMessageId,
  editingValue,
  copiedMessageKey,
  latestEditableUserMessageId,
  latestRetryableAssistantMessageId,
  onCaptureSelectionAction,
  onEditingValueChange,
  onCancelEdit,
  onSaveEdit,
  onCopyMessage,
  onStartEdit,
  onRetryMessage,
}: NodeConversationHistoryProps) {
  const { copy } = useLanguage();

  return (
    <section
      id="conversation-history"
      ref={messagesRef}
      aria-label={copy.workspace.conversationHistory}
      aria-busy={isCreating}
      data-testid="conversation-history"
      onKeyUp={onCaptureSelectionAction}
      onMouseUp={onCaptureSelectionAction}
      onTouchEnd={onCaptureSelectionAction}
      className="conversation-history-scrollable relative min-h-0 flex-1 space-y-3 overflow-auto overscroll-contain py-4 pr-1"
    >
      {displayMessages.length === 0 ? (
        <NodeBriefCard node={node} />
      ) : (
        <>
          {shouldShowNodeBrief && <NodeBriefCard node={node} />}
          {displayMessages.map(({ sourceNodeId, message, inherited }, messageIndex) => {
            const messageKey = `${sourceNodeId}:${message.id}`;
            const previousMessage =
              messageIndex > 0 ? displayMessages[messageIndex - 1] : null;
            const startsInheritedGroup = inherited && !previousMessage?.inherited;
            const startsCurrentGroup =
              !inherited && previousMessage?.inherited === true;
            const isStreamingAssistant =
              isCreating &&
              sourceNodeId === node.id &&
              message.id === streamingMessageId &&
              message.role === "assistant";
            const isEditingMessage =
              !inherited &&
              message.role === "user" &&
              message.id === editingMessageId;
            const isCopied = copiedMessageKey === messageKey;

            return (
              <Fragment key={messageKey}>
                {(startsInheritedGroup || startsCurrentGroup) && (
                  <p
                    className="conversation-group-label"
                    data-testid="conversation-group-label"
                    data-group={startsInheritedGroup ? "inherited" : "current"}
                  >
                    {startsInheritedGroup
                      ? copy.workspace.conversationInheritedGroup(inheritedMessageCount)
                      : copy.workspace.conversationCurrentGroup}
                  </p>
                )}
                <div
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
                        message.role === "user"
                          ? "text-brand-600"
                          : "text-text-muted"
                      }`}
                    >
                      {message.role === "user"
                        ? copy.workspace.userShort
                        : copy.workspace.assistant}
                    </p>
                    {isEditingMessage ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingValue}
                          onChange={(event) => onEditingValueChange(event.target.value)}
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
                            onClick={onCancelEdit}
                            disabled={isCreating}
                          >
                            <X size={15} />
                          </MessageActionButton>
                          <MessageActionButton
                            label={copy.workspace.saveMessageEdit}
                            testId="save-message-edit-button"
                            onClick={() => void onSaveEdit()}
                            disabled={isCreating || !editingValue.trim()}
                          >
                            <Save size={15} />
                          </MessageActionButton>
                        </div>
                      </div>
                    ) : (
                      <MarkdownMessage
                        content={message.content || ""}
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
                        message.role === "user"
                          ? "justify-end pr-2"
                          : "justify-start pl-2"
                      }`}
                    >
                      <MessageActionButton
                        label={copy.workspace.copyRoleMessage(message.role)}
                        title={
                          isCopied
                            ? copy.common.copied
                            : copy.workspace.copyRoleMessage(message.role)
                        }
                        testId="copy-message-button"
                        onClick={() => void onCopyMessage(message, messageKey)}
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
                              onClick={() => onStartEdit(message)}
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
                              onClick={() => onRetryMessage(message)}
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
              </Fragment>
            );
          })}
        </>
      )}
    </section>
  );
}
