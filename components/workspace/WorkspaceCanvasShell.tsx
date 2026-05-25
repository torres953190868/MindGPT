"use client";

import {
  Map as MapIcon,
  MessageSquare,
  NotebookPen,
  PanelLeftOpen,
  PanelRightOpen,
  RefreshCcw,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { getNodeConversationMessages } from "@/lib/graph";
import type {
  ChatAttachment,
  ChatModelSelection,
  NodePosition,
  Project,
} from "@/lib/types";
import type { InlineNodeComposerData } from "./BranchNodeCard";
import { MindMap } from "./MindMap";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
import {
  getResizeInputMode,
  type ResizeStartEvent,
  WorkspaceResizeHandle,
} from "./WorkspaceResizeHandle";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const SIDE_PANEL_MIN_WIDTH = 170;
const SIDE_PANEL_SNAP_WIDTH = SIDE_PANEL_MIN_WIDTH / 2;
const SIDE_PANEL_PREFERRED_MIN_WIDTH = 300;
const DETAIL_PANEL_DEFAULT_WIDTH = 344;
const PROJECT_NOTES_PANEL_DEFAULT_WIDTH = 344;
const PROJECT_NOTES_PANEL_MIN_WIDTH = 280;
const PROJECT_NOTES_PANEL_MAX_WIDTH = 720;
const DESKTOP_MAP_MIN_WIDTH = 220;
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = SIDE_PANEL_PREFERRED_MIN_WIDTH;
const DESKTOP_RESIZE_HANDLE_WIDTH = 8;
const WORKSPACE_GRID_GAP = 0;
const MOBILE_MAP_DEFAULT_HEIGHT = 500;
const MOBILE_MAP_MIN_HEIGHT = 300;

type MobileWorkspaceView = "map" | "outline" | "chat" | "notes";
type ResizableSide = "left" | "right";

type CreateNodeHandler = (
  nodeId: string,
  mode: "continue" | "branch",
  instruction: string,
  sourceText?: string,
  attachments?: ChatAttachment[],
  modelSelection?: ChatModelSelection,
) => Promise<string | null>;

type PopulateNodeHandler = (
  nodeId: string,
  instruction: string,
  attachments?: ChatAttachment[],
  modelSelection?: ChatModelSelection,
) => Promise<boolean>;

type EditUserMessageHandler = (
  nodeId: string,
  userMessageId: string,
  instruction: string,
  modelSelection?: ChatModelSelection,
) => Promise<boolean>;

type RetryAssistantMessageHandler = (
  nodeId: string,
  assistantMessageId: string,
  modelSelection?: ChatModelSelection,
) => Promise<boolean>;

type UpdateNodeTitleHandler = (nodeId: string, title: string) => Promise<boolean>;

type ProjectNotesConfig = {
  projectNotes: string;
  onUpdateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
};

type NodeDetailOptions = {
  initialSubmit?: boolean;
  onStartProject?: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
  ) => Promise<string | null>;
  showNotesAction?: boolean;
  showCollapseButton?: boolean;
  composerPlaceholder?: string;
  submitLabel?: string;
};

type WorkspaceCanvasShellProps = {
  project: Project;
  selectedNodeId: string | null;
  aiError: string | null;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  streamingMessageId: string | null;
  onSelectNode: (nodeId: string) => void;
  onQuickCreateNode: (nodeId: string, mode: "continue" | "branch") => void;
  onCreateNode: CreateNodeHandler;
  onPopulateNode: PopulateNodeHandler;
  onEditUserMessage: EditUserMessageHandler;
  onRetryAssistantMessage: RetryAssistantMessageHandler;
  onUpdateNodeTitle: UpdateNodeTitleHandler;
  onToggleNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: NodePosition) => void;
  dataDraftWorkspace?: boolean;
  disableNodeCreationActions?: boolean;
  initialWorkspaceSidebarCollapsed?: boolean;
  initialNodeDetailPanelCollapsed?: boolean;
  inlineNodeComposer?: InlineNodeComposerData;
  syncFailure?: {
    message: string;
    onRetry: () => void;
  } | null;
  nodeDetailOptions?: NodeDetailOptions;
  projectNotesConfig?: ProjectNotesConfig;
  canvasIntro?: ReactNode;
  mobileNavigationMode?: "tabs" | "drawers";
};

type SidePanelResizeBoundsOptions = {
  side: ResizableSide;
  gridWidth: number;
  workspaceSidebarWidth: number;
  detailPanelWidth: number;
  projectNotesPanelWidth: number;
  isWorkspaceSidebarCollapsed: boolean;
  isNodeDetailPanelCollapsed: boolean;
  isProjectNotesSidePanelOpen: boolean;
  canShowInlineProjectNotes: boolean;
};

type ProjectNotesPanelResizeBoundsOptions = {
  gridWidth: number;
  workspaceSidebarWidth: number;
  detailPanelWidth: number;
  isWorkspaceSidebarCollapsed: boolean;
};

