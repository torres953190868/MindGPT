"use client";

import Link from "next/link";
import {
  Brain,
  Folder,
  Grid2X2,
  Map as MapIcon,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  PanelLeftOpen,
  PanelRightOpen,
  RefreshCcw,
  Star,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AuthPanel } from "@/components/AuthPanel";
import type {
  ChatAttachment,
  ChatModelSelection,
  NodePosition,
  Project,
} from "@/lib/types";
import { MindMap } from "./MindMap";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
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
const MOBILE_MAP_DEFAULT_HEIGHT = 520;
const MOBILE_MAP_MIN_HEIGHT = 320;

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
  onSelectNode: (nodeId: string) => void;
  onQuickCreateNode: (nodeId: string, mode: "continue" | "branch") => void;
  onCreateNode: CreateNodeHandler;
  onEditUserMessage: EditUserMessageHandler;
  onRetryAssistantMessage: RetryAssistantMessageHandler;
  onUpdateNodeTitle: UpdateNodeTitleHandler;
  onToggleNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: NodePosition) => void;
  dataDraftWorkspace?: boolean;
  disableNodeCreationActions?: boolean;
  showProjectStar?: boolean;
  syncFailure?: {
    message: string;
    onRetry: () => void;
  } | null;
  nodeDetailOptions?: NodeDetailOptions;
  projectNotesConfig?: ProjectNotesConfig;
};

type WorkspaceResizeHandleProps = {
  orientation: "vertical" | "horizontal";
  desktopBreakpoint?: "lg" | "xl";
  ariaLabel: string;
  testId: string;
  onResizeStart: (event: ResizeStartEvent) => void;
};

type ResizeStartEvent = PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>;

type SidePanelResizeBoundsOptions = {
  side: ResizableSide;
  gridWidth: number;
  workspaceSidebarWidth: number;
  detailPanelWidth: number;
  projectNotesPanelWidth: number;
  isWorkspaceSidebarCollapsed: boolean;
  isNodeDetailPanelCollapsed: boolean;
  isProjectNotesSidePanelOpen: boolean;
  isWideLayout: boolean;
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
  isWideLayout,
}: SidePanelResizeBoundsOptions) {
  const isWorkspaceSidebarVisible =
    side === "left" ? true : !isWorkspaceSidebarCollapsed;
  const isNodeDetailPanelVisible =
    side === "right" ? true : !isNodeDetailPanelCollapsed;
  const reserveProjectNotesPanel =
    isWideLayout && isProjectNotesSidePanelOpen && isNodeDetailPanelVisible;
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

function getResizeInputMode(event: ResizeStartEvent) {
  if (!("pointerId" in event)) return "mouse";

  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Programmatic pointer events can be non-captureable.
  }

  return "pointer";
}

