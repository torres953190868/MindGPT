"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthPromptDialog } from "@/components/auth/AuthPromptDialog";
import { useLanguage } from "@/components/language/LanguageProvider";
import { ROOT_POSITION } from "@/lib/graph";
import type {
  ChatAttachment,
  ChatModelSelection,
  ChatSkill,
  NodePosition,
  Project,
} from "@/lib/types";
import { useAuthStore } from "@/store/useAuthStore";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { WorkspaceCanvasShell } from "./WorkspaceCanvasShell";

const DRAFT_PROJECT_ID = "home-draft-project";
const DRAFT_ROOT_NODE_ID = "home-draft-root";
const DRAFT_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const HOME_TAGLINE_INTERVAL_MS = 4000;
const HOME_TAGLINE_EXIT_MS = 260;
const HOME_TAGLINE_ENTER_MS = 420;
const AUTH_REQUIRED_MESSAGE = "You need to sign in to do that.";

type HomeTaglinePhase = "idle" | "leaving" | "entering";

function createDraftProject(
  rootPosition: NodePosition,
  copy: ReturnType<typeof useLanguage>["copy"],
): Project {
  return {
    id: DRAFT_PROJECT_ID,
    title: copy.home.newWorkspace,
    notes: "",
    rootNodeId: DRAFT_ROOT_NODE_ID,
    nodes: {
      [DRAFT_ROOT_NODE_ID]: {
        id: DRAFT_ROOT_NODE_ID,
        projectId: DRAFT_PROJECT_ID,
        parentId: null,
        title: copy.home.newNode,
        titleManuallyEdited: false,
        summary: copy.home.draftNodeSummary,
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
  const { copy } = useLanguage();
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState(DRAFT_ROOT_NODE_ID);
  const [rootPosition, setRootPosition] = useState<NodePosition>(ROOT_POSITION);
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [taglinePhase, setTaglinePhase] = useState<HomeTaglinePhase>("idle");
  const [isAuthPromptOpen, setIsAuthPromptOpen] = useState(false);
  const pendingSubmitRef = useRef<(() => void) | null>(null);
  const sessionStatus = useAuthStore((state) => state.sessionStatus);
  const ensureSessionLoaded = useAuthStore((state) => state.ensureSessionLoaded);
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const createProject = useBranchMindStore((state) => state.createProject);
  const creatingProject = useBranchMindStore((state) => state.creatingProject);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);
  const draftProject = useMemo(() => createDraftProject(rootPosition, copy), [copy, rootPosition]);
  const promptSuggestions =
    copy.home.suggestions[taglineIndex % copy.home.suggestions.length];

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    void ensureSessionLoaded();
  }, [ensureSessionLoaded]);

  useEffect(() => {
    if (copy.home.taglines.length < 2) return undefined;

    let exitTimer: number | undefined;
    let enterTimer: number | undefined;
    const interval = window.setInterval(() => {
      setTaglinePhase("leaving");
      exitTimer = window.setTimeout(() => {
        setTaglineIndex(
          (currentIndex) => (currentIndex + 1) % copy.home.taglines.length,
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
  }, [copy.home.taglines]);

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
      skill?: ChatSkill,
    ) => {
      clearAiError();
      const projectId = await createProject(instruction, attachments, modelSelection, skill);
      if (projectId) router.replace(`/workspace/${projectId}`);
      return projectId;
    },
    [clearAiError, createProject, router],
  );

  const handleBeforeStartProject = useCallback(
    async (resumeSubmit: () => void) => {
      await ensureSessionLoaded();
      if (useAuthStore.getState().sessionStatus !== "anonymous") return true;

      pendingSubmitRef.current = resumeSubmit;
      setIsAuthPromptOpen(true);
      return false;
    },
    [ensureSessionLoaded],
  );

  const handleAuthPromptOpenChange = useCallback((open: boolean) => {
    setIsAuthPromptOpen(open);
    if (!open) pendingSubmitRef.current = null;
  }, []);

  const handleAuthPromptAuthenticated = useCallback(() => {
    setIsAuthPromptOpen(false);
    const resumeSubmit = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    if (resumeSubmit) window.setTimeout(resumeSubmit, 0);
  }, []);

  const autoPrepareHomePdfAttachments =
    sessionStatus === "authenticated" || sessionStatus === "local";
  const visibleAiError =
    sessionStatus === "anonymous" && aiError === AUTH_REQUIRED_MESSAGE ? null : aiError;
  const taglineClassName = [
    "home-tagline-rotator",
    `home-tagline-rotator-${taglinePhase}`,
    "mt-4 text-base font-bold text-neutral-500 sm:text-2xl",
  ].join(" ");

  return (
    <>
      <WorkspaceCanvasShell
        project={draftProject}
        selectedNodeId={selectedNodeId}
        aiError={visibleAiError}
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
        mobileNavigationMode="drawers"
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
              {copy.home.taglines[taglineIndex]}
            </p>
          </div>
        }
        inlineNodeComposer={{
          nodeId: DRAFT_ROOT_NODE_ID,
          isBusy: creatingProject,
          error: visibleAiError,
          onBeforeSubmit: handleBeforeStartProject,
          onSubmit: handleStartProject,
          autoPreparePdfAttachments: autoPrepareHomePdfAttachments,
          placeholder: copy.home.composerPlaceholder,
          submitLabel: copy.home.start,
          variant: "home",
          suggestions: promptSuggestions,
          suggestionsAnimationPhase: taglinePhase,
        }}
        nodeDetailOptions={{
          initialSubmit: true,
          autoPreparePdfAttachments: autoPrepareHomePdfAttachments,
          onBeforeInitialSubmit: handleBeforeStartProject,
          onStartProject: handleStartProject,
          showNotesAction: false,
          composerPlaceholder: copy.home.composerPlaceholder,
          submitLabel: copy.home.start,
        }}
      />
      <AuthPromptDialog
        open={isAuthPromptOpen}
        onOpenChange={handleAuthPromptOpenChange}
        onAuthenticated={handleAuthPromptAuthenticated}
      />
    </>
  );
}
