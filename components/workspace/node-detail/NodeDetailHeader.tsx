"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
} from "react";
import {
  NotebookPen,
  PanelRightClose,
  Pencil,
  Ribbon,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  getHighlightedActionClass,
  type useHighlightedAction,
} from "@/components/ui/highlighted-action";
import type { MindNode } from "@/lib/types";
import type { HeaderActionItem } from "./node-detail-helpers";

type NodeDetailEmptyStateProps = {
  showCollapseButton: boolean;
  onCollapse: () => void;
};

export function NodeDetailEmptyState({
  showCollapseButton,
  onCollapse,
}: NodeDetailEmptyStateProps) {
  const { copy } = useLanguage();

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

type DeleteNodeConfirmDialogProps = {
  isOpen: boolean;
  nodeTitle: string;
  deleteDescendantCount: number;
  titleId: string;
  descriptionId: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteNodeConfirmDialog({
  isOpen,
  nodeTitle,
  deleteDescendantCount,
  titleId,
  descriptionId,
  onClose,
  onConfirm,
}: DeleteNodeConfirmDialogProps) {
  const { copy } = useLanguage();
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    deleteCancelButtonRef.current?.focus();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/45 px-4 py-6 backdrop-blur-sm"
      data-testid="delete-node-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="delete-node-dialog"
        className="w-full max-w-md rounded-xl border border-danger-200 bg-white p-5 text-left shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-danger-50 text-danger-500">
            <Trash2 size={19} />
          </span>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg font-extrabold text-neutral-900"
            >
              {copy.workspace.deleteNodePrompt}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-sm font-semibold leading-6 text-neutral-700"
            >
              {copy.workspace.deleteNodeBody(nodeTitle, deleteDescendantCount)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={deleteCancelButtonRef}
            type="button"
            onClick={onClose}
            data-testid="cancel-delete-node-button"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-extrabold text-neutral-700 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {copy.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="confirm-delete-node-button"
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-danger-500 px-4 text-sm font-extrabold text-white transition hover:bg-danger-600 focus:outline-none focus:ring-2 focus:ring-danger-200"
          >
            {copy.common.delete}
          </button>
        </div>
      </section>
    </div>
  );
}

type NodeDetailHeaderSectionProps = {
  node: MindNode;
  titleId: string;
  showCollapseButton: boolean;
  showNotesAction: boolean;
  isInitialSubmit: boolean;
  isCreating: boolean;
  isNotesOpen: boolean;
  isEditingTitle: boolean;
  isTitleEditBusy: boolean;
  isTitleSaveDisabled: boolean;
  titleEditValue: string;
  headerHighlight: ReturnType<typeof useHighlightedAction<HeaderActionItem>>;
  onCollapse: () => void;
  onStartTitleEdit: () => void;
  onTitleEditChange: (value: string) => void;
  onCancelTitleEdit: () => void;
  onSaveTitleEdit: () => Promise<void> | void;
  onToggleNode: (nodeId: string) => void;
  onRequestDeleteNode: () => void;
  onToggleNotes: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export function NodeDetailHeaderSection({
  node,
  titleId,
  showCollapseButton,
  showNotesAction,
  isInitialSubmit,
  isCreating,
  isNotesOpen,
  isEditingTitle,
  isTitleEditBusy,
  isTitleSaveDisabled,
  titleEditValue,
  headerHighlight,
  onCollapse,
  onStartTitleEdit,
  onTitleEditChange,
  onCancelTitleEdit,
  onSaveTitleEdit,
  onToggleNode,
  onRequestDeleteNode,
  onToggleNotes,
  onResizePointerDown,
  onResizeMouseDown,
}: NodeDetailHeaderSectionProps) {
  const { copy } = useLanguage();
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  function handleTitleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelTitleEdit();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void onSaveTitleEdit();
    }
  }

  const isTitleEditButtonEnabled =
    !isInitialSubmit && !isEditingTitle && !isTitleEditBusy;
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

  return (
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
                onClick={onStartTitleEdit}
                disabled={isTitleEditBusy}
                aria-label={copy.workspace.editNodeTitle}
                title={copy.workspace.editNodeTitle}
                data-testid="edit-node-title-button"
                data-highlighted={headerHighlight.getDataHighlighted("edit", {
                  enabled: isTitleEditButtonEnabled,
                })}
                {...headerHighlight.getHoverHandlers("edit", {
                  clearOnMouseLeave: true,
                })}
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
                  onChange={(event) => onTitleEditChange(event.target.value)}
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
                    onClick={onCancelTitleEdit}
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
                    onClick={() => void onSaveTitleEdit()}
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
              <h2
                id={titleId}
                className="text-lg font-black leading-snug text-neutral-900 sm:text-xl"
              >
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
                  aria-label={
                    node.collapsed
                      ? copy.workspace.expandNode
                      : copy.workspace.foldNode
                  }
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
                  onClick={onRequestDeleteNode}
                  aria-label={copy.workspace.deleteNode}
                  data-testid="delete-node-button"
                  data-highlighted={headerHighlight.getDataHighlighted("delete", {
                    enabled: isDeleteButtonEnabled,
                  })}
                  {...headerHighlight.getHoverHandlers("delete", {
                    clearOnMouseLeave: true,
                  })}
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
                  aria-label={
                    isNotesOpen
                      ? copy.workspace.closeProjectNotes
                      : copy.workspace.openProjectNotes
                  }
                  aria-controls="project-notes-panel"
                  aria-expanded={isNotesOpen}
                  data-testid="node-detail-notes-button"
                  data-highlighted={headerHighlight.getDataHighlighted("notes", {
                    active: isNotesOpen,
                  })}
                  {...headerHighlight.getHoverHandlers("notes", {
                    clearOnMouseLeave: true,
                  })}
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
        onPointerDown={onResizePointerDown}
        onMouseDown={onResizeMouseDown}
        className="absolute -bottom-2 left-0 z-10 h-4 w-full cursor-row-resize transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
      />
    </div>
  );
}
