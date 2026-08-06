"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import type { ChatAttachment, ChatModelSelection, ChatSkill } from "@/lib/types";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { WorkspaceCanvasShell } from "./WorkspaceCanvasShell";
import type { InlineNodeComposerData } from "./BranchNodeCard";

type WorkspaceShellProps = {
  projectId: string;
};

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const { copy } = useLanguage();
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const hydrated = useBranchMindStore((state) => state.hydrated);
  const projects = useBranchMindStore((state) => state.projects);
  const activeProjectId = useBranchMindStore((state) => state.activeProjectId);
  const selectedNodeId = useBranchMindStore((state) => state.selectedNodeId);
  const creatingNodeId = useBranchMindStore((state) => state.creatingNodeId);
  const streamingNodeId = useBranchMindStore((state) => state.streamingNodeId);
  const streamingMessageId = useBranchMindStore((state) => state.streamingMessageId);
  const pendingProjectSync = useBranchMindStore(
    (state) => state.pendingProjectSyncs[projectId] ?? null,
  );
  const aiError = useBranchMindStore((state) => state.aiError);
  const selectProject = useBranchMindStore((state) => state.selectProject);
  const selectNode = useBranchMindStore((state) => state.selectNode);
  const startPendingInitialProjectStream = useBranchMindStore(
    (state) => state.startPendingInitialProjectStream,
  );
  const createChildNode = useBranchMindStore((state) => state.createChildNode);
  const createBlankChildNode = useBranchMindStore(
    (state) => state.createBlankChildNode,
  );
  const populateBlankNode = useBranchMindStore((state) => state.populateBlankNode);
  const editUserMessage = useBranchMindStore((state) => state.editUserMessage);
  const retryAssistantMessage = useBranchMindStore((state) => state.retryAssistantMessage);
  const retryPendingProjectSync = useBranchMindStore(
    (state) => state.retryPendingProjectSync,
  );
  const updateProjectNotes = useBranchMindStore((state) => state.updateProjectNotes);
  const updateNodeTitle = useBranchMindStore((state) => state.updateNodeTitle);
  const updateNodePosition = useBranchMindStore((state) => state.updateNodePosition);
  const toggleNodeCollapsed = useBranchMindStore((state) => state.toggleNodeCollapsed);
  const deleteNode = useBranchMindStore((state) => state.deleteNode);
  const [quickBranchNodeId, setQuickBranchNodeId] = useState<string | null>(null);
  const [quickBranchPersistingNodeId, setQuickBranchPersistingNodeId] = useState<
    string | null
  >(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    const project = projects.find((item) => item.id === projectId);
    if (project && activeProjectId !== projectId) selectProject(projectId);
  }, [activeProjectId, hydrated, projectId, projects, selectProject]);

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projectId, projects],
  );

  useEffect(() => {
    if (!hydrated || !project) return;
    startPendingInitialProjectStream(projectId);
  }, [hydrated, project, projectId, startPendingInitialProjectStream]);

  useEffect(() => {
    if (quickBranchNodeId && !project?.nodes[quickBranchNodeId]) {
      setQuickBranchNodeId(null);
    }
  }, [project, quickBranchNodeId]);

  // Only an in-flight sync should render the node as still generating. A
  // failed sync surfaces the retry banner instead; treating it as blocking
  // would leave the thinking timer running forever.
  const isProjectSyncBlocking =
    pendingProjectSync !== null && pendingProjectSync.status === "syncing";
  const pendingSyncNodeId = isProjectSyncBlocking ? pendingProjectSync.nodeId : null;
  const effectiveCreatingNodeId = creatingNodeId ?? pendingSyncNodeId;
  const effectiveStreamingNodeId = streamingNodeId ?? pendingSyncNodeId;
  const effectiveStreamingMessageId =
    streamingMessageId ??
    (isProjectSyncBlocking ? pendingProjectSync.assistantMessageId : null);

  const handleQuickCreate = useCallback(
    async (nodeId: string, mode: "continue" | "branch") => {
      if (mode === "branch") {
        const creation = createBlankChildNode(nodeId, mode);
        if (!creation) return;

        setQuickBranchNodeId(creation.nodeId);
        setQuickBranchPersistingNodeId(creation.nodeId);
        void creation.persisted.then(() => {
          setQuickBranchPersistingNodeId((current) =>
            current === creation.nodeId ? null : current,
          );
        });
        return;
      }

      const instruction = copy.workspace.initialInstruction;
      await createChildNode(nodeId, mode, instruction);
    },
    [copy.workspace.initialInstruction, createBlankChildNode, createChildNode],
  );

  const handleCreateFromPanel = useCallback(
    (
      nodeId: string,
      mode: "continue" | "branch",
      instruction: string,
      sourceText?: string,
      attachments?: ChatAttachment[],
      modelSelection?: ChatModelSelection,
      skill?: ChatSkill,
    ) => {
      return createChildNode(
        nodeId,
        mode,
        instruction,
        sourceText,
        attachments,
        modelSelection,
        skill,
      );
    },
    [createChildNode],
  );

  const inlineNodeComposer = useMemo<InlineNodeComposerData | undefined>(() => {
    if (!quickBranchNodeId) return undefined;

    return {
      nodeId: quickBranchNodeId,
      isBusy:
        effectiveCreatingNodeId === quickBranchNodeId ||
        effectiveStreamingNodeId === quickBranchNodeId,
      error: aiError,
      placeholder: copy.workspace.askNextQuestion,
      submitLabel: copy.workspace.send,
      autoFocus: true,
      isAwaitingPersistence: quickBranchPersistingNodeId === quickBranchNodeId,
      onSubmit: async (instruction, attachments, modelSelection, skill) => {
        const populated = await populateBlankNode(
          quickBranchNodeId,
          instruction,
          attachments,
          modelSelection,
          skill,
        );
        if (!populated) return null;

        setQuickBranchNodeId(null);
        return quickBranchNodeId;
      },
    };
  }, [
    aiError,
    copy.workspace.askNextQuestion,
    copy.workspace.send,
    effectiveCreatingNodeId,
    effectiveStreamingNodeId,
    populateBlankNode,
    quickBranchNodeId,
    quickBranchPersistingNodeId,
  ]);

  if (!hydrated) {
    return (
      <main
        aria-label={copy.workspace.loading}
        aria-busy="true"
        data-testid="workspace-loading-state"
        className="grid min-h-screen place-items-center px-5 text-lg font-black text-neutral-700"
      >
        <p role="status" aria-live="polite">
          {copy.workspace.loading}
        </p>
      </main>
    );
  }

  if (!project) {
    return (
      <main
        aria-labelledby="workspace-project-not-found-title"
        data-testid="workspace-project-not-found"
        className="grid min-h-screen place-items-center px-5"
      >
        <section
          aria-labelledby="workspace-project-not-found-title"
          className="w-full max-w-2xl rounded-[30px] border border-white/80 bg-white/72 p-6 text-center shadow-xl shadow-brand-100/50"
        >
          <h1
            id="workspace-project-not-found-title"
            className="text-3xl font-black text-neutral-900"
          >
            {copy.workspace.projectNotFound}
          </h1>
          <p className="mt-3 text-neutral-600">{copy.workspace.projectNotFoundBody}</p>
          <div className="mt-6">
            <ProjectLauncher />
          </div>
        </section>
      </main>
    );
  }

  return (
    <WorkspaceCanvasShell
      project={project}
      selectedNodeId={selectedNodeId}
      aiError={aiError}
      creatingNodeId={effectiveCreatingNodeId}
      streamingNodeId={effectiveStreamingNodeId}
      streamingMessageId={effectiveStreamingMessageId}
      onSelectNode={selectNode}
      onQuickCreateNode={handleQuickCreate}
      inlineNodeComposer={inlineNodeComposer}
      onCreateNode={handleCreateFromPanel}
      onPopulateNode={populateBlankNode}
      onEditUserMessage={editUserMessage}
      onRetryAssistantMessage={retryAssistantMessage}
      onUpdateNodeTitle={updateNodeTitle}
      onToggleNode={toggleNodeCollapsed}
      onDeleteNode={deleteNode}
      onMoveNode={updateNodePosition}
      syncFailure={
        pendingProjectSync?.status === "failed"
          ? {
              message: copy.workspace.syncFailed(pendingProjectSync.error ?? undefined),
              onRetry: () => retryPendingProjectSync(projectId),
            }
          : null
      }
      projectNotesConfig={{
        projectNotes: project.notes,
        onUpdateProjectNotes: updateProjectNotes,
      }}
      mobileNavigationMode="drawers"
    />
  );
}
