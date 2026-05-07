"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import { MindMap } from "./MindMap";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type WorkspaceShellProps = {
  projectId: string;
};

const DETAIL_PANEL_DEFAULT_WIDTH = 344;
const DETAIL_PANEL_MIN_WIDTH = 280;
const DETAIL_PANEL_MAX_WIDTH = 1040;
const DESKTOP_MAP_MIN_WIDTH = 220;
const DESKTOP_SIDEBAR_WIDTH = 292;
const DESKTOP_COLLAPSED_PANEL_WIDTH = 76;
const DESKTOP_RESIZE_HANDLE_WIDTH = 18;
const WORKSPACE_GRID_GAP = 16;
const MOBILE_MAP_DEFAULT_HEIGHT = 520;
const MOBILE_MAP_MIN_HEIGHT = 320;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type WorkspaceResizeHandleProps = {
  orientation: "vertical" | "horizontal";
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
};

function WorkspaceResizeHandle({ orientation, onResizeStart }: WorkspaceResizeHandleProps) {
  const isVertical = orientation === "vertical";

  return (
    <div
      className={`relative ${
        isVertical ? "hidden cursor-col-resize lg:block" : "h-6 cursor-row-resize lg:hidden"
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
        aria-label={isVertical ? "Resize node details panel" : "Resize mind map height"}
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        data-testid={isVertical ? "resize-node-details-panel" : "resize-mind-map-height"}
        onPointerDown={onResizeStart}
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

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const [detailPanelWidth, setDetailPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const [mobileMapHeight, setMobileMapHeight] = useState(MOBILE_MAP_DEFAULT_HEIGHT);
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(false);
  const [isNodeDetailPanelCollapsed, setIsNodeDetailPanelCollapsed] = useState(false);
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
  const workspaceSidebarWidth = isWorkspaceSidebarCollapsed
    ? DESKTOP_COLLAPSED_PANEL_WIDTH
    : DESKTOP_SIDEBAR_WIDTH;
  const resolvedDetailPanelWidth = isNodeDetailPanelCollapsed
    ? DESKTOP_COLLAPSED_PANEL_WIDTH
    : detailPanelWidth;

  const workspaceGridStyle = {
    "--workspace-sidebar-width": `${workspaceSidebarWidth}px`,
    "--detail-panel-width": `${resolvedDetailPanelWidth}px`,
    "--mobile-map-height": `${mobileMapHeight}px`,
  } as CSSProperties;
  const workspaceGridClassName = isNodeDetailPanelCollapsed
    ? "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[var(--workspace-sidebar-width)_minmax(220px,1fr)_var(--detail-panel-width)]"
    : "grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[var(--workspace-sidebar-width)_minmax(220px,1fr)_18px_var(--detail-panel-width)]";

  const handleCollapseWorkspaceSidebar = useCallback(() => {
    setIsWorkspaceSidebarCollapsed(true);
  }, []);

  const handleExpandWorkspaceSidebar = useCallback(() => {
    setIsWorkspaceSidebarCollapsed(false);
  }, []);

  const handleCollapseNodeDetailPanel = useCallback(() => {
    setIsNodeDetailPanelCollapsed(true);
  }, []);

  const handleExpandNodeDetailPanel = useCallback(() => {
    setIsNodeDetailPanelCollapsed(false);
  }, []);

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

  const handlePanelResizeStart = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = detailPanelWidth;
    const gridWidth = event.currentTarget.parentElement?.parentElement?.clientWidth ?? 0;
    const currentSidebarWidth = isWorkspaceSidebarCollapsed
      ? DESKTOP_COLLAPSED_PANEL_WIDTH
      : DESKTOP_SIDEBAR_WIDTH;
    const maxWidthForViewport =
      gridWidth -
      currentSidebarWidth -
      DESKTOP_RESIZE_HANDLE_WIDTH -
      DESKTOP_MAP_MIN_WIDTH -
      WORKSPACE_GRID_GAP * 3;
    const maxWidth = Math.max(
      DETAIL_PANEL_MIN_WIDTH,
      Math.min(DETAIL_PANEL_MAX_WIDTH, maxWidthForViewport),
    );

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const deltaX = startX - moveEvent.clientX;
      setDetailPanelWidth(clamp(startWidth + deltaX, DETAIL_PANEL_MIN_WIDTH, maxWidth));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [detailPanelWidth, isWorkspaceSidebarCollapsed]);

  const handleMapResizeStart = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = mobileMapHeight;
    const maxHeight = Math.max(MOBILE_MAP_MIN_HEIGHT, window.innerHeight - 260);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const deltaY = moveEvent.clientY - startY;
      setMobileMapHeight(clamp(startHeight + deltaY, MOBILE_MAP_MIN_HEIGHT, maxHeight));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
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
        <WorkspaceSidebar
          project={project}
          selectedNodeId={selectedNodeId}
          isCollapsed={isWorkspaceSidebarCollapsed}
          onSelectNode={selectNode}
          onCollapse={handleCollapseWorkspaceSidebar}
          onExpand={handleExpandWorkspaceSidebar}
        />
        <section
          aria-labelledby="mind-map-section-title"
          data-testid="mind-map-canvas"
          className="h-[var(--mobile-map-height)] overflow-hidden rounded-[30px] border border-white/80 bg-white/40 p-2 shadow-xl shadow-[#e4d6ef]/45 lg:h-auto lg:min-h-[520px]"
        >
          <h2 id="mind-map-section-title" className="sr-only">
            Mind map canvas
          </h2>
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
          <WorkspaceResizeHandle orientation="vertical" onResizeStart={handlePanelResizeStart} />
        )}
        <WorkspaceResizeHandle orientation="horizontal" onResizeStart={handleMapResizeStart} />
        <NodeDetailPanel
          node={selectedNode}
          onCreateNode={handleCreateFromPanel}
          onToggleNode={toggleNodeCollapsed}
          onDeleteNode={deleteNode}
          isCreating={
            selectedNode
              ? creatingNodeId === selectedNode.id || streamingNodeId === selectedNode.id
              : false
          }
          error={aiError}
          isCollapsed={isNodeDetailPanelCollapsed}
          onCollapse={handleCollapseNodeDetailPanel}
          onExpand={handleExpandNodeDetailPanel}
        />
      </div>
    </main>
  );
}