const mobileWorkspaceTabs: Array<{
  id: MobileWorkspaceView;
  label: string;
  icon: ReactNode;
}> = [
  { id: "map", label: "Map", icon: <MapIcon size={16} /> },
  { id: "outline", label: "Outline", icon: <PanelLeftOpen size={16} /> },
  { id: "chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { id: "notes", label: "Notes", icon: <NotebookPen size={16} /> },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isDesktopForInlineNotes() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function isCompactDesktopForInlineNotes() {
  return window.matchMedia("(min-width: 1024px) and (max-width: 1279px)").matches;
}

function getGridGapCount(includedColumns: boolean[]) {
  const columnCount = includedColumns.filter(Boolean).length;

  return Math.max(0, columnCount - 1);
}

function getSidePanelResizeBounds({
  side,
  gridWidth,
  workspaceSidebarWidth,
  detailPanelWidth,
  projectNotesPanelWidth,
  isWorkspaceSidebarCollapsed,
  isNodeDetailPanelCollapsed,
  isProjectNotesSidePanelOpen,
  canShowInlineProjectNotes,
}: SidePanelResizeBoundsOptions) {
  const isWorkspaceSidebarVisible =
    side === "left" ? true : !isWorkspaceSidebarCollapsed;
  const isNodeDetailPanelVisible =
    side === "right" ? true : !isNodeDetailPanelCollapsed;
  const reserveProjectNotesPanel =
    canShowInlineProjectNotes && isProjectNotesSidePanelOpen && isNodeDetailPanelVisible;
  const gapCount = getGridGapCount([
    isWorkspaceSidebarVisible,
    isWorkspaceSidebarVisible,
    true,
    isNodeDetailPanelVisible,
    isNodeDetailPanelVisible,
    reserveProjectNotesPanel,
    reserveProjectNotesPanel,
  ]);
  const handleWidth =
    (isWorkspaceSidebarVisible ? DESKTOP_RESIZE_HANDLE_WIDTH : 0) +
    (isNodeDetailPanelVisible ? DESKTOP_RESIZE_HANDLE_WIDTH : 0) +
    (reserveProjectNotesPanel ? DESKTOP_RESIZE_HANDLE_WIDTH : 0);
  const occupiedPanelWidth =
    side === "left"
      ? (isNodeDetailPanelVisible ? detailPanelWidth : 0) +
        (reserveProjectNotesPanel ? projectNotesPanelWidth : 0)
      : (isWorkspaceSidebarVisible ? workspaceSidebarWidth : 0) +
        (reserveProjectNotesPanel ? projectNotesPanelWidth : 0);
  const maxWidthForViewport =
    gridWidth -
    occupiedPanelWidth -
    handleWidth -
    DESKTOP_MAP_MIN_WIDTH -
    WORKSPACE_GRID_GAP * gapCount;

  return {
    minWidth: SIDE_PANEL_MIN_WIDTH,
    snapWidth: SIDE_PANEL_SNAP_WIDTH,
    maxWidth: Math.max(SIDE_PANEL_MIN_WIDTH, Math.floor(maxWidthForViewport)),
  };
}

function getProjectNotesPanelResizeBounds({
  gridWidth,
  workspaceSidebarWidth,
  detailPanelWidth,
  isWorkspaceSidebarCollapsed,
}: ProjectNotesPanelResizeBoundsOptions) {
  const isWorkspaceSidebarVisible = !isWorkspaceSidebarCollapsed;
  const gapCount = getGridGapCount([
    isWorkspaceSidebarVisible,
    isWorkspaceSidebarVisible,
    true,
    true,
    true,
    true,
    true,
  ]);
  const handleWidth =
    (isWorkspaceSidebarVisible ? DESKTOP_RESIZE_HANDLE_WIDTH : 0) +
    DESKTOP_RESIZE_HANDLE_WIDTH +
    DESKTOP_RESIZE_HANDLE_WIDTH;
  const maxWidthForViewport =
    gridWidth -
    (isWorkspaceSidebarVisible ? workspaceSidebarWidth : 0) -
    detailPanelWidth -
    handleWidth -
    DESKTOP_MAP_MIN_WIDTH -
    WORKSPACE_GRID_GAP * gapCount;

  return {
    minWidth: PROJECT_NOTES_PANEL_MIN_WIDTH,
    maxWidth: Math.max(
      PROJECT_NOTES_PANEL_MIN_WIDTH,
      Math.min(PROJECT_NOTES_PANEL_MAX_WIDTH, Math.floor(maxWidthForViewport)),
    ),
  };
}

type CanvasCornerToggleButtonProps = {
  side: "left" | "right";
  ariaLabel: string;
  testId: string;
  showOnMobile?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function CanvasCornerToggleButton({
  side,
  ariaLabel,
  testId,
  showOnMobile = false,
  onClick,
  children,
}: CanvasCornerToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded="false"
      data-testid={testId}
      className={`branchmind-canvas-toggle absolute top-4 z-20 h-9 w-9 place-items-center rounded-md border border-neutral-200 bg-white/95 text-neutral-700 shadow-sm backdrop-blur transition hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-200/40 ${
        showOnMobile ? "grid" : "hidden lg:grid"
      } ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      {children}
    </button>
  );
}

export function WorkspaceCanvasShell({
  project,
  selectedNodeId,
  aiError,
  creatingNodeId,
  streamingNodeId,
  streamingMessageId,
  onSelectNode,
  onQuickCreateNode,
  onCreateNode,
  onPopulateNode,
  onEditUserMessage,
  onRetryAssistantMessage,
  onUpdateNodeTitle,
  onToggleNode,
  onDeleteNode,
  onMoveNode,
  dataDraftWorkspace = false,
  disableNodeCreationActions = false,
  initialWorkspaceSidebarCollapsed = false,
  initialNodeDetailPanelCollapsed = false,
  inlineNodeComposer,
  syncFailure = null,
  nodeDetailOptions,
  projectNotesConfig,
  canvasIntro,
  mobileNavigationMode = "tabs",
}: WorkspaceCanvasShellProps) {
  const workspaceGridRef = useRef<HTMLDivElement | null>(null);
  const workspaceSidebarRestoreWidthRef = useRef(WORKSPACE_SIDEBAR_DEFAULT_WIDTH);
  const detailPanelRestoreWidthRef = useRef(DETAIL_PANEL_DEFAULT_WIDTH);
  const autoCollapsedSidebarForNotesRef = useRef(false);
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(
    WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  );
  const [detailPanelWidth, setDetailPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const [projectNotesPanelWidth, setProjectNotesPanelWidth] = useState(
    PROJECT_NOTES_PANEL_DEFAULT_WIDTH,
  );
  const [mobileMapHeight, setMobileMapHeight] = useState(MOBILE_MAP_DEFAULT_HEIGHT);
  const [mobileWorkspaceView, setMobileWorkspaceView] =
    useState<MobileWorkspaceView>(() => (dataDraftWorkspace ? "map" : "chat"));
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(
    initialWorkspaceSidebarCollapsed,
  );
  const [isNodeDetailPanelCollapsed, setIsNodeDetailPanelCollapsed] = useState(
    initialNodeDetailPanelCollapsed,
  );
  const [isProjectNotesPanelOpen, setIsProjectNotesPanelOpen] = useState(false);
  const [canvasIntroPanOffsetY, setCanvasIntroPanOffsetY] = useState(0);

  const usesMobileDrawers = mobileNavigationMode === "drawers";
  const hasProjectNotes = Boolean(projectNotesConfig);
  const selectedNode = selectedNodeId ? project.nodes[selectedNodeId] ?? null : null;
  const selectedConversationMessages = useMemo(
    () =>
      selectedNode
        ? getNodeConversationMessages(project, selectedNode.id)
        : [],
    [project, selectedNode],
  );
  const isSelectedNodeCreating = selectedNode
    ? creatingNodeId === selectedNode.id || streamingNodeId === selectedNode.id
    : false;
  const isProjectNotesSidePanelOpen =
    hasProjectNotes && isProjectNotesPanelOpen && !isNodeDetailPanelCollapsed;
  const isProjectNotesMobileViewOpen =
    hasProjectNotes && mobileWorkspaceView === "notes";
  const shouldShowProjectNotesPanel =
    hasProjectNotes && (isProjectNotesSidePanelOpen || isProjectNotesMobileViewOpen);
  const shouldShowProjectNotesDrawer =
    hasProjectNotes && isProjectNotesSidePanelOpen && !isProjectNotesMobileViewOpen;
  const visibleMobileTabs = hasProjectNotes
    ? mobileWorkspaceTabs
    : mobileWorkspaceTabs.filter((tab) => tab.id !== "notes");
  const desktopGridColumns = [
    !isWorkspaceSidebarCollapsed ? "var(--workspace-sidebar-width)" : null,
    !isWorkspaceSidebarCollapsed ? `${DESKTOP_RESIZE_HANDLE_WIDTH}px` : null,
    `minmax(${DESKTOP_MAP_MIN_WIDTH}px,1fr)`,
    !isNodeDetailPanelCollapsed ? `${DESKTOP_RESIZE_HANDLE_WIDTH}px` : null,
    !isNodeDetailPanelCollapsed ? "var(--detail-panel-width)" : null,
    isProjectNotesSidePanelOpen ? `${DESKTOP_RESIZE_HANDLE_WIDTH}px` : null,
    isProjectNotesSidePanelOpen ? "var(--project-notes-panel-width)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const workspaceGridStyle = {
    "--workspace-sidebar-width": `${workspaceSidebarWidth}px`,
    "--detail-panel-width": `${detailPanelWidth}px`,
    "--project-notes-panel-width": `${projectNotesPanelWidth}px`,
    "--workspace-grid-columns": desktopGridColumns,
    "--mobile-map-height": `${mobileMapHeight}px`,
  } as CSSProperties;
  const canvasIntroStyle = {
    transform: `translate3d(0, ${canvasIntroPanOffsetY}px, 0)`,
  } as CSSProperties;
  const workspaceGridClassName = usesMobileDrawers
    ? "branchmind-workspace-grid branchmind-home-workspace-grid grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden bg-transparent lg:h-full lg:flex-1 lg:grid-cols-[var(--workspace-grid-columns)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:gap-0"
    : [
        "branchmind-workspace-grid grid min-h-0 min-w-0 grid-cols-1 gap-3 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl md:gap-4 lg:h-full lg:flex-1 lg:grid-cols-[var(--workspace-grid-columns)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:gap-0 lg:rounded-none lg:border-0 lg:shadow-none",
        dataDraftWorkspace ? "" : "flex-1",
      ].join(" ");
  const mobileTabsClassName = hasProjectNotes
    ? "branchmind-mobile-tabs grid grid-cols-4 gap-1.5 rounded-[18px] border border-white/80 bg-white/68 p-1.5 shadow-sm sm:gap-2 sm:rounded-[24px] sm:p-2 lg:hidden"
    : "branchmind-mobile-tabs grid grid-cols-3 gap-1.5 rounded-[18px] border border-white/80 bg-white/68 p-1.5 shadow-sm sm:gap-2 sm:rounded-[24px] sm:p-2 lg:hidden";
  const workspaceSidebarMobileClassName = usesMobileDrawers
    ? "branchmind-mobile-drawer branchmind-mobile-drawer-left fixed bottom-2 left-2 top-2 z-40 flex w-[min(86vw,320px)] min-w-0 lg:contents"
    : mobileWorkspaceView === "outline"
      ? "contents"
      : "hidden lg:contents";
  const nodeDetailMobileClassName = usesMobileDrawers
    ? "branchmind-mobile-drawer branchmind-mobile-drawer-right fixed bottom-2 right-2 top-2 z-40 flex w-[min(88vw,360px)] min-w-0 lg:contents"
    : mobileWorkspaceView === "chat"
      ? "h-[calc(100svh-9.75rem)] min-h-0 min-w-0 overflow-hidden sm:h-[calc(100svh-12rem)] lg:contents"
      : "hidden lg:contents";
  const mapShellClassName = usesMobileDrawers
    ? "branchmind-map-shell relative h-full min-h-0 overflow-hidden bg-surface-canvas lg:h-full lg:min-h-0"
    : `branchmind-map-shell relative h-[min(var(--mobile-map-height),calc(100svh-7rem))] min-h-[300px] overflow-hidden rounded-lg border border-neutral-200 bg-surface-canvas shadow-sm lg:h-full lg:min-h-0 lg:rounded-none lg:border-0 lg:shadow-none ${
        mobileWorkspaceView === "map" ? "" : "hidden lg:block"
      }`;
  const canvasIntroClassName = usesMobileDrawers
    ? "branchmind-canvas-intro branchmind-canvas-intro-floating pointer-events-none absolute inset-x-14 top-16 z-10 flex justify-center px-0 lg:inset-x-4 lg:top-24"
    : "branchmind-canvas-intro relative z-10 flex justify-center px-3 pt-4 sm:px-4 sm:pt-6 lg:pointer-events-none lg:absolute lg:inset-x-4 lg:top-24 lg:p-0";
  const mindMapFrameClassName =
    canvasIntro && !usesMobileDrawers
      ? "h-[calc(100%-6.5rem)] sm:h-[calc(100%-7.75rem)] lg:h-full"
      : "h-full";

  const getWorkspaceGridWidth = useCallback(() => {
    return workspaceGridRef.current?.clientWidth ?? 0;
  }, []);

  const getSideBounds = useCallback(
    (side: ResizableSide, gridWidth = getWorkspaceGridWidth()) => {
      return getSidePanelResizeBounds({
        side,
        gridWidth,
        workspaceSidebarWidth,
        detailPanelWidth,
        projectNotesPanelWidth,
        isWorkspaceSidebarCollapsed,
        isNodeDetailPanelCollapsed,
        isProjectNotesSidePanelOpen,
        canShowInlineProjectNotes: isDesktopForInlineNotes(),
      });
    },
    [
      detailPanelWidth,
      getWorkspaceGridWidth,
      isNodeDetailPanelCollapsed,
      isProjectNotesSidePanelOpen,
      isWorkspaceSidebarCollapsed,
      projectNotesPanelWidth,
      workspaceSidebarWidth,
    ],
  );

  const clampWorkspacePanels = useCallback(
    (gridWidth = getWorkspaceGridWidth()) => {
      if (!gridWidth || window.matchMedia("(max-width: 1023px)").matches) return;

      const canShowInlineProjectNotes = isDesktopForInlineNotes();
      let nextWorkspaceSidebarWidth = workspaceSidebarWidth;
      let nextDetailPanelWidth = detailPanelWidth;
      let nextProjectNotesPanelWidth = projectNotesPanelWidth;

      if (!isWorkspaceSidebarCollapsed) {
        const bounds = getSidePanelResizeBounds({
          side: "left",
          gridWidth,
          workspaceSidebarWidth: nextWorkspaceSidebarWidth,
          detailPanelWidth: nextDetailPanelWidth,
          projectNotesPanelWidth: nextProjectNotesPanelWidth,
          isWorkspaceSidebarCollapsed,
          isNodeDetailPanelCollapsed,
          isProjectNotesSidePanelOpen,
          canShowInlineProjectNotes,
        });
        nextWorkspaceSidebarWidth = clamp(
          nextWorkspaceSidebarWidth,
          bounds.minWidth,
          bounds.maxWidth,
        );
      }

      if (!isNodeDetailPanelCollapsed) {
        const bounds = getSidePanelResizeBounds({
          side: "right",
          gridWidth,
          workspaceSidebarWidth: nextWorkspaceSidebarWidth,
          detailPanelWidth: nextDetailPanelWidth,
          projectNotesPanelWidth: nextProjectNotesPanelWidth,
          isWorkspaceSidebarCollapsed,
          isNodeDetailPanelCollapsed,
          isProjectNotesSidePanelOpen,
          canShowInlineProjectNotes,
        });
        nextDetailPanelWidth = clamp(nextDetailPanelWidth, bounds.minWidth, bounds.maxWidth);
      }

      if (canShowInlineProjectNotes && isProjectNotesSidePanelOpen) {
        const bounds = getProjectNotesPanelResizeBounds({
          gridWidth,
          workspaceSidebarWidth: nextWorkspaceSidebarWidth,
          detailPanelWidth: nextDetailPanelWidth,
          isWorkspaceSidebarCollapsed,
        });
        nextProjectNotesPanelWidth = clamp(
          nextProjectNotesPanelWidth,
          bounds.minWidth,
          bounds.maxWidth,
        );
      }

      if (nextWorkspaceSidebarWidth !== workspaceSidebarWidth) {
        setWorkspaceSidebarWidth(nextWorkspaceSidebarWidth);
      }
      if (nextDetailPanelWidth !== detailPanelWidth) {
        setDetailPanelWidth(nextDetailPanelWidth);
      }
      if (nextProjectNotesPanelWidth !== projectNotesPanelWidth) {
        setProjectNotesPanelWidth(nextProjectNotesPanelWidth);
      }
    },
    [
      detailPanelWidth,
      getWorkspaceGridWidth,
      isNodeDetailPanelCollapsed,
      isProjectNotesSidePanelOpen,
      isWorkspaceSidebarCollapsed,
      projectNotesPanelWidth,
      workspaceSidebarWidth,
    ],
  );

  const restoreAutoCollapsedSidebarForNotes = useCallback(() => {
    if (!autoCollapsedSidebarForNotesRef.current) return;

    autoCollapsedSidebarForNotesRef.current = false;
    setWorkspaceSidebarWidth(workspaceSidebarRestoreWidthRef.current);
    setIsWorkspaceSidebarCollapsed(false);
  }, []);

  const autoCollapseSidebarForNotesIfNeeded = useCallback(() => {
    if (isWorkspaceSidebarCollapsed || !isCompactDesktopForInlineNotes()) return;

    workspaceSidebarRestoreWidthRef.current = workspaceSidebarWidth;
    autoCollapsedSidebarForNotesRef.current = true;
    setIsWorkspaceSidebarCollapsed(true);
  }, [isWorkspaceSidebarCollapsed, workspaceSidebarWidth]);

  const handleCollapseWorkspaceSidebar = useCallback(() => {
    autoCollapsedSidebarForNotesRef.current = false;
    workspaceSidebarRestoreWidthRef.current = workspaceSidebarWidth;
    setIsWorkspaceSidebarCollapsed(true);
  }, [workspaceSidebarWidth]);

  const handleExpandWorkspaceSidebar = useCallback(() => {
    autoCollapsedSidebarForNotesRef.current = false;
    const bounds = getSideBounds("left");
    setWorkspaceSidebarWidth(
      clamp(workspaceSidebarRestoreWidthRef.current, bounds.minWidth, bounds.maxWidth),
    );
    setIsWorkspaceSidebarCollapsed(false);
  }, [getSideBounds]);

  const handleCollapseNodeDetailPanel = useCallback(() => {
    detailPanelRestoreWidthRef.current = detailPanelWidth;
    setIsNodeDetailPanelCollapsed(true);
    setIsProjectNotesPanelOpen(false);
    restoreAutoCollapsedSidebarForNotes();
  }, [detailPanelWidth, restoreAutoCollapsedSidebarForNotes]);

  const handleExpandNodeDetailPanel = useCallback(() => {
    const bounds = getSideBounds("right");
    setDetailPanelWidth(
      clamp(detailPanelRestoreWidthRef.current, bounds.minWidth, bounds.maxWidth),
    );
    setIsNodeDetailPanelCollapsed(false);
  }, [getSideBounds]);

  const handleToggleProjectNotesPanel = useCallback(() => {
    if (!hasProjectNotes) return;

    if (window.matchMedia("(max-width: 1023px)").matches) {
      setIsProjectNotesPanelOpen(false);
      restoreAutoCollapsedSidebarForNotes();
      setMobileWorkspaceView((current) => (current === "notes" ? "chat" : "notes"));
      return;
    }

    if (isProjectNotesPanelOpen) {
      setIsProjectNotesPanelOpen(false);
      restoreAutoCollapsedSidebarForNotes();
      return;
    }

    autoCollapseSidebarForNotesIfNeeded();
    setIsProjectNotesPanelOpen(true);
  }, [
    autoCollapseSidebarForNotesIfNeeded,
    hasProjectNotes,
    isProjectNotesPanelOpen,
    restoreAutoCollapsedSidebarForNotes,
  ]);

  const handleCloseProjectNotesPanel = useCallback(() => {
    setIsProjectNotesPanelOpen(false);
    setMobileWorkspaceView((current) => (current === "notes" ? "chat" : current));
    restoreAutoCollapsedSidebarForNotes();
  }, [restoreAutoCollapsedSidebarForNotes]);

  const handleSelectMobileWorkspaceView = useCallback(
    (view: MobileWorkspaceView) => {
      if (view === "notes" && !hasProjectNotes) return;
      setMobileWorkspaceView(view);
      if (view === "notes") {
        setIsProjectNotesPanelOpen(false);
        restoreAutoCollapsedSidebarForNotes();
      }
    },
    [hasProjectNotes, restoreAutoCollapsedSidebarForNotes],
  );

  const handleSelectNodeFromOutline = useCallback(
    (nodeId: string) => {
      onSelectNode(nodeId);
      if (
        usesMobileDrawers &&
        window.matchMedia("(max-width: 1023px)").matches
      ) {
        setIsWorkspaceSidebarCollapsed(true);
        setIsNodeDetailPanelCollapsed(false);
        return;
      }
      setMobileWorkspaceView("chat");
    },
    [onSelectNode, usesMobileDrawers],
  );

  const handleCloseMobileDrawers = useCallback(() => {
    if (isWorkspaceSidebarCollapsed && isNodeDetailPanelCollapsed) return;
    if (!isWorkspaceSidebarCollapsed) handleCollapseWorkspaceSidebar();
    if (!isNodeDetailPanelCollapsed) handleCollapseNodeDetailPanel();
  }, [
    handleCollapseNodeDetailPanel,
    handleCollapseWorkspaceSidebar,
    isNodeDetailPanelCollapsed,
    isWorkspaceSidebarCollapsed,
  ]);

  const handleSidePanelResizeStart = useCallback((side: ResizableSide, event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";

    const startX = event.clientX;
    const startWidth = side === "left" ? workspaceSidebarWidth : detailPanelWidth;
    const gridWidth =
      event.currentTarget.parentElement?.parentElement?.clientWidth ??
      getWorkspaceGridWidth();
    const bounds = getSidePanelResizeBounds({
      side,
      gridWidth,
      workspaceSidebarWidth,
      detailPanelWidth,
      projectNotesPanelWidth,
      isWorkspaceSidebarCollapsed,
      isNodeDetailPanelCollapsed,
      isProjectNotesSidePanelOpen,
      canShowInlineProjectNotes: isDesktopForInlineNotes(),
    });
    const restoreWidthRef =
      side === "left" ? workspaceSidebarRestoreWidthRef : detailPanelRestoreWidthRef;

    function resizeTo(clientX: number) {
      const deltaX = side === "left" ? clientX - startX : startX - clientX;
      const rawWidth = startWidth + deltaX;

      if (rawWidth < bounds.snapWidth) {
        restoreWidthRef.current = startWidth;
        if (side === "left") {
          setIsWorkspaceSidebarCollapsed(true);
        } else {
          setIsNodeDetailPanelCollapsed(true);
          setIsProjectNotesPanelOpen(false);
        }
        return;
      }

      const nextWidth = clamp(rawWidth, bounds.minWidth, bounds.maxWidth);
      if (side === "left") {
        setWorkspaceSidebarWidth(nextWidth);
        if (rawWidth >= bounds.minWidth) setIsWorkspaceSidebarCollapsed(false);
      } else {
        setDetailPanelWidth(nextWidth);
        if (rawWidth >= bounds.minWidth) setIsNodeDetailPanelCollapsed(false);
      }
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      resizeTo(moveEvent.clientX);
    }

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      resizeTo(moveEvent.clientX);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    if (isPointerResize) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    } else {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp, { once: true });
    }
  }, [
    detailPanelWidth,
    getWorkspaceGridWidth,
    isNodeDetailPanelCollapsed,
    isProjectNotesSidePanelOpen,
    isWorkspaceSidebarCollapsed,
    projectNotesPanelWidth,
    workspaceSidebarWidth,
  ]);

  const handleWorkspaceSidebarResizeStart = useCallback(
    (event: ResizeStartEvent) => handleSidePanelResizeStart("left", event),
    [handleSidePanelResizeStart],
  );

  const handlePanelResizeStart = useCallback(
    (event: ResizeStartEvent) => handleSidePanelResizeStart("right", event),
    [handleSidePanelResizeStart],
  );

  const handleProjectNotesPanelResizeStart = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";

    const startX = event.clientX;
    const startWidth = projectNotesPanelWidth;
    const gridWidth = event.currentTarget.parentElement?.parentElement?.clientWidth ?? 0;
    const bounds = getProjectNotesPanelResizeBounds({
      gridWidth,
      workspaceSidebarWidth,
      detailPanelWidth,
      isWorkspaceSidebarCollapsed,
    });

    function resizeTo(clientX: number) {
      const deltaX = startX - clientX;
      setProjectNotesPanelWidth(
        clamp(startWidth + deltaX, bounds.minWidth, bounds.maxWidth),
      );
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      resizeTo(moveEvent.clientX);
    }

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      resizeTo(moveEvent.clientX);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    if (isPointerResize) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    } else {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp, { once: true });
    }
  }, [
    detailPanelWidth,
    isWorkspaceSidebarCollapsed,
    projectNotesPanelWidth,
    workspaceSidebarWidth,
  ]);

  const handleMapResizeStart = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";

    const startY = event.clientY;
    const startHeight = mobileMapHeight;
    const maxHeight = Math.max(MOBILE_MAP_MIN_HEIGHT, window.innerHeight - 220);

    function resizeTo(clientY: number) {
      const deltaY = clientY - startY;
      setMobileMapHeight(clamp(startHeight + deltaY, MOBILE_MAP_MIN_HEIGHT, maxHeight));
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      resizeTo(moveEvent.clientY);
    }

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      resizeTo(moveEvent.clientY);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    if (isPointerResize) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    } else {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp, { once: true });
    }
  }, [mobileMapHeight]);

  useEffect(() => {
    if (canvasIntro) return;
    setCanvasIntroPanOffsetY(0);
  }, [canvasIntro]);

  useEffect(() => {
    if (!hasProjectNotes && mobileWorkspaceView === "notes") {
      setMobileWorkspaceView("chat");
      restoreAutoCollapsedSidebarForNotes();
    }
  }, [hasProjectNotes, mobileWorkspaceView, restoreAutoCollapsedSidebarForNotes]);

  useEffect(() => {
    if (!isProjectNotesPanelOpen) return undefined;

    function syncSidebarForInlineNotes() {
      if (isCompactDesktopForInlineNotes()) {
        if (!isWorkspaceSidebarCollapsed) {
          workspaceSidebarRestoreWidthRef.current = workspaceSidebarWidth;
          autoCollapsedSidebarForNotesRef.current = true;
          setIsWorkspaceSidebarCollapsed(true);
        }
        return;
      }

      restoreAutoCollapsedSidebarForNotes();
    }

    syncSidebarForInlineNotes();
    window.addEventListener("resize", syncSidebarForInlineNotes);

    return () => window.removeEventListener("resize", syncSidebarForInlineNotes);
  }, [
    isProjectNotesPanelOpen,
    isWorkspaceSidebarCollapsed,
    restoreAutoCollapsedSidebarForNotes,
    workspaceSidebarWidth,
  ]);

  useEffect(() => {
    if (!isProjectNotesPanelOpen) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleCloseProjectNotesPanel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseProjectNotesPanel, isProjectNotesPanelOpen]);

  useEffect(() => {
    const grid = workspaceGridRef.current;
    if (!grid) return undefined;

    let animationFrame = 0;
    const scheduleClamp = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        clampWorkspacePanels(grid.clientWidth);
      });
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleClamp);

    scheduleClamp();
    observer?.observe(grid);
    window.addEventListener("resize", scheduleClamp);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleClamp);
    };
  }, [clampWorkspacePanels]);

  return (
    <main
      aria-labelledby="workspace-title"
      data-testid="workspace-shell"
      data-draft-workspace={dataDraftWorkspace ? "true" : undefined}
      className="branchmind-workspace-surface relative flex min-h-[100svh] flex-col bg-surface-bg p-2 text-neutral-900 sm:p-3 lg:h-[100dvh] lg:min-h-[640px] lg:overflow-hidden lg:p-0"
    >
      <h1 id="workspace-title" className="sr-only">
        {project.title}
      </h1>

      {aiError && !selectedNode && (
        <p
          role="alert"
          data-testid="workspace-error-alert"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-700"
        >
          {aiError}
        </p>
      )}

      {syncFailure && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="project-sync-status"
          data-status="failed"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-700"
        >
          <span>{syncFailure.message}</span>
          <button
            type="button"
            data-testid="retry-project-sync-button"
            onClick={syncFailure.onRetry}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-white px-3 text-xs font-black text-danger-700 transition hover:bg-danger-50"
          >
            <RefreshCcw size={15} />
            Retry
          </button>
        </div>
      )}

      {usesMobileDrawers &&
        (!isWorkspaceSidebarCollapsed || !isNodeDetailPanelCollapsed) && (
          <button
            type="button"
            aria-label="Close side panels"
            data-testid="mobile-drawer-backdrop"
            onClick={handleCloseMobileDrawers}
            className="fixed inset-0 z-30 bg-neutral-900/20 backdrop-blur-[1px] lg:hidden"
          />
        )}

      {!usesMobileDrawers && (
        <div
          role="tablist"
          aria-label="Workspace mobile views"
          data-testid="workspace-mobile-view-tabs"
          className={mobileTabsClassName}
        >
          {visibleMobileTabs.map((tab) => {
            const selected = mobileWorkspaceView === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`workspace-mobile-view-${tab.id}`}
                onClick={() => handleSelectMobileWorkspaceView(tab.id)}
                className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-xl text-[11px] font-black transition focus:outline-none focus:ring-2 focus:ring-brand-300 sm:min-h-11 sm:gap-1.5 sm:text-xs ${
                  selected
                    ? "bg-brand-600 text-white shadow-md shadow-brand-200/30"
                    : "bg-white/80 text-neutral-700 hover:bg-white"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={workspaceGridRef}
        className={workspaceGridClassName}
        style={workspaceGridStyle}
      >
        {!isWorkspaceSidebarCollapsed && (
          <div className={workspaceSidebarMobileClassName}>
            <WorkspaceSidebar
              footer={<AuthPanel placement="top" variant="sidebar" className="w-full" />}
              project={project}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNodeFromOutline}
              onCollapse={handleCollapseWorkspaceSidebar}
            />
          </div>
        )}
        {!isWorkspaceSidebarCollapsed && (
          <WorkspaceResizeHandle
            orientation="vertical"
            ariaLabel="Resize workspace sidebar"
            testId="resize-workspace-sidebar"
            onResizeStart={handleWorkspaceSidebarResizeStart}
          />
        )}
        <section
          aria-labelledby="mind-map-section-title"
          data-testid="mind-map-canvas"
          className={mapShellClassName}
        >
          <h2 id="mind-map-section-title" className="sr-only">
            Mind map canvas
          </h2>
          {canvasIntro && (
            <div
              className={canvasIntroClassName}
              style={canvasIntroStyle}
            >
              {canvasIntro}
            </div>
          )}
          {isWorkspaceSidebarCollapsed && (
            <CanvasCornerToggleButton
              side="left"
              ariaLabel="Expand workspace sidebar"
              testId="expand-workspace-sidebar-button"
              showOnMobile={usesMobileDrawers}
              onClick={handleExpandWorkspaceSidebar}
            >
              <PanelLeftOpen size={18} />
            </CanvasCornerToggleButton>
          )}
          {isNodeDetailPanelCollapsed && (
            <CanvasCornerToggleButton
              side="right"
              ariaLabel="Expand node details panel"
              testId="expand-node-detail-panel-button"
              showOnMobile={usesMobileDrawers}
              onClick={handleExpandNodeDetailPanel}
            >
              <PanelRightOpen size={18} />
            </CanvasCornerToggleButton>
          )}
          <div className={mindMapFrameClassName}>
            <MindMap
              project={project}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              onCreateNode={onQuickCreateNode}
              onToggleNode={onToggleNode}
              onMoveNode={onMoveNode}
              creatingNodeId={
                disableNodeCreationActions ? project.rootNodeId : creatingNodeId
              }
              streamingNodeId={streamingNodeId}
              inlineNodeComposer={inlineNodeComposer}
              onHomeCanvasPanOffsetChange={
                canvasIntro ? setCanvasIntroPanOffsetY : undefined
              }
            />
          </div>
        </section>
        {!isNodeDetailPanelCollapsed && (
          <WorkspaceResizeHandle
            orientation="vertical"
            ariaLabel="Resize node details panel"
            testId="resize-node-details-panel"
            onResizeStart={handlePanelResizeStart}
          />
        )}
        {!usesMobileDrawers && mobileWorkspaceView === "map" && (
          <WorkspaceResizeHandle
            orientation="horizontal"
            ariaLabel="Resize mind map height"
            testId="resize-mind-map-height"
            onResizeStart={handleMapResizeStart}
          />
        )}
        {!isNodeDetailPanelCollapsed && (
          <div className={nodeDetailMobileClassName}>
            <NodeDetailPanel
              node={selectedNode}
              conversationMessages={selectedConversationMessages}
              onCreateNode={onCreateNode}
              onPopulateNode={onPopulateNode}
              onEditUserMessage={onEditUserMessage}
              onRetryAssistantMessage={onRetryAssistantMessage}
              onUpdateNodeTitle={onUpdateNodeTitle}
              onToggleNode={onToggleNode}
              onDeleteNode={onDeleteNode}
              isCreating={isSelectedNodeCreating}
              streamingMessageId={streamingMessageId}
              isNotesOpen={isProjectNotesSidePanelOpen || isProjectNotesMobileViewOpen}
              error={aiError}
              onToggleNotes={handleToggleProjectNotesPanel}
              onCollapse={handleCollapseNodeDetailPanel}
              initialSubmit={nodeDetailOptions?.initialSubmit}
              onStartProject={nodeDetailOptions?.onStartProject}
              showNotesAction={
                hasProjectNotes && (nodeDetailOptions?.showNotesAction ?? true)
              }
              showCollapseButton={nodeDetailOptions?.showCollapseButton ?? true}
              showComposer={inlineNodeComposer?.nodeId !== selectedNode?.id}
              composerPlaceholder={nodeDetailOptions?.composerPlaceholder}
              submitLabel={nodeDetailOptions?.submitLabel}
            />
          </div>
        )}
        {shouldShowProjectNotesDrawer && (
          <WorkspaceResizeHandle
            orientation="vertical"
            ariaLabel="Resize project notes panel"
            testId="resize-project-notes-panel"
            onResizeStart={handleProjectNotesPanelResizeStart}
          />
        )}
        {shouldShowProjectNotesPanel && projectNotesConfig && (
          <div
            data-testid="project-notes-window"
            className={
              isProjectNotesMobileViewOpen
                ? "h-[calc(100svh-9.75rem)] max-h-[calc(100svh-9.75rem)] min-h-0 min-w-0 overflow-hidden sm:h-[calc(100svh-12rem)] sm:max-h-[calc(100svh-12rem)] lg:relative lg:inset-auto lg:z-auto lg:h-full lg:max-h-full lg:w-full lg:max-w-none"
                : "fixed bottom-3 right-3 top-3 z-40 flex min-h-0 w-[calc(100vw-24px)] max-w-[420px] min-w-0 overflow-hidden lg:relative lg:inset-auto lg:z-auto lg:h-full lg:max-h-full lg:w-full lg:max-w-none"
            }
          >
            <ProjectNotesPanel
              projectId={project.id}
              projectTitle={project.title}
              projectNotes={projectNotesConfig.projectNotes}
              node={selectedNode}
              isCreating={isSelectedNodeCreating}
              onUpdateProjectNotes={projectNotesConfig.onUpdateProjectNotes}
              onClose={handleCloseProjectNotesPanel}
            />
          </div>
        )}
      </div>
    </main>
  );
}
