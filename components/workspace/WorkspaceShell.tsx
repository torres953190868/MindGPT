"use client";

import Link from "next/link";
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
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import type { ChatAttachment, ChatModelSelection } from "@/lib/types";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { MindMap } from "./MindMap";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type WorkspaceShellProps = {
  projectId: string;
};

const SIDE_PANEL_MIN_WIDTH = 170;
const SIDE_PANEL_SNAP_WIDTH = SIDE_PANEL_MIN_WIDTH / 2;
const SIDE_PANEL_PREFERRED_MIN_WIDTH = 300;
const DETAIL_PANEL_DEFAULT_WIDTH = 344;
const PROJECT_NOTES_PANEL_DEFAULT_WIDTH = 344;
const PROJECT_NOTES_PANEL_MIN_WIDTH = 280;
const PROJECT_NOTES_PANEL_MAX_WIDTH = 720;
const DESKTOP_MAP_MIN_WIDTH = 220;
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = SIDE_PANEL_PREFERRED_MIN_WIDTH;
const DESKTOP_RESIZE_HANDLE_WIDTH = 18;
const WORKSPACE_GRID_GAP = 16;
const MOBILE_MAP_DEFAULT_HEIGHT = 520;
const MOBILE_MAP_MIN_HEIGHT = 320;

type MobileWorkspaceView = "map" | "outline" | "chat" | "notes";
type ResizableSide = "left" | "right";

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

type ProjectNotesPanelResizeBoundsOptions = {
  gridWidth: number;
  workspaceSidebarWidth: number;
  detailPanelWidth: number;
  isWorkspaceSidebarCollapsed: boolean;
};

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

type WorkspaceResizeHandleProps = {
  orientation: "vertical" | "horizontal";
  desktopBreakpoint?: "lg" | "xl";
  ariaLabel: string;
  testId: string;
  onResizeStart: (event: ResizeStartEvent) => void;
};