function WorkspaceResizeHandle({
  orientation,
  desktopBreakpoint = "lg",
  ariaLabel,
  testId,
  onResizeStart,
}: WorkspaceResizeHandleProps) {
  const isVertical = orientation === "vertical";
  const lastPointerStartAtRef = useRef(-Infinity);
  const verticalClassName =
    desktopBreakpoint === "xl"
      ? "hidden cursor-col-resize xl:block"
      : "hidden cursor-col-resize lg:block";

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    lastPointerStartAtRef.current = event.timeStamp;
    onResizeStart(event);
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.timeStamp - lastPointerStartAtRef.current < 100) return;
    onResizeStart(event);
  };

  return (
    <div
      className={`relative ${
        isVertical ? `${verticalClassName} bg-[#fcfbfd]` : "h-6 cursor-row-resize lg:hidden"
      }`}
    >
      {!isVertical && (
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-[#e9e5f0]" />
      )}
      <button
        type="button"
        role="separator"
        aria-label={ariaLabel}
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        className={`group absolute grid place-items-center border border-transparent bg-transparent transition hover:bg-[#f6f3fb] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40 ${
          isVertical
            ? "left-0 top-0 h-full w-full cursor-col-resize"
            : "left-1/2 top-1/2 h-8 w-24 -translate-x-1/2 -translate-y-1/2 cursor-row-resize rounded-md"
        }`}
      >
        <span
          className={`rounded-full bg-[#9a83bf] opacity-0 transition group-hover:opacity-80 ${
            isVertical ? "h-10 w-0.5" : "h-0.5 w-8"
          }`}
        />
      </button>
    </div>
  );
}

type CanvasCornerToggleButtonProps = {
  side: "left" | "right";
  ariaLabel: string;
  testId: string;
  onClick: () => void;
  children: ReactNode;
};

function CanvasCornerToggleButton({
  side,
  ariaLabel,
  testId,
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
      className={`absolute top-4 z-20 grid h-9 w-9 place-items-center rounded-md border border-[#e6e1ef] bg-white/95 text-[#625073] shadow-sm backdrop-blur transition hover:bg-[#f7f3fb] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40 ${
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
  onSelectNode,
  onQuickCreateNode,
  onCreateNode,
  onEditUserMessage,
  onRetryAssistantMessage,
  onUpdateNodeTitle,
  onToggleNode,
  onDeleteNode,
  onMoveNode,
  dataDraftWorkspace = false,
  disableNodeCreationActions = false,
  showProjectStar = true,
  syncFailure = null,
  nodeDetailOptions,
  projectNotesConfig,
}: WorkspaceCanvasShellProps) {
  const workspaceGridRef = useRef<HTMLDivElement | null>(null);
  const workspaceSidebarRestoreWidthRef = useRef(WORKSPACE_SIDEBAR_DEFAULT_WIDTH);
  const detailPanelRestoreWidthRef = useRef(DETAIL_PANEL_DEFAULT_WIDTH);
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(
    WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  );
  const [detailPanelWidth, setDetailPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const [projectNotesPanelWidth, setProjectNotesPanelWidth] = useState(
    PROJECT_NOTES_PANEL_DEFAULT_WIDTH,
  );
  const [mobileMapHeight, setMobileMapHeight] = useState(MOBILE_MAP_DEFAULT_HEIGHT);
  const [mobileWorkspaceView, setMobileWorkspaceView] =
    useState<MobileWorkspaceView>("map");
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(false);
  const [isNodeDetailPanelCollapsed, setIsNodeDetailPanelCollapsed] = useState(false);
  const [isProjectNotesPanelOpen, setIsProjectNotesPanelOpen] = useState(false);

  const hasProjectNotes = Boolean(projectNotesConfig);
  const selectedNode = selectedNodeId ? project.nodes[selectedNodeId] ?? null : null;
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
  ]
    .filter(Boolean)
    .join(" ");
  const wideGridColumns = [
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
    "--workspace-wide-grid-columns": wideGridColumns,
    "--mobile-map-height": `${mobileMapHeight}px`,
  } as CSSProperties;
  const workspaceGridClassName =
    "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden rounded-b-xl border border-t-0 border-[#e5e1ec] bg-white shadow-[0_18px_60px_rgba(44,35,62,0.08)] lg:h-full lg:grid-cols-[var(--workspace-grid-columns)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:gap-0 xl:grid-cols-[var(--workspace-wide-grid-columns)]";
  const mobileTabsClassName = hasProjectNotes
    ? "grid grid-cols-4 gap-2 rounded-[24px] border border-white/80 bg-white/68 p-2 shadow-sm lg:hidden"
    : "grid grid-cols-3 gap-2 rounded-[24px] border border-white/80 bg-white/68 p-2 shadow-sm lg:hidden";

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
        isWideLayout: window.matchMedia("(min-width: 1280px)").matches,
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

      const isWideLayout = window.matchMedia("(min-width: 1280px)").matches;
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
          isWideLayout,
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
          isWideLayout,
        });
        nextDetailPanelWidth = clamp(nextDetailPanelWidth, bounds.minWidth, bounds.maxWidth);
      }

      if (isWideLayout && isProjectNotesSidePanelOpen) {
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

  const handleCollapseWorkspaceSidebar = useCallback(() => {
    workspaceSidebarRestoreWidthRef.current = workspaceSidebarWidth;
    setIsWorkspaceSidebarCollapsed(true);
  }, [workspaceSidebarWidth]);

  const handleExpandWorkspaceSidebar = useCallback(() => {
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
  }, [detailPanelWidth]);

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
      setMobileWorkspaceView((current) => (current === "notes" ? "chat" : "notes"));
      return;
    }

    setIsProjectNotesPanelOpen((isOpen) => !isOpen);
  }, [hasProjectNotes]);

  const handleCloseProjectNotesPanel = useCallback(() => {
    setIsProjectNotesPanelOpen(false);
    setMobileWorkspaceView((current) => (current === "notes" ? "chat" : current));
  }, []);

  const handleSelectMobileWorkspaceView = useCallback(
    (view: MobileWorkspaceView) => {
      if (view === "notes" && !hasProjectNotes) return;
      setMobileWorkspaceView(view);
      if (view === "notes") setIsProjectNotesPanelOpen(false);
    },
    [hasProjectNotes],
  );

  const handleSelectNodeFromOutline = useCallback(
    (nodeId: string) => {
      onSelectNode(nodeId);
      setMobileWorkspaceView("chat");
    },
    [onSelectNode],
  );

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
      isWideLayout: window.matchMedia("(min-width: 1280px)").matches,
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
    const maxHeight = Math.max(MOBILE_MAP_MIN_HEIGHT, window.innerHeight - 260);

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
    if (!hasProjectNotes && mobileWorkspaceView === "notes") {
      setMobileWorkspaceView("chat");
    }
  }, [hasProjectNotes, mobileWorkspaceView]);

  useEffect(() => {
    if (!isProjectNotesPanelOpen) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProjectNotesPanelOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isProjectNotesPanelOpen]);

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
      className="branchmind-workspace-surface flex min-h-screen flex-col p-3 text-[#272033] lg:h-screen lg:min-h-[720px] lg:overflow-hidden lg:p-4"
    >
      <header
        aria-label="Workspace header"
        data-testid="workspace-header"
        className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-t-xl border border-[#e5e1ec] bg-white/92 px-4 py-2 shadow-[0_10px_35px_rgba(44,35,62,0.06)] backdrop-blur lg:flex-nowrap lg:px-5"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex shrink-0 items-center gap-2 border-r border-[#e7e3ed] pr-4">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-[#dcd5eb] bg-[#f5f1fb] text-[#7658b3]">
              <Brain size={18} />
            </span>
            <span className="text-base font-extrabold text-[#201a2d]">BranchMind</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <h1
              id="workspace-title"
              className="line-clamp-1 text-sm font-extrabold text-[#241d30] sm:text-base"
            >
              {project.title}
            </h1>
            {showProjectStar && (
              <button
                type="button"
                aria-label="Star project"
                className="hidden h-8 w-8 shrink-0 place-items-center rounded-md text-[#6f647b] transition hover:bg-[#f7f4fb] hover:text-[#6d4ead] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40 sm:grid"
              >
                <Star size={16} />
              </button>
            )}
          </div>
        </div>
        <nav
          aria-label="Workspace navigation"
          data-testid="workspace-navigation"
          className="flex w-full min-w-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto"
        >
          <Link
            href="/projects"
            aria-label="Project list"
            data-testid="workspace-projects-link"
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-bold text-[#3f3650] transition hover:bg-[#f4f1f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
          >
            <Folder size={16} />
            Projects
          </Link>
          <button
            type="button"
            aria-label="Workspace grid"
            className="grid h-9 w-9 place-items-center rounded-md text-[#665b73] transition hover:bg-[#f4f1f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
          >
            <Grid2X2 size={16} />
          </button>
          <button
            type="button"
            aria-label="More workspace actions"
            className="grid h-9 w-9 place-items-center rounded-md text-[#665b73] transition hover:bg-[#f4f1f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
          >
            <MoreHorizontal size={17} />
          </button>
        </nav>
      </header>

      {aiError && !selectedNode && (
        <p
          role="alert"
          data-testid="workspace-error-alert"
          className="rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
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
          className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
        >
          <span>{syncFailure.message}</span>
          <button
            type="button"
            data-testid="retry-project-sync-button"
            onClick={syncFailure.onRetry}
            className="inline-flex min-h-9 items-center gap-2 rounded-[14px] bg-white/80 px-3 text-xs font-black text-[#7a3e3a] transition hover:bg-white"
          >
            <RefreshCcw size={15} />
            Retry
          </button>
        </div>
      )}

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
              className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[16px] text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-[#eadcf7] ${
                selected
                  ? "bg-[#7c5fb1] text-white shadow-md shadow-[#b99adb]/25"
                  : "bg-white/72 text-[#62546b] hover:bg-white"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div
        ref={workspaceGridRef}
        className={workspaceGridClassName}
        style={workspaceGridStyle}
      >
        {!isWorkspaceSidebarCollapsed && (
          <div className={mobileWorkspaceView === "outline" ? "contents" : "hidden lg:contents"}>
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
          className={`relative h-[var(--mobile-map-height)] overflow-hidden rounded-lg border border-[#e5e1ec] bg-[#fcfbfd] shadow-sm lg:h-full lg:min-h-0 lg:rounded-none lg:border-0 lg:shadow-none ${
            mobileWorkspaceView === "map" ? "" : "hidden lg:block"
          }`}
        >
          <h2 id="mind-map-section-title" className="sr-only">
            Mind map canvas
          </h2>
          {isWorkspaceSidebarCollapsed && (
            <CanvasCornerToggleButton
              side="left"
              ariaLabel="Expand workspace sidebar"
              testId="expand-workspace-sidebar-button"
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
              onClick={handleExpandNodeDetailPanel}
            >
              <PanelRightOpen size={18} />
            </CanvasCornerToggleButton>
          )}
          <MindMap
            project={project}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onCreateNode={onQuickCreateNode}
            onToggleNode={onToggleNode}
            onMoveNode={onMoveNode}
            creatingNodeId={disableNodeCreationActions ? project.rootNodeId : creatingNodeId}
            streamingNodeId={streamingNodeId}
          />
        </section>
        {!isNodeDetailPanelCollapsed && (
          <WorkspaceResizeHandle
            orientation="vertical"
            ariaLabel="Resize node details panel"
            testId="resize-node-details-panel"
            onResizeStart={handlePanelResizeStart}
          />
        )}
        {mobileWorkspaceView === "map" && (
          <WorkspaceResizeHandle
            orientation="horizontal"
            ariaLabel="Resize mind map height"
            testId="resize-mind-map-height"
            onResizeStart={handleMapResizeStart}
          />
        )}
        {!isNodeDetailPanelCollapsed && (
          <div className={mobileWorkspaceView === "chat" ? "contents" : "hidden lg:contents"}>
            <NodeDetailPanel
              node={selectedNode}
              onCreateNode={onCreateNode}
              onEditUserMessage={onEditUserMessage}
              onRetryAssistantMessage={onRetryAssistantMessage}
              onUpdateNodeTitle={onUpdateNodeTitle}
              onToggleNode={onToggleNode}
              onDeleteNode={onDeleteNode}
              isCreating={isSelectedNodeCreating}
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
              composerPlaceholder={nodeDetailOptions?.composerPlaceholder}
              submitLabel={nodeDetailOptions?.submitLabel}
            />
          </div>
        )}
        {shouldShowProjectNotesDrawer && (
          <WorkspaceResizeHandle
            orientation="vertical"
            desktopBreakpoint="xl"
            ariaLabel="Resize project notes panel"
            testId="resize-project-notes-panel"
            onResizeStart={handleProjectNotesPanelResizeStart}
          />
        )}
        {shouldShowProjectNotesDrawer && (
          <button
            type="button"
            aria-label="Close project notes drawer"
            data-testid="project-notes-drawer-backdrop"
            onClick={handleCloseProjectNotesPanel}
            className="fixed inset-0 z-30 bg-[#332b38]/20 backdrop-blur-[1px] xl:hidden"
          />
        )}
        {shouldShowProjectNotesPanel && projectNotesConfig && (
          <div
            data-testid="project-notes-window"
            className={
              isProjectNotesMobileViewOpen
                ? "h-[calc(100svh-12rem)] max-h-[calc(100svh-12rem)] min-h-0 min-w-0 overflow-hidden xl:relative xl:inset-auto xl:z-auto xl:h-full xl:max-h-full xl:w-full xl:max-w-none"
                : "fixed bottom-3 right-3 top-3 z-40 flex min-h-0 w-[calc(100vw-24px)] max-w-[420px] min-w-0 overflow-hidden xl:relative xl:inset-auto xl:z-auto xl:h-full xl:max-h-full xl:w-full xl:max-w-none"
            }
          >
            <ProjectNotesPanel
              projectId={project.id}
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
