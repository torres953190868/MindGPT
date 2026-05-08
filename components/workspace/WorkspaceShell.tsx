"use client";

import Link from "next/link";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
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
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { MindMap } from "./MindMap";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type WorkspaceShellProps = {
  projectId: string;
};

const DETAIL_PANEL_DEFAULT_WIDTH = 344;
const DETAIL_PANEL_MIN_WIDTH = 280;
const DETAIL_PANEL_MAX_WIDTH = 1040;
const PROJECT_NOTES_PANEL_DEFAULT_WIDTH = 344;
const PROJECT_NOTES_PANEL_MIN_WIDTH = 280;
const PROJECT_NOTES_PANEL_MAX_WIDTH = 720;
const DESKTOP_MAP_MIN_WIDTH = 220;
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 292;
const WORKSPACE_SIDEBAR_MIN_WIDTH = 240;
const WORKSPACE_SIDEBAR_MAX_WIDTH = 560;
const DESKTOP_RESIZE_HANDLE_WIDTH = 18;
const WORKSPACE_GRID_GAP = 16;
const MOBILE_MAP_DEFAULT_HEIGHT = 520;
const MOBILE_MAP_MIN_HEIGHT = 320;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getGridGapCount(includedColumns: boolean[]) {
  const columnCount = includedColumns.filter(Boolean).length;

  return Math.max(0, columnCount - 1);
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
            : "left-1/2 top-1/2 h-5 w-16 -translate-x-1/2 -translate-y-1/2 cursor-row-resize"
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
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(
    WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
  );
  const [detailPanelWidth, setDetailPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const [projectNotesPanelWidth, setProjectNotesPanelWidth] = useState(
    PROJECT_NOTES_PANEL_DEFAULT_WIDTH,
  );
  const [mobileMapHeight, setMobileMapHeight] = useState(MOBILE_MAP_DEFAULT_HEIGHT);
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
  const aiError = useBranchMindStore((state) => state.aiError);
  const selectProject = useBranchMindStore((state) => state.selectProject);
  const selectNode = useBranchMindStore((state) => state.selectNode);
  const createChildNode = useBranchMindStore((state) => state.createChildNode);
  const editUserMessage = useBranchMindStore((state) => state.editUserMessage);
  const retryAssistantMessage = useBranchMindStore((state) => state.retryAssistantMessage);
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
  const selectedNode = project && selectedNodeId ? project.nodes[selectedNodeId] : null;
  const isSelectedNodeCreating = selectedNode
    ? creatingNodeId === selectedNode.id || streamingNodeId === selectedNode.id
    : false;
  const isProjectNotesSidePanelOpen =
    isProjectNotesPanelOpen && !isNodeDetailPanelCollapsed;
  const desktopGridColumns = [
    !isWorkspaceSidebarCollapsed ? "var(--workspace-sidebar-width)" : null,
    !isWorkspaceSidebarCollapsed ? `${DESKTOP_RESIZE_HANDLE_WIDTH}px` : null,
    "minmax(220px,1fr)",
    !isNodeDetailPanelCollapsed ? `${DESKTOP_RESIZE_HANDLE_WIDTH}px` : null,
    !isNodeDetailPanelCollapsed ? "var(--detail-panel-width)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const wideGridColumns = [
    !isWorkspaceSidebarCollapsed ? "var(--workspace-sidebar-width)" : null,
    !isWorkspaceSidebarCollapsed ? `${DESKTOP_RESIZE_HANDLE_WIDTH}px` : null,
    "minmax(220px,1fr)",
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
    "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[var(--workspace-grid-columns)] xl:grid-cols-[var(--workspace-wide-grid-columns)]";

  const handleCollapseWorkspaceSidebar = useCallback(() => {
    setIsWorkspaceSidebarCollapsed(true);
  }, []);

  const handleExpandWorkspaceSidebar = useCallback(() => {
    setIsWorkspaceSidebarCollapsed(false);
  }, []);

  const handleCollapseNodeDetailPanel = useCallback(() => {
    setIsNodeDetailPanelCollapsed(true);
    setIsProjectNotesPanelOpen(false);
  }, []);

  const handleExpandNodeDetailPanel = useCallback(() => {
    setIsNodeDetailPanelCollapsed(false);
  }, []);

  const handleToggleProjectNotesPanel = useCallback(() => {
    setIsProjectNotesPanelOpen((isOpen) => !isOpen);
  }, []);

  const handleCloseProjectNotesPanel = useCallback(() => {
    setIsProjectNotesPanelOpen(false);
  }, []);

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

  const handleWorkspaceSidebarResizeStart = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";

    const startX = event.clientX;
    const startWidth = workspaceSidebarWidth;
    const gridWidth = event.currentTarget.parentElement?.parentElement?.clientWidth ?? 0;
    const currentDetailPanelWidth = isNodeDetailPanelCollapsed ? 0 : detailPanelWidth;
    const includeDetailHandle = !isNodeDetailPanelCollapsed;
    const reserveProjectNotesPanel =
      window.matchMedia("(min-width: 1280px)").matches && isProjectNotesSidePanelOpen;
    const reservedProjectNotesPanelWidth = reserveProjectNotesPanel
      ? projectNotesPanelWidth
      : 0;
    const projectNotesHandleWidth = reserveProjectNotesPanel ? DESKTOP_RESIZE_HANDLE_WIDTH : 0;
    const gapCount = getGridGapCount([
      true,
      true,
      true,
      includeDetailHandle,
      !isNodeDetailPanelCollapsed,
      reserveProjectNotesPanel,
      reserveProjectNotesPanel,
    ]);
    const maxWidthForViewport =
      gridWidth -
      currentDetailPanelWidth -
      reservedProjectNotesPanelWidth -
      DESKTOP_RESIZE_HANDLE_WIDTH -
      (includeDetailHandle ? DESKTOP_RESIZE_HANDLE_WIDTH : 0) -
      projectNotesHandleWidth -
      DESKTOP_MAP_MIN_WIDTH -
      WORKSPACE_GRID_GAP * gapCount;
    const maxWidth = Math.max(
      WORKSPACE_SIDEBAR_MIN_WIDTH,
      Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, maxWidthForViewport),
    );

    function resizeTo(clientX: number) {
      const deltaX = clientX - startX;
      setWorkspaceSidebarWidth(clamp(startWidth + deltaX, WORKSPACE_SIDEBAR_MIN_WIDTH, maxWidth));
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
    isNodeDetailPanelCollapsed,
    isProjectNotesSidePanelOpen,
    projectNotesPanelWidth,
    workspaceSidebarWidth,
  ]);

  const handlePanelResizeStart = useCallback((event: ResizeStartEvent) => {
    event.preventDefault();
    const isPointerResize = getResizeInputMode(event) === "pointer";

    const startX = event.clientX;
    const startWidth = detailPanelWidth;
    const gridWidth = event.currentTarget.parentElement?.parentElement?.clientWidth ?? 0;
    const currentSidebarWidth = isWorkspaceSidebarCollapsed ? 0 : workspaceSidebarWidth;
    const includeSidebarHandle = !isWorkspaceSidebarCollapsed;
    const reserveProjectNotesPanel =
      window.matchMedia("(min-width: 1280px)").matches && isProjectNotesSidePanelOpen;
    const reservedProjectNotesPanelWidth = reserveProjectNotesPanel
      ? projectNotesPanelWidth
      : 0;
    const projectNotesHandleWidth = reserveProjectNotesPanel ? DESKTOP_RESIZE_HANDLE_WIDTH : 0;
    const gapCount = getGridGapCount([
      !isWorkspaceSidebarCollapsed,
      includeSidebarHandle,
      true,
      true,
      true,
      reserveProjectNotesPanel,
      reserveProjectNotesPanel,
    ]);
    const maxWidthForViewport =
      gridWidth -
      currentSidebarWidth -
      reservedProjectNotesPanelWidth -
      DESKTOP_RESIZE_HANDLE_WIDTH -
      (includeSidebarHandle ? DESKTOP_RESIZE_HANDLE_WIDTH : 0) -
      projectNotesHandleWidth -
      DESKTOP_MAP_MIN_WIDTH -
      WORKSPACE_GRID_GAP * gapCount;
    const maxWidth = Math.max(
      DETAIL_PANEL_MIN_WIDTH,
      Math.min(DETAIL_PANEL_MAX_WIDTH, maxWidthForViewport),
    );

    function resizeTo(clientX: number) {
      const deltaX = startX - clientX;
      setDetailPanelWidth(clamp(startWidth + deltaX, DETAIL_PANEL_MIN_WIDTH, maxWidth));
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
    isProjectNotesSidePanelOpen,
    isWorkspaceSidebarCollapsed,
    projectNotesPanelWidth,
    workspaceSidebarWidth,
  ]);

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
    ) => {
      return createChildNode(nodeId, mode, instruction, sourceText);
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
      className="flex h-screen min-h-[720px] flex-col gap-4 p-4"
    >
      <header
        aria-label="Workspace header"
        data-testid="workspace-header"
        className="flex items-center justify-between rounded-[26px] border border-white/80 bg-white/70 px-5 py-3 shadow-sm"
      >
        <div>
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
          className="flex flex-wrap items-center justify-end gap-3"
        >
          <AuthPanel />
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

      <div
        className={workspaceGridClassName}
        style={workspaceGridStyle}
      >
        {!isWorkspaceSidebarCollapsed && (
          <WorkspaceSidebar
            project={project}
            selectedNodeId={selectedNodeId}
            onSelectNode={selectNode}
            onCollapse={handleCollapseWorkspaceSidebar}
          />
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
          className="relative h-[var(--mobile-map-height)] overflow-hidden rounded-[30px] border border-white/80 bg-white/40 p-2 shadow-xl shadow-[#e4d6ef]/45 lg:h-auto lg:min-h-[520px]"
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
            creatingNodeId={creatingNodeId}
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
        <WorkspaceResizeHandle
          orientation="horizontal"
          ariaLabel="Resize mind map height"
          testId="resize-mind-map-height"
          onResizeStart={handleMapResizeStart}
        />
        {!isNodeDetailPanelCollapsed && (
          <NodeDetailPanel
            node={selectedNode}
            onCreateNode={handleCreateFromPanel}
            onEditUserMessage={editUserMessage}
            onRetryAssistantMessage={retryAssistantMessage}
            onToggleNode={toggleNodeCollapsed}
            onDeleteNode={deleteNode}
            isCreating={isSelectedNodeCreating}
            isNotesOpen={isProjectNotesSidePanelOpen}
            error={aiError}
            onToggleNotes={handleToggleProjectNotesPanel}
            onCollapse={handleCollapseNodeDetailPanel}
          />
        )}
        {isProjectNotesSidePanelOpen && (
          <WorkspaceResizeHandle
            orientation="vertical"
            desktopBreakpoint="xl"
            ariaLabel="Resize project notes panel"
            testId="resize-project-notes-panel"
            onResizeStart={handleProjectNotesPanelResizeStart}
          />
        )}
        {isProjectNotesSidePanelOpen && (
          <button
            type="button"
            aria-label="Close project notes drawer"
            data-testid="project-notes-drawer-backdrop"
            onClick={handleCloseProjectNotesPanel}
            className="fixed inset-0 z-30 bg-[#332b38]/20 backdrop-blur-[1px] xl:hidden"
          />
        )}
        {isProjectNotesSidePanelOpen && (
          <div
            data-testid="project-notes-window"
            className="fixed bottom-3 right-3 top-3 z-40 flex w-[calc(100vw-24px)] max-w-[420px] min-w-0 xl:relative xl:inset-auto xl:z-auto xl:w-full xl:max-w-none"
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
