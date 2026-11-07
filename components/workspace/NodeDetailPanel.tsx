"use client";

import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useChatComposerControls } from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useHighlightedAction } from "@/components/ui/highlighted-action";
import type { ChatMessage } from "@/lib/types";
import {
  NodeConversationHistory,
  SelectionActionFloatingButton,
} from "./node-detail/NodeConversationHistory";
import { NodeDetailComposer } from "./node-detail/NodeDetailComposer";
import {
  DeleteNodeConfirmDialog,
  NodeDetailEmptyState,
  NodeDetailHeaderSection,
} from "./node-detail/NodeDetailHeader";
import {
  type HeaderActionItem,
  type ModeActionItem,
  type NodeDetailPanelProps,
  resolveDisplayMessages,
  resolveLatestMessageActionIds,
} from "./node-detail/node-detail-helpers";
import {
  useConversationScrollAndSelection,
  useNodeDetailResize,
} from "./node-detail/useNodeDetailResize";

export type { NodeDetailPanelProps };

export function NodeDetailPanel({
  node,
  conversationMessages,
  conversationFocusRequest = 0,
  onCreateNode,
  onPopulateNode,
  onEditUserMessage,
  onRetryAssistantMessage,
  onUpdateNodeTitle,
  onToggleNode,
  onDeleteNode,
  deleteDescendantCount = 0,
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
  const deleteDialogTitleId = `${panelId}-delete-dialog-title`;
  const deleteDialogDescriptionId = `${panelId}-delete-dialog-description`;
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"continue" | "branch">("continue");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isCheckingInitialSubmit, setIsCheckingInitialSubmit] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState("");
  const panelRef = useRef<HTMLElement>(null);

  const headerHighlight = useHighlightedAction<HeaderActionItem>();
  const modeHighlight = useHighlightedAction<ModeActionItem>({ defaultAction: mode });
  const clearHeaderHighlightedAction = headerHighlight.clearHighlightedAction;
  const clearModeHighlightedAction = modeHighlight.clearHighlightedAction;

  const composerControls = useChatComposerControls({
    isBusy: isCreating || isCheckingInitialSubmit,
    autoPreparePdfAttachments,
  });
  const resolvedComposerPlaceholder =
    composerPlaceholder ?? copy.workspace.askNextQuestion;
  const resetComposerAttachments = composerControls.resetAttachments;

  const {
    panelStyle,
    handleHeaderResizePointerDown,
    handleHeaderResizeMouseDown,
    handleComposerResizePointerDown,
    handleComposerResizeMouseDown,
  } = useNodeDetailResize(panelRef);

  const streamingContent =
    node?.messages.find((message) => message.id === streamingMessageId)?.content ?? "";
  const selectedNodeId = node?.id;

  const {
    messagesRef,
    selectedSourceText,
    setSelectedSourceText,
    selectionAction,
    copiedMessageKey,
    clearSelectedSourceText,
    dismissBrowserSelection,
    captureSelectionAction,
    handleCopyMessage,
  } = useConversationScrollAndSelection({
    selectedNodeId,
    isCreating,
    streamingContent,
    conversationFocusRequest,
  });

  const displayMessages = resolveDisplayMessages(node, conversationMessages);
  const inheritedMessageCount = displayMessages.filter((item) => item.inherited).length;
  const shouldShowNodeBrief = Boolean(node && node.messages.length === 0);
  const {
    latestEditableUserMessageId,
    latestRetryableAssistantMessageId,
  } = resolveLatestMessageActionIds(node);

  const isComposerBusy = composerControls.controlsBusy;
  const displayError = composerControls.attachmentError ?? error;
  const isInitialSubmit = initialSubmit;
  const isBlankNode = !isInitialSubmit && Boolean(node && node.messages.length === 0);
  const hasSelectedTextContext =
    !isInitialSubmit && !isBlankNode && selectedSourceText.length > 0;
  const isTitleEditBusy = isCreating || isComposerBusy;
  const titleEditTrimmed = titleEditValue.trim();
  const isTitleSaveDisabled =
    isTitleEditBusy ||
    !node ||
    !titleEditTrimmed ||
    titleEditTrimmed === node.title.trim();

  useEffect(() => {
    clearSelectedSourceText();
    resetComposerAttachments();
    setEditingMessageId(null);
    setEditingValue("");
    setIsEditingTitle(false);
    setTitleEditValue("");
    setIsDeleteDialogOpen(false);
    clearHeaderHighlightedAction();
    clearModeHighlightedAction();
  }, [
    clearSelectedSourceText,
    clearHeaderHighlightedAction,
    clearModeHighlightedAction,
    node?.id,
    resetComposerAttachments,
  ]);

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
    if (isInitialSubmit || isBlankNode || !node || !selectionAction || isComposerBusy) {
      return;
    }
    setSelectedSourceText(selectionAction.text);
    setMode("branch");
    dismissBrowserSelection();
  }

  function handleStartEdit(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditingValue(message.content);
    dismissBrowserSelection();
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
    dismissBrowserSelection();
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

  function handleRetryMessage(message: ChatMessage) {
    if (!node || isCreating) return;
    const skill = composerControls.prepareSkillForSend();
    void onRetryAssistantMessage(
      node.id,
      message.id,
      composerControls.modelSelection,
      skill,
    );
  }

  function handleConfirmDeleteNode() {
    if (!node) return;
    setIsDeleteDialogOpen(false);
    onDeleteNode(node.id);
  }

  if (!node) {
    return (
      <NodeDetailEmptyState
        showCollapseButton={showCollapseButton}
        onCollapse={onCollapse}
      />
    );
  }

  return (
    <aside
      ref={panelRef}
      aria-labelledby={titleId}
      data-testid="node-detail-panel"
      data-has-composer={showComposer ? "true" : "false"}
      className="node-detail-panel-surface grid h-full min-h-0 w-full overflow-visible rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none"
      style={panelStyle}
    >
      <DeleteNodeConfirmDialog
        isOpen={isDeleteDialogOpen}
        nodeTitle={node.title}
        deleteDescendantCount={deleteDescendantCount}
        titleId={deleteDialogTitleId}
        descriptionId={deleteDialogDescriptionId}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDeleteNode}
      />

      <NodeDetailHeaderSection
        node={node}
        titleId={titleId}
        showCollapseButton={showCollapseButton}
        showNotesAction={showNotesAction}
        isInitialSubmit={isInitialSubmit}
        isCreating={isCreating}
        isNotesOpen={isNotesOpen}
        isEditingTitle={isEditingTitle}
        isTitleEditBusy={isTitleEditBusy}
        isTitleSaveDisabled={isTitleSaveDisabled}
        titleEditValue={titleEditValue}
        headerHighlight={headerHighlight}
        onCollapse={onCollapse}
        onStartTitleEdit={handleStartTitleEdit}
        onTitleEditChange={setTitleEditValue}
        onCancelTitleEdit={handleCancelTitleEdit}
        onSaveTitleEdit={handleSaveTitleEdit}
        onToggleNode={onToggleNode}
        onRequestDeleteNode={() => setIsDeleteDialogOpen(true)}
        onToggleNotes={onToggleNotes}
        onResizePointerDown={handleHeaderResizePointerDown}
        onResizeMouseDown={handleHeaderResizeMouseDown}
      />

      <NodeConversationHistory
        node={node}
        messagesRef={messagesRef}
        displayMessages={displayMessages}
        inheritedMessageCount={inheritedMessageCount}
        shouldShowNodeBrief={shouldShowNodeBrief}
        isCreating={isCreating}
        streamingMessageId={streamingMessageId}
        editingMessageId={editingMessageId}
        editingValue={editingValue}
        copiedMessageKey={copiedMessageKey}
        latestEditableUserMessageId={latestEditableUserMessageId}
        latestRetryableAssistantMessageId={latestRetryableAssistantMessageId}
        onCaptureSelectionAction={captureSelectionAction}
        onEditingValueChange={setEditingValue}
        onCancelEdit={handleCancelEdit}
        onSaveEdit={handleSaveEdit}
        onCopyMessage={handleCopyMessage}
        onStartEdit={handleStartEdit}
        onRetryMessage={handleRetryMessage}
      />

      <SelectionActionFloatingButton
        selectionAction={selectionAction}
        visible={!isInitialSubmit && !isBlankNode && !isComposerBusy}
        onSelectAction={handleAskBranchMindSelection}
      />

      {showComposer && (
        <NodeDetailComposer
          input={input}
          mode={mode}
          isInitialSubmit={isInitialSubmit}
          isBlankNode={isBlankNode}
          hasSelectedTextContext={hasSelectedTextContext}
          isComposerBusy={isComposerBusy}
          isCheckingInitialSubmit={isCheckingInitialSubmit}
          displayError={displayError}
          errorId={errorId}
          statusId={statusId}
          composerPlaceholder={resolvedComposerPlaceholder}
          composerControls={composerControls}
          modeHighlight={modeHighlight}
          onInputChange={setInput}
          onModeChange={setMode}
          onClearSelectedSourceText={clearSelectedSourceText}
          onSubmit={handleSubmit}
          onResizePointerDown={handleComposerResizePointerDown}
          onResizeMouseDown={handleComposerResizeMouseDown}
        />
      )}
    </aside>
  );
}
