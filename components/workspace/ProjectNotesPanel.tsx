"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NotebookPen, PanelRightClose, PlusCircle } from "lucide-react";
import { PROJECT_NOTES_MAX_LENGTH } from "@/lib/project-notes";
import type { MindNode } from "@/lib/types";
import { ProjectNotesEditor, type ProjectNotesEditorHandle } from "./ProjectNotesEditor";

type ProjectNotesPanelProps = {
  projectId: string;
  projectNotes: string;
  node: MindNode | null;
  isCreating: boolean;
  onUpdateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
  onClose: () => void;
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
  projectNotes,
  node,
  isCreating,
  onUpdateProjectNotes,
  onClose,
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

  return (
    <aside
      id="project-notes-panel"
      aria-labelledby={titleId}
      data-testid="project-notes-panel"
      className="flex h-full min-h-0 w-full max-h-full flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e4d6ef]/40 lg:rounded-none lg:border-0 lg:bg-white lg:shadow-none"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#eadff1] pb-4">
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
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/75 text-[#6c538d] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
        >
          <PanelRightClose size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
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
        </div>

        <button
          type="button"
          onClick={handleAppendLatestAiReply}
          disabled={!canAppendLatestAiReply}
          aria-label="Add latest AI reply to project notes"
          data-testid="add-latest-ai-reply-note-button"
          className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-[16px] bg-[#eadcf7] text-sm font-black text-[#6e4ca0] transition hover:bg-[#dfc9f3] disabled:cursor-not-allowed disabled:opacity-65"
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
            className="shrink-0 rounded-[18px] bg-[#ffeceb] px-3 py-2 text-sm font-bold text-[#8f3f3a]"
          >
            {notesSaveError}
          </p>
        )}
      </div>
    </aside>
  );
}
