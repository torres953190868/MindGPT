"use client";

import { useCallback, useEffect, useMemo } from "react";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import type { ChatAttachment, ChatModelSelection } from "@/lib/types";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { WorkspaceCanvasShell } from "./WorkspaceCanvasShell";

type WorkspaceShellProps = {
  projectId: string;
};

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const hydrated = useBranchMindStore((state) => state.hydrated);
  const projects = useBranchMindStore((state) => state.projects);
  const activeProjectId = useBranchMindStore((state) => state.activeProjectId);
  const selectedNodeId = useBranchMindStore((state) => state.selectedNodeId);
  const creatingNodeId = useBranchMindStore((state) => state.creatingNodeId);
  const streamingNodeId = useBranchMindStore((state) => state.streamingNodeId);
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

  const isProjectSyncBlocking =
    pendingProjectSync !== null && pendingProjectSync.status !== "synced";
  const pendingSyncNodeId = isProjectSyncBlocking ? pendingProjectSync.nodeId : null;
  const effectiveCreatingNodeId = creatingNodeId ?? pendingSyncNodeId;
  const effectiveStreamingNodeId = streamingNodeId ?? pendingSyncNodeId;

  const handleQuickCreate = useCallback(
    (nodeId: string, mode: "continue" | "branch") => {
      if (mode === "branch") {
        void createBlankChildNode(nodeId, mode);
        return;
      }

      const instruction = "Continue with the next key knowledge point.";
      void createChildNode(nodeId, mode, instruction);
    },
    [createBlankChildNode, createChildNode],
  );

  const handleCreateFromPanel = useCallback(
    (
      nodeId: string,
      mode: "continue" | "branch",
      instruction: string,
      sourceText?: string,
      attachments?: ChatAttachment[],
      modelSelection?: ChatModelSelection,
    ) => {
      return createChildNode(
        nodeId,
        mode,
        instruction,
        sourceText,
        attachments,
        modelSelection,
      );
    },
    [createChildNode],
  );

  if (!hydrated) {
    return (
      <main
        aria-label="Loading BranchMind workspace"
        aria-busy="true"
        data-testid="workspace-loading-state"
        className="grid min-h-screen place-items-center px-5 text-lg font-black text-neutral-700"
      >
        <p role="status" aria-live="polite">
          Loading BranchMind...
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
            Project not found
          </h1>
          <p className="mt-3 text-neutral-600">Create a new BranchMind project.</p>
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
      onSelectNode={selectNode}
      onQuickCreateNode={handleQuickCreate}
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
              message: `Sync failed. ${pendingProjectSync.error ?? "Your project is saved in this browser."}`,
              onRetry: () => retryPendingProjectSync(projectId),
            }
          : null
      }
      projectNotesConfig={{
        projectNotes: project.notes,
        onUpdateProjectNotes: updateProjectNotes,
      }}
    />
  );
}
