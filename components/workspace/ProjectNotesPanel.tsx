"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FileDown,
  NotebookPen,
  PanelRightClose,
  PlusCircle,
} from "lucide-react";
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

function formatLatestReplyNote(node: MindNode, content: string) {
  return `## ${node.title.trim() || "Untitled node"}\n\n${content.trim()}`;
}

function getNotesStatusLabel(status: NotesSaveStatus) {
  if (status === "dirty") return "Unsaved changes";
  if (status === "saving") return "Saving...";
  if (status === "saved") return "Saved";
  if (status === "error") return "Save failed";
  return "Ready";
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
        setNotesSaveError("Notes could not be saved.");
      });
    }, NOTES_AUTOSAVE_DELAY_MS);

    return () => {
      if (notesAutosaveTimerRef.current) {
        window.clearTimeout(notesAutosaveTimerRef.current);
        notesAutosaveTimerRef.current = null;
      }
    };
  }, [notesDraft, notesSaveStatus, onUpdateProjectNotes, projectId]);

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
      setNotesSaveError("Project notes are too long.");
      return;
    }

    notesDirtyRef.current = true;
    setNotesDraft(value);
    setNotesSaveStatus("dirty");
    setNotesSaveError(null);
  }

  function handleAppendLatestAiReply() {
    if (!node || !canAppendLatestAiReply) return;

    const section = formatLatestReplyNote(node, latestAssistantContent);
    const nextNotes = notesDraft.trim()
      ? `${notesDraft.trimEnd()}\n\n${section}`
      : section;

    if (nextNotes.length > PROJECT_NOTES_MAX_LENGTH) {
      setNotesSaveStatus("error");
      setNotesSaveError("Project notes are too long.");
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
      setNotesSaveError("PDF export is not available in this browser.");
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
            Project notes
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
            aria-label="Close project notes"
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
            {getNotesStatusLabel(notesSaveStatus)}
          </p>
          <button
            type="button"
            onClick={handleExportPdf}
            aria-label="Export project notes as PDF"
            data-testid="export-project-notes-pdf-button"
            title="Export project notes as PDF"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[14px] border border-neutral-200 bg-white/78 px-3 text-xs font-black text-brand-700 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            <FileDown size={15} />
            Export PDF
          </button>
        </div>

        <button
          type="button"
          onClick={handleAppendLatestAiReply}
          disabled={!canAppendLatestAiReply}
          aria-label="Add latest AI reply to project notes"
          data-testid="add-latest-ai-reply-note-button"
          className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-[16px] bg-brand-100 text-sm font-black text-brand-700 transition hover:bg-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <PlusCircle size={16} />
          Add latest AI reply
        </button>

        <ProjectNotesEditor
          ref={notesEditorRef}
          value={notesDraft}
          onChange={handleNotesChange}
          maxLength={PROJECT_NOTES_MAX_LENGTH}
          placeholder="Project notes..."
          ariaLabel="Project notes"
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
