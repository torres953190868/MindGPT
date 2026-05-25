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
import { HomeStartComposer } from "./HomeStartComposer";
import { WorkspaceCanvasShell } from "./WorkspaceCanvasShell";

const DRAFT_PROJECT_ID = "home-draft-project";
const DRAFT_ROOT_NODE_ID = "home-draft-root";
const DRAFT_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const HOME_COMPOSER_PLACEHOLDER =
  "输入一个研究问题，BranchMind 会把理解路径拆成可探索的分支...";
const HOME_PROMPT_SUGGESTION_GROUPS = [
  ["拆解论文论点", "规划学习路线", "拆分复杂概念"],
  ["找到关键假设", "生成追问清单", "搭建理解地图"],
  ["比较不同观点", "提炼核心问题", "定位知识盲区"],
  ["发散研究方向", "收束行动计划", "整理学习笔记"],
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

function useCompactHomeLayout() {
  const [isCompact, setIsCompact] = useState<boolean | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const syncCompactLayout = () => setIsCompact(mediaQuery.matches);

    syncCompactLayout();
    mediaQuery.addEventListener("change", syncCompactLayout);

    return () => mediaQuery.removeEventListener("change", syncCompactLayout);
  }, []);

  return isCompact;
}

export function HomeDraftWorkspace() {
  const router = useRouter();
  const isCompactHomeLayout = useCompactHomeLayout();
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
  const promptSuggestions =
    HOME_PROMPT_SUGGESTION_GROUPS[
      taglineIndex % HOME_PROMPT_SUGGESTION_GROUPS.length
    ];

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

  const renderMobileHome = (testIdsEnabled: boolean) => (
    <main
      aria-labelledby="mobile-home-title"
      data-testid={testIdsEnabled ? "mobile-home-shell" : undefined}
      className="branchmind-mobile-home-shell min-h-[100svh] bg-surface-bg px-3 py-3 text-neutral-900"
    >
      <header
        data-testid={testIdsEnabled ? "mobile-home-header" : undefined}
        className="flex min-h-12 items-center gap-3"
      >
        <div className="min-w-0">
          <p className="branchmind-home-logo truncate text-lg font-black leading-tight text-neutral-900">
            BranchMind
          </p>
          <p className="truncate text-xs font-bold text-neutral-500">分支学习画布</p>
        </div>
      </header>

      <section
        data-testid={testIdsEnabled ? "home-hero" : undefined}
        className="branchmind-home-hero pt-8 text-left"
      >
        <h1
          id="mobile-home-title"
          className="branchmind-home-logo home-title-soft text-[42px] font-black leading-none text-neutral-900"
        >
          BranchMind
        </h1>
        <p
          data-testid={testIdsEnabled ? "home-hero-tagline" : undefined}
          className={[
            "home-tagline-rotator",
            `home-tagline-rotator-${taglinePhase}`,
            "mt-3 text-base font-bold leading-6 text-neutral-600",
          ].join(" ")}
          aria-live="polite"
          aria-atomic="true"
        >
          {HOME_HERO_TAGLINES[taglineIndex]}
        </p>
      </section>

      <div
        className="mt-5"
        data-testid={testIdsEnabled ? "mobile-home-start" : undefined}
      >
        <HomeStartComposer
          isBusy={creatingProject}
          error={aiError}
          onSubmit={handleStartProject}
          placeholder={HOME_COMPOSER_PLACEHOLDER}
          submitLabel="开始"
          suggestions={promptSuggestions}
          suggestionsAnimationPhase={taglinePhase}
          testIdsEnabled={testIdsEnabled}
        />
      </div>

      <section
        aria-label="BranchMind map preview"
        data-testid={testIdsEnabled ? "mobile-home-map-preview" : undefined}
        className="branchmind-mobile-home-preview branchmind-grid relative mt-4 h-[230px] overflow-hidden rounded-xl border border-neutral-200 bg-surface-canvas shadow-sm"
      >
        <div className="absolute left-5 top-7 w-[46%] rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
          <p className="text-xs font-black text-neutral-900">研究问题</p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-neutral-500">
            从一个问题开始
          </p>
        </div>
        <div className="absolute left-[42%] top-[86px] h-px w-[28%] bg-brand-300" />
        <div className="absolute right-5 top-[66px] w-[40%] rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
          <p className="text-xs font-black text-neutral-900">关键假设</p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-neutral-500">
            拆出可验证分支
          </p>
        </div>
        <div className="absolute left-[36%] top-[126px] h-px w-[24%] -rotate-12 bg-success-300" />
        <div className="absolute bottom-8 left-9 w-[43%] rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
          <p className="text-xs font-black text-neutral-900">追问路径</p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-neutral-500">
            把理解继续长出来
          </p>
        </div>
      </section>
    </main>
  );

  const desktopWorkspace = (
    <WorkspaceCanvasShell
      project={draftProject}
      selectedNodeId={selectedNodeId}
      aiError={aiError}
      creatingNodeId={null}
      streamingNodeId={creatingProject ? DRAFT_ROOT_NODE_ID : null}
      streamingMessageId={null}
      onSelectNode={handleSelectNode}
      onQuickCreateNode={ignoreQuickCreateNode}
      onCreateNode={ignoreCreateNode}
      onPopulateNode={ignoreMessageMutation}
      onEditUserMessage={ignoreMessageMutation}
      onRetryAssistantMessage={ignoreMessageMutation}
      onUpdateNodeTitle={ignoreMessageMutation}
      onToggleNode={ignoreNodeMutation}
      onDeleteNode={ignoreNodeMutation}
      onMoveNode={handleMoveNode}
      dataDraftWorkspace
      disableNodeCreationActions
      initialWorkspaceSidebarCollapsed
      initialNodeDetailPanelCollapsed
      canvasIntro={
        <div
          data-testid="home-hero"
          className="branchmind-home-hero max-w-[min(760px,calc(100vw-36px))] text-center sm:max-w-[min(760px,calc(100vw-48px))]"
        >
          <p className="branchmind-home-logo home-title-soft text-[42px] font-black leading-none text-neutral-900 sm:text-7xl lg:text-8xl">
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
        submitLabel: "开始",
        variant: "home",
        suggestions: promptSuggestions,
        suggestionsAnimationPhase: taglinePhase,
      }}
      nodeDetailOptions={{
        initialSubmit: true,
        onStartProject: handleStartProject,
        showNotesAction: false,
        composerPlaceholder: HOME_COMPOSER_PLACEHOLDER,
        submitLabel: "开始",
      }}
    />
  );

  if (isCompactHomeLayout === null) {
    return (
      <>
        <div className="lg:hidden">{renderMobileHome(false)}</div>
        <div className="hidden lg:block">{desktopWorkspace}</div>
      </>
    );
  }

  if (isCompactHomeLayout) return renderMobileHome(true);

  return desktopWorkspace;
}
