"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Eye, NotebookPen, PanelRightClose, PencilLine, PlusCircle } from "lucide-react";
import type { MindNode } from "@/lib/types";
import { MarkdownMessage } from "./MarkdownMessage";

type ProjectNotesPanelProps = {
  projectId: string;
  projectNotes: string;
  node: MindNode | null;
  isCreating: boolean;
  onUpdateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
  onClose: () => void;
};

type NotesMode = "edit" | "preview";
type NotesSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const NOTES_AUTOSAVE_DELAY_MS = 800;
const PROJECT_NOTES_MAX_LENGTH = 60_000;

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
  projectNotes,
  node,
  isCreating,
  onUpdateProjectNotes,
  onClose,
}: ProjectNotesPanelProps) {
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const notesErrorId = `${panelId}-notes-error`;
  const [notesMode, setNotesMode] = useState<NotesMode>("edit");
  const [notesDraft, setNotesDraft] = useState(projectNotes);
  const [notesSaveStatus, setNotesSaveStatus] = useState<NotesSaveStatus>("idle");
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);
  const notesAutosaveTimerRef = useRef<number | null>(null);
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

    setNotesMode("edit");
    handleNotesChange(nextNotes);
  }

  return (
    <aside
      id="project-notes-panel"
      aria-labelledby={titleId}
      data-testid="project-notes-panel"
      className="flex min-h-0 w-full flex-col rounded-[28px] border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e4d6ef]/40"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#eadff1] pb-4">
        <div className="min-w-0 space-y-2">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#74687c]">
            <NotebookPen size={15} />
            Notes
          </p>
          <h2 id={titleId} className="text-xl font-black leading-snug text-[#332a39]">
            Project notes
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close project notes"
          data-testid="close-project-notes-button"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/75 text-[#6c538d] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
        >
          <PanelRightClose size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            role="status"
            aria-live="polite"
            data-testid="project-notes-save-status"
            className={`text-xs font-black uppercase tracking-[0.14em] ${
              notesSaveStatus === "error" ? "text-[#8f3f3a]" : "text-[#6c5b75]"
            }`}
          >
            {getNotesStatusLabel(notesSaveStatus)}
          </p>
          <div
            role="group"
            aria-label="Project notes mode"
            data-testid="project-notes-mode"
            className="grid w-full min-w-0 grid-cols-2 gap-2 sm:w-auto"
          >
            <button
              type="button"
              onClick={() => setNotesMode("edit")}
              aria-label="Edit project notes"
              aria-pressed={notesMode === "edit"}
              data-testid="project-notes-edit-button"
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-[14px] px-3 text-xs font-black transition ${
                notesMode === "edit"
                  ? "bg-[#dff5ea] text-[#376b50]"
                  : "bg-white/75 text-[#776c80] hover:bg-white"
              }`}
            >
              <PencilLine size={15} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setNotesMode("preview")}
              aria-label="Preview project notes"
              aria-pressed={notesMode === "preview"}
              data-testid="project-notes-preview-button"
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-[14px] px-3 text-xs font-black transition ${
                notesMode === "preview"
                  ? "bg-[#eadcf7] text-[#6e4ca0]"
                  : "bg-white/75 text-[#776c80] hover:bg-white"
              }`}
            >
              <Eye size={15} />
              Preview
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAppendLatestAiReply}
          disabled={!canAppendLatestAiReply}
          aria-label="Add latest AI reply to project notes"
          data-testid="add-latest-ai-reply-note-button"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[16px] bg-[#eadcf7] text-sm font-black text-[#6e4ca0] transition hover:bg-[#dfc9f3] disabled:cursor-not-allowed disabled:opacity-65"
        >
          <PlusCircle size={16} />
          Add latest AI reply
        </button>

        {notesMode === "edit" ? (
          <textarea
            value={notesDraft}
            onChange={(event) => handleNotesChange(event.target.value)}
            aria-label="Project notes"
            aria-describedby={notesSaveError ? notesErrorId : undefined}
            data-testid="project-notes-input"
            maxLength={PROJECT_NOTES_MAX_LENGTH}
            placeholder="Project notes..."
            className="min-h-[320px] flex-1 resize-none rounded-[20px] border border-white bg-white/82 p-3 text-sm leading-6 text-[#332b38] outline-none placeholder:text-[#665a70] focus:border-[#b696d4] focus:ring-4 focus:ring-[#eadcf7]"
          />
        ) : (
          <div
            data-testid="project-notes-preview"
            className="min-h-[320px] flex-1 overflow-auto rounded-[20px] border border-white bg-white/72 p-3 text-sm leading-6 text-[#514062]"
          >
            {notesDraft.trim() ? (
              <MarkdownMessage content={notesDraft} testId="project-notes-preview-content" />
            ) : (
              <p
                role="status"
                data-testid="project-notes-empty-preview"
                className="text-sm font-bold text-[#665a70]"
              >
                No notes yet.
              </p>
            )}
          </div>
        )}

        {notesSaveError && (
          <p
            id={notesErrorId}
            role="alert"
            data-testid="project-notes-error-alert"
            className="rounded-[18px] bg-[#ffeceb] px-3 py-2 text-sm font-bold text-[#8f3f3a]"
          >
            {notesSaveError}
          </p>
        )}
      </div>
    </aside>
  );
}
