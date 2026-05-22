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
const HOME_COMPOSER_PLACEHOLDER =
  "输入一个研究问题，BranchMind 会把理解路径拆成可探索的分支...";
const HOME_PROMPT_SUGGESTIONS = [
  "拆解论文论点",
  "规划学习路线",
  "拆分复杂概念",
];
const HOME_HERO_TAGLINES = [
  "你可以外包思考，但是无法外包理解。",
  "把复杂问题拆开，理解会自己长出来。",
  "每一次追问，都是一条新的思路分支。",
  "让灵感发散，让理解收束。",
];
const HOME_TAGLINE_INTERVAL_MS = 4000;
const HOME_TAGLINE_EXIT_MS = 260;
const HOME_TAGLINE_ENTER_MS = 420;

type HomeTaglinePhase = "idle" | "leaving" | "entering";

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
        summary: "输入一个研究问题，创建你的分支学习画布。",
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
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [taglinePhase, setTaglinePhase] = useState<HomeTaglinePhase>("idle");
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const createProject = useBranchMindStore((state) => state.createProject);
  const creatingProject = useBranchMindStore((state) => state.creatingProject);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);
  const draftProject = useMemo(() => createDraftProject(rootPosition), [rootPosition]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (HOME_HERO_TAGLINES.length < 2) return undefined;

    let exitTimer: number | undefined;
    let enterTimer: number | undefined;
    const interval = window.setInterval(() => {
      setTaglinePhase("leaving");
      exitTimer = window.setTimeout(() => {
        setTaglineIndex(
          (currentIndex) => (currentIndex + 1) % HOME_HERO_TAGLINES.length,
        );
        setTaglinePhase("entering");
        enterTimer = window.setTimeout(() => {
          setTaglinePhase("idle");
        }, HOME_TAGLINE_ENTER_MS);
      }, HOME_TAGLINE_EXIT_MS);
    }, HOME_TAGLINE_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
      if (enterTimer !== undefined) window.clearTimeout(enterTimer);
    };
  }, []);

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
  const taglineClassName = [
    "home-tagline-rotator",
    `home-tagline-rotator-${taglinePhase}`,
    "mt-4 text-base font-bold text-neutral-500 sm:text-2xl",
  ].join(" ");

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
      initialWorkspaceSidebarCollapsed
      initialNodeDetailPanelCollapsed
      canvasIntro={
        <div
          data-testid="home-hero"
          className="max-w-[min(760px,calc(100vw-48px))] text-center"
        >
          <p className="home-title-soft text-5xl font-black leading-none text-neutral-900 sm:text-7xl lg:text-8xl">
            BranchMind
          </p>
          <p
            data-testid="home-hero-tagline"
            className={taglineClassName}
            aria-live="polite"
            aria-atomic="true"
          >
            {HOME_HERO_TAGLINES[taglineIndex]}
          </p>
        </div>
      }
      inlineNodeComposer={{
        nodeId: DRAFT_ROOT_NODE_ID,
        isBusy: creatingProject,
        error: aiError,
        onSubmit: handleStartProject,
        placeholder: HOME_COMPOSER_PLACEHOLDER,
        submitLabel: "Start",
        variant: "home",
        suggestions: HOME_PROMPT_SUGGESTIONS,
      }}
      nodeDetailOptions={{
        initialSubmit: true,
        onStartProject: handleStartProject,
        showNotesAction: false,
        composerPlaceholder: HOME_COMPOSER_PLACEHOLDER,
        submitLabel: "Start",
      }}
    />
  );
}
