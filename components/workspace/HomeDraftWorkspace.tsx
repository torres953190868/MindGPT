"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ROOT_POSITION } from "@/lib/graph";
import type {
  ChatAttachment,
  ChatModelSelection,
  NodePosition,
  Project,
} from "@/lib/types";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { WorkspaceCanvasShell } from "./WorkspaceCanvasShell";

const DRAFT_PROJECT_ID = "home-draft-project";
const DRAFT_ROOT_NODE_ID = "home-draft-root";
const DRAFT_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function createDraftProject(rootPosition: NodePosition): Project {
  return {
    id: DRAFT_PROJECT_ID,
    title: "New workspace",
    notes: "",
    rootNodeId: DRAFT_ROOT_NODE_ID,
    nodes: {
      [DRAFT_ROOT_NODE_ID]: {
        id: DRAFT_ROOT_NODE_ID,
        projectId: DRAFT_PROJECT_ID,
        parentId: null,
        title: "New node",
        titleManuallyEdited: false,
        summary: "Start with a question to create your workspace.",
        messages: [],
        children: [],
        position: rootPosition,
        branchType: "root",
        collapsed: false,
        createdAt: DRAFT_TIMESTAMP,
        updatedAt: DRAFT_TIMESTAMP,
      },
    },
    createdAt: DRAFT_TIMESTAMP,
    updatedAt: DRAFT_TIMESTAMP,
  };
}

function ignoreQuickCreateNode() {}

async function ignoreCreateNode() {
  return null;
}

async function ignoreMessageMutation() {
  return false;
}

function ignoreNodeMutation() {}

export function HomeDraftWorkspace() {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState(DRAFT_ROOT_NODE_ID);
  const [rootPosition, setRootPosition] = useState<NodePosition>(ROOT_POSITION);
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const createProject = useBranchMindStore((state) => state.createProject);
  const creatingProject = useBranchMindStore((state) => state.creatingProject);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);
  const draftProject = useMemo(() => createDraftProject(rootPosition), [rootPosition]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const handleSelectNode = useCallback((nodeId: string) => {
    if (nodeId === DRAFT_ROOT_NODE_ID) setSelectedNodeId(nodeId);
  }, []);

  const handleMoveNode = useCallback((nodeId: string, position: NodePosition) => {
    if (nodeId !== DRAFT_ROOT_NODE_ID) return;
    setRootPosition(position);
  }, []);

  const handleStartProject = useCallback(
    async (
      instruction: string,
      attachments: ChatAttachment[] = [],
      modelSelection?: ChatModelSelection,
    ) => {
      clearAiError();
      const projectId = await createProject(instruction, attachments, modelSelection);
      if (projectId) router.replace(`/workspace/${projectId}`);
      return projectId;
    },
    [clearAiError, createProject, router],
  );

  return (
    <WorkspaceCanvasShell
      project={draftProject}
      selectedNodeId={selectedNodeId}
      aiError={aiError}
      creatingNodeId={null}
      streamingNodeId={creatingProject ? DRAFT_ROOT_NODE_ID : null}
      onSelectNode={handleSelectNode}
      onQuickCreateNode={ignoreQuickCreateNode}
      onCreateNode={ignoreCreateNode}
      onEditUserMessage={ignoreMessageMutation}
      onRetryAssistantMessage={ignoreMessageMutation}
      onUpdateNodeTitle={ignoreMessageMutation}
      onToggleNode={ignoreNodeMutation}
      onDeleteNode={ignoreNodeMutation}
      onMoveNode={handleMoveNode}
      dataDraftWorkspace
      disableNodeCreationActions
      showProjectStar={false}
      nodeDetailOptions={{
        initialSubmit: true,
        onStartProject: handleStartProject,
        showNotesAction: false,
        composerPlaceholder: "Start with a research question...",
        submitLabel: "Start",
      }}
    />
  );
}
