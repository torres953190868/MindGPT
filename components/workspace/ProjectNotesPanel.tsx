"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FileDown,
  NotebookPen,
  PanelRightClose,
  PlusCircle,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { exportProjectNotesPdf } from "@/lib/client/project-notes-pdf";
import { PROJECT_NOTES_MAX_LENGTH } from "@/lib/project-notes";
import type { MindNode } from "@/lib/types";
import { ProjectNotesEditor, type ProjectNotesEditorHandle } from "./ProjectNotesEditor";

type ProjectNotesPanelProps = {
  projectId: string;
  projectTitle: string;
  projectNotes: string;
  node: MindNode | null;
  isCreating: boolean;
  onUpdateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
  onClose: () => void;
  backAction?: {
    label: string;
    onClick: () => void;
  };
};

type NotesSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const NOTES_AUTOSAVE_DELAY_MS = 800;

function getLatestAssistantContent(node: MindNode | null) {
  if (!node) return "";

  for (let index = node.messages.length - 1; index >= 0; index -= 1) {
    const message = node.messages[index];
    const content = message.role === "assistant" ? message.content.trim() : "";
    if (content) return content;
  }

  return "";
}

function formatLatestReplyNote(node: MindNode, content: string, untitledLabel: string) {
  return `## ${node.title.trim() || untitledLabel}\n\n${content.trim()}`;
}

function getNotesStatusLabel(
  status: NotesSaveStatus,
  labels: {
    ready: string;
    saveFailed: string;
    saved: string;
    saving: string;
    unsavedChanges: string;
  },
) {
  if (status === "dirty") return labels.unsavedChanges;
  if (status === "saving") return labels.saving;
  if (status === "saved") return labels.saved;
  if (status === "error") return labels.saveFailed;
  return labels.ready;
}