type ResizeStartEvent = PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>;

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
        isVertical ? verticalClassName : "h-6 cursor-row-resize lg:hidden"
      }`}
    >
      <div
        className={`absolute rounded-full bg-white/70 shadow-sm ${
          isVertical
            ? "left-1/2 top-0 h-full w-px -translate-x-1/2"
            : "left-0 top-1/2 h-px w-full -translate-y-1/2"
        }`}
      />
      <button
        type="button"
        role="separator"
        aria-label={ariaLabel}
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        className={`group absolute grid place-items-center rounded-full border border-white/90 bg-white/85 shadow-lg shadow-[#d8c9e4]/45 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7] ${
          isVertical
            ? "left-1/2 top-1/2 h-16 w-5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize"
            : "left-1/2 top-1/2 h-11 w-24 -translate-x-1/2 -translate-y-1/2 cursor-row-resize"
        }`}
      >
        <span
          className={`rounded-full bg-[#9b83c2] opacity-70 transition group-hover:opacity-100 ${
            isVertical ? "h-8 w-1" : "h-1 w-8"
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
      className={`absolute top-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/80 bg-[#f1e8fb]/95 text-[#6c538d] shadow-lg shadow-[#d8c9e4]/45 backdrop-blur transition hover:bg-[#e4d5f6] focus:outline-none focus:ring-4 focus:ring-[#eadcf7] ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      {children}
    </button>
  );
}

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
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
  const editUserMessage = useBranchMindStore((state) => state.editUserMessage);
  const retryAssistantMessage = useBranchMindStore((state) => state.retryAssistantMessage);
  const retryPendingProjectSync = useBranchMindStore(
    (state) => state.retryPendingProjectSync,
  );
  const updateProjectNotes = useBranchMindStore((state) => state.updateProjectNotes);
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

  const selectedNode = project && selectedNodeId ? project.nodes[selectedNodeId] : null;
  const isProjectSyncBlocking =
    pendingProjectSync !== null && pendingProjectSync.status !== "synced";
  const pendingSyncNodeId = isProjectSyncBlocking ? pendingProjectSync.nodeId : null;
  const effectiveCreatingNodeId = creatingNodeId ?? pendingSyncNodeId;
  const effectiveStreamingNodeId = streamingNodeId ?? pendingSyncNodeId;
  const isSelectedNodeCreating = selectedNode
    ? effectiveCreatingNodeId === selectedNode.id ||
      effectiveStreamingNodeId === selectedNode.id
    : false;
  const isProjectNotesSidePanelOpen =
    isProjectNotesPanelOpen && !isNodeDetailPanelCollapsed;
  const isProjectNotesMobileViewOpen = mobileWorkspaceView === "notes";
  const shouldShowProjectNotesPanel =
    isProjectNotesSidePanelOpen || isProjectNotesMobileViewOpen;
  const shouldShowProjectNotesDrawer =
    isProjectNotesSidePanelOpen && !isProjectNotesMobileViewOpen;
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
    "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:h-full lg:grid-cols-[var(--workspace-grid-columns)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:overflow-hidden xl:grid-cols-[var(--workspace-wide-grid-columns)]";

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
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setIsProjectNotesPanelOpen(false);
      setMobileWorkspaceView((current) => (current === "notes" ? "chat" : "notes"));
      return;
    }

    setIsProjectNotesPanelOpen((isOpen) => !isOpen);
  }, []);

  const handleCloseProjectNotesPanel = useCallback(() => {
    setIsProjectNotesPanelOpen(false);
    setMobileWorkspaceView((current) => (current === "notes" ? "chat" : current));
  }, []);

  const handleSelectMobileWorkspaceView = useCallback((view: MobileWorkspaceView) => {
    setMobileWorkspaceView(view);
    if (view === "notes") setIsProjectNotesPanelOpen(false);
  }, []);

  const handleSelectNodeFromOutline = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      setMobileWorkspaceView("chat");
    },
    [selectNode],
  );

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

  const handleQuickCreate = useCallback(
    (nodeId: string, mode: "continue" | "branch") => {
      const instruction =
        mode === "continue"
          ? "Continue with the next key knowledge point."
          : "Explain the most useful side topic from this node in depth.";
      void createChildNode(nodeId, mode, instruction);
    },
    [createChildNode],
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
    const currentSidebarWidth = isWorkspaceSidebarCollapsed ? 0 : workspaceSidebarWidth;
    const includeSidebarHandle = !isWorkspaceSidebarCollapsed;
    const gapCount = getGridGapCount([
      !isWorkspaceSidebarCollapsed,
      includeSidebarHandle,
      true,
      true,
      true,
      true,
      true,
    ]);
    const maxWidthForViewport =
      gridWidth -
      currentSidebarWidth -
      detailPanelWidth -
      (includeSidebarHandle ? DESKTOP_RESIZE_HANDLE_WIDTH : 0) -
      DESKTOP_RESIZE_HANDLE_WIDTH -
      DESKTOP_RESIZE_HANDLE_WIDTH -
      DESKTOP_MAP_MIN_WIDTH -
      WORKSPACE_GRID_GAP * gapCount;
    const maxWidth = Math.max(
      PROJECT_NOTES_PANEL_MIN_WIDTH,
      Math.min(PROJECT_NOTES_PANEL_MAX_WIDTH, maxWidthForViewport),
    );

    function resizeTo(clientX: number) {
      const deltaX = startX - clientX;
      setProjectNotesPanelWidth(
        clamp(startWidth + deltaX, PROJECT_NOTES_PANEL_MIN_WIDTH, maxWidth),
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
        className="grid min-h-screen place-items-center px-5 text-lg font-black text-[#5c5065]"
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
          className="w-full max-w-2xl rounded-[30px] border border-white/80 bg-white/72 p-6 text-center shadow-xl shadow-[#e1d1ee]/50"
        >
          <h1
            id="workspace-project-not-found-title"
            className="text-3xl font-black text-[#342b3a]"
          >
            Project not found
          </h1>
          <p className="mt-3 text-[#665a70]">Create a new BranchMind project.</p>
          <div className="mt-6">
            <ProjectLauncher />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      aria-labelledby="workspace-title"
      data-testid="workspace-shell"
      className="flex min-h-screen flex-col gap-4 p-4 lg:h-screen lg:min-h-[720px] lg:overflow-hidden"
    >
      <header
        aria-label="Workspace header"
        data-testid="workspace-header"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-white/80 bg-white/70 px-5 py-3 shadow-sm"
      >
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#74687c]">
            BranchMind
          </p>
          <h1 id="workspace-title" className="line-clamp-1 text-xl font-black text-[#342b3a]">
            {project.title}
          </h1>
        </div>
        <nav
          aria-label="Workspace navigation"
          data-testid="workspace-navigation"
          className="flex w-full min-w-0 flex-wrap items-center justify-end gap-3 sm:w-auto"
        >
          <Link
            href="/projects"
            aria-label="Project list"
            data-testid="workspace-projects-link"
            className="inline-flex rounded-[18px] bg-[#f1e8fb] px-4 py-3 text-sm font-black text-[#5d427d] transition hover:bg-[#e4d5f6]"
          >
            Projects
          </Link>
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

      {pendingProjectSync?.status === "failed" && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="project-sync-status"
          data-status={pendingProjectSync.status}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
        >
          <span>
            {`Sync failed. ${pendingProjectSync.error ?? "Your project is saved in this browser."}`}
          </span>
          <button
            type="button"
            data-testid="retry-project-sync-button"
            onClick={() => retryPendingProjectSync(projectId)}
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
        className="grid grid-cols-4 gap-2 rounded-[24px] border border-white/80 bg-white/68 p-2 shadow-sm lg:hidden"
      >
        {mobileWorkspaceTabs.map((tab) => {
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
              footer={<AuthPanel placement="top" className="w-full" />}
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
          className={`relative h-[var(--mobile-map-height)] overflow-hidden rounded-[30px] border border-white/80 bg-white/40 p-2 shadow-xl shadow-[#e4d6ef]/45 lg:h-full lg:min-h-0 ${
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
            onSelectNode={selectNode}
            onCreateNode={handleQuickCreate}
            onToggleNode={toggleNodeCollapsed}
            onMoveNode={updateNodePosition}
            creatingNodeId={effectiveCreatingNodeId}
            streamingNodeId={effectiveStreamingNodeId}
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
              onCreateNode={handleCreateFromPanel}
              onEditUserMessage={editUserMessage}
              onRetryAssistantMessage={retryAssistantMessage}
              onToggleNode={toggleNodeCollapsed}
              onDeleteNode={deleteNode}
              isCreating={isSelectedNodeCreating}
              isNotesOpen={isProjectNotesSidePanelOpen || isProjectNotesMobileViewOpen}
              error={aiError}
              onToggleNotes={handleToggleProjectNotesPanel}
              onCollapse={handleCollapseNodeDetailPanel}
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
        {shouldShowProjectNotesPanel && (
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
              projectNotes={project.notes}
              node={selectedNode}
              isCreating={isSelectedNodeCreating}
              onUpdateProjectNotes={updateProjectNotes}
              onClose={handleCloseProjectNotesPanel}
            />
          </div>
        )}
      </div>
    </main>
  );
}