export function ProjectNotesPanel({
  projectId,
  projectTitle,
  projectNotes,
  node,
  isCreating,
  onUpdateProjectNotes,
  onClose,
  backAction,
}: ProjectNotesPanelProps) {
  const { copy } = useLanguage();
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const notesErrorId = `${panelId}-notes-error`;
  const [notesDraft, setNotesDraft] = useState(projectNotes);
  const [notesSaveStatus, setNotesSaveStatus] = useState<NotesSaveStatus>("idle");
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);
  const notesAutosaveTimerRef = useRef<number | null>(null);
  const notesEditorRef = useRef<ProjectNotesEditorHandle>(null);
  const notesDraftRef = useRef(projectNotes);
  const notesDirtyRef = useRef(false);
  const notesSaveVersionRef = useRef(0);
  const previousProjectIdRef = useRef(projectId);
  const latestAssistantContent = useMemo(() => getLatestAssistantContent(node), [node]);
  const canAppendLatestAiReply = Boolean(node && latestAssistantContent && !isCreating);

  useEffect(() => {
    notesDraftRef.current = notesDraft;
  }, [notesDraft]);

  useEffect(() => {
    const projectChanged = previousProjectIdRef.current !== projectId;
    if (projectChanged) {
      previousProjectIdRef.current = projectId;
      notesDirtyRef.current = false;
      notesSaveVersionRef.current += 1;
      setNotesDraft(projectNotes);
      setNotesSaveStatus("idle");
      setNotesSaveError(null);
      return;
    }

    if (!notesDirtyRef.current) {
      setNotesDraft(projectNotes);
    }
  }, [projectId, projectNotes]);

  useEffect(() => {
    if (notesSaveStatus !== "dirty") return undefined;

    if (notesAutosaveTimerRef.current) {
      window.clearTimeout(notesAutosaveTimerRef.current);
    }

    notesAutosaveTimerRef.current = window.setTimeout(() => {
      const notesToSave = notesDraftRef.current;
      const requestVersion = notesSaveVersionRef.current;

      setNotesSaveStatus("saving");
      setNotesSaveError(null);

      void onUpdateProjectNotes(projectId, notesToSave).then((saved) => {
        if (
          requestVersion !== notesSaveVersionRef.current ||
          notesDraftRef.current !== notesToSave
        ) {
          return;
        }

        if (saved) {
          notesDirtyRef.current = false;
          setNotesSaveStatus("saved");
          setNotesSaveError(null);
          return;
        }

        notesDirtyRef.current = true;
        setNotesSaveStatus("error");
        setNotesSaveError(copy.workspace.notesCouldNotSave);
      });
    }, NOTES_AUTOSAVE_DELAY_MS);

    return () => {
      if (notesAutosaveTimerRef.current) {
        window.clearTimeout(notesAutosaveTimerRef.current);
        notesAutosaveTimerRef.current = null;
      }
    };
  }, [copy.workspace.notesCouldNotSave, notesDraft, notesSaveStatus, onUpdateProjectNotes, projectId]);

  useEffect(() => {
    return () => {
      if (notesAutosaveTimerRef.current) {
        window.clearTimeout(notesAutosaveTimerRef.current);
      }
    };
  }, []);

  function handleNotesChange(value: string) {
    notesSaveVersionRef.current += 1;

    if (value.length > PROJECT_NOTES_MAX_LENGTH) {
      notesDirtyRef.current = true;
      setNotesSaveStatus("error");
      setNotesSaveError(copy.workspace.notesTooLong);
      return;
    }

    notesDirtyRef.current = true;
    setNotesDraft(value);
    setNotesSaveStatus("dirty");
    setNotesSaveError(null);
  }

  function handleAppendLatestAiReply() {
    if (!node || !canAppendLatestAiReply) return;

    const section = formatLatestReplyNote(node, latestAssistantContent, copy.workspace.untitledNode);
    const nextNotes = notesDraft.trim()
      ? `${notesDraft.trimEnd()}\n\n${section}`
      : section;

    if (nextNotes.length > PROJECT_NOTES_MAX_LENGTH) {
      setNotesSaveStatus("error");
      setNotesSaveError(copy.workspace.notesTooLong);
      return;
    }

    handleNotesChange(nextNotes);
    window.requestAnimationFrame(() => {
      notesEditorRef.current?.focusEnd();
    });
  }

  function handleExportPdf() {
    const didOpenPrintDialog = exportProjectNotesPdf({
      notesHtml: notesEditorRef.current?.getPrintableHtml() ?? "",
      notesMarkdown: notesDraft,
      projectTitle,
    });

    if (!didOpenPrintDialog) {
      setNotesSaveError(copy.workspace.saveFailed);
    }
  }

  return (
    <aside
      id="project-notes-panel"
      aria-labelledby={titleId}
      data-testid="project-notes-panel"
      className="flex h-full min-h-0 w-full max-h-full flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/78 p-4 shadow-lg shadow-brand-100/35 lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 pb-4">
        <div className="min-w-0 space-y-2">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-neutral-600">
            <NotebookPen size={15} />
            Notes
          </p>
          <h2 id={titleId} className="text-xl font-black leading-snug text-neutral-900">
            {copy.workspace.projectNotes}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {backAction && (
            <button
              type="button"
              onClick={backAction.onClick}
              aria-label={backAction.label}
              data-testid="project-notes-back-button"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white/75 px-3 text-sm font-black text-brand-700 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
            >
              <ArrowLeft size={17} />
              <span>{backAction.label}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.workspace.closeProjectNotes}
            data-testid="close-project-notes-button"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/75 text-brand-700 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            <PanelRightClose size={18} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p
            role="status"
            aria-live="polite"
            data-testid="project-notes-save-status"
            className={`text-xs font-black uppercase tracking-[0.14em] ${
              notesSaveStatus === "error" ? "text-danger-600" : "text-neutral-600"
            }`}
          >
            {getNotesStatusLabel(notesSaveStatus, {
              ready: copy.workspace.ready,
              saveFailed: copy.workspace.saveFailed,
              saved: copy.common.saved,
              saving: copy.common.saving,
              unsavedChanges: copy.workspace.unsavedChanges,
            })}
          </p>
          <button
            type="button"
            onClick={handleExportPdf}
            aria-label={copy.common.exportPdf}
            data-testid="export-project-notes-pdf-button"
            title={copy.common.exportPdf}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[14px] border border-neutral-200 bg-white/78 px-3 text-xs font-black text-brand-700 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            <FileDown size={15} />
            {copy.common.exportPdf}
          </button>
        </div>

        <button
          type="button"
          onClick={handleAppendLatestAiReply}
          disabled={!canAppendLatestAiReply}
          aria-label={copy.workspace.addLatestAiReply}
          data-testid="add-latest-ai-reply-note-button"
          className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-[16px] bg-brand-100 text-sm font-black text-brand-700 transition hover:bg-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <PlusCircle size={16} />
          {copy.workspace.addLatestAiReply}
        </button>

        <ProjectNotesEditor
          ref={notesEditorRef}
          value={notesDraft}
          onChange={handleNotesChange}
          maxLength={PROJECT_NOTES_MAX_LENGTH}
          placeholder={copy.workspace.projectNotesPlaceholder}
          ariaLabel={copy.workspace.projectNotes}
          ariaDescribedBy={notesSaveError ? notesErrorId : undefined}
          testId="project-notes-input"
        />

        {notesSaveError && (
          <p
            id={notesErrorId}
            role="alert"
            data-testid="project-notes-error-alert"
            className="shrink-0 rounded-[18px] bg-danger-100 px-3 py-2 text-sm font-bold text-danger-600"
          >
            {notesSaveError}
          </p>
        )}
      </div>
    </aside>
  );
}
