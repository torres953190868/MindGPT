"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { EyeOff } from "lucide-react";
import {
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type ReactFlowInstance,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import { getVisibleNodeIds } from "@/lib/graph";
import type { Project } from "@/lib/types";
import {
  BranchNodeCard,
  type BranchNodeData,
  type InlineNodeComposerData,
} from "./BranchNodeCard";

const nodeTypes: NodeTypes = {
  branchNode: BranchNodeCard,
};
const HOME_CANVAS_PAN_RANGE_RATIO = 1 / 5;
const HOME_CANVAS_WHEEL_PAN_SPEED = 0.5;
const LINE_SCROLL_DELTA_MULTIPLIER = 20;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type MindMapProps = {
  project: Project;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onCreateNode: (nodeId: string, mode: "continue" | "branch") => void;
  onToggleNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  inlineNodeComposer?: InlineNodeComposerData;
  onHomeCanvasPanOffsetChange?: (offsetY: number) => void;
};

export function MindMap({
  project,
  selectedNodeId,
  onSelectNode,
  onCreateNode,
  onToggleNode,
  onMoveNode,
  creatingNodeId,
  streamingNodeId,
  inlineNodeComposer,
  onHomeCanvasPanOffsetChange,
}: MindMapProps) {
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const homeViewportBaselineYRef = useRef<number | null>(null);
  const visibleNodeIds = useMemo(() => getVisibleNodeIds(project), [project]);

  const graphNodes = useMemo<Node<BranchNodeData>[]>(() => {
    return Object.values(project.nodes)
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => ({
        id: node.id,
        type: "branchNode",
        position: node.position,
        selected: selectedNodeId === node.id,
        dragHandle: ".branch-node-edge-hit-area",
        data: {
          mindNode: node,
          selected: selectedNodeId === node.id,
          onSelect: onSelectNode,
          onCreate: onCreateNode,
          onToggle: onToggleNode,
          isStreaming: streamingNodeId === node.id,
          creationDisabled: Boolean(creatingNodeId),
          inlineComposer:
            inlineNodeComposer?.nodeId === node.id ? inlineNodeComposer : undefined,
        },
      }));
  }, [
    creatingNodeId,
    inlineNodeComposer,
    onCreateNode,
    onSelectNode,
    onToggleNode,
    project.nodes,
    selectedNodeId,
    streamingNodeId,
    visibleNodeIds,
  ]);

  const graphEdges = useMemo<Edge[]>(() => {
    return Object.values(project.nodes).flatMap((node) =>
      node.children
        .filter((childId) => visibleNodeIds.has(node.id) && visibleNodeIds.has(childId))
        .map((childId) => {
          const child = project.nodes[childId];
          const isBranchChild = child?.branchType === "branch";
          return {
            id: `${node.id}-${childId}`,
            source: node.id,
            target: childId,
            sourceHandle: isBranchChild ? "branch-source" : "continue-source",
            targetHandle: isBranchChild ? "branch-target" : "continue-target",
            animated: selectedNodeId === node.id || selectedNodeId === childId,
            style: {
              stroke: isBranchChild ? "#c4ade6" : "#9bd8c6",
              strokeWidth: 2,
              strokeDasharray: "6 5",
            },
          };
        }),
    );
  }, [project.nodes, selectedNodeId, visibleNodeIds]);

  const [nodes, setNodes] = useState(graphNodes);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance<Node<BranchNodeData>, Edge> | null>(null);
  const dragDisabled = Boolean(creatingNodeId || streamingNodeId);
  const isHomeInlineComposer = inlineNodeComposer?.variant === "home";
  const homeComposerNodeId = isHomeInlineComposer ? inlineNodeComposer?.nodeId : null;
  const fitViewOptions = useMemo(
    () => ({
      maxZoom: inlineNodeComposer ? 1 : 1.7,
    }),
    [inlineNodeComposer],
  );

  const centerHomeComposer = useCallback(() => {
    if (!reactFlowInstance || !homeComposerNodeId) return;

    void reactFlowInstance
      .fitView({
        nodes: [{ id: homeComposerNodeId }],
        maxZoom: 1,
        duration: 0,
      })
      .then(() => {
        homeViewportBaselineYRef.current = reactFlowInstance.getViewport().y;
        onHomeCanvasPanOffsetChange?.(0);
      });
  }, [homeComposerNodeId, onHomeCanvasPanOffsetChange, reactFlowInstance]);

  const getHomeCanvasPanLimit = useCallback(() => {
    const containerHeight = flowContainerRef.current?.clientHeight ?? window.innerHeight;

    return containerHeight * HOME_CANVAS_PAN_RANGE_RATIO;
  }, []);

  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes]);

  useEffect(() => {
    if (!homeComposerNodeId) return undefined;

    const animationFrame = window.requestAnimationFrame(centerHomeComposer);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [centerHomeComposer, graphNodes, homeComposerNodeId]);

  useEffect(() => {
    if (!homeComposerNodeId) return undefined;

    const container = flowContainerRef.current;
    if (!container) return undefined;

    let animationFrame = 0;
    const scheduleCenter = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(centerHomeComposer);
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleCenter);

    scheduleCenter();
    observer?.observe(container);
    window.addEventListener("resize", scheduleCenter);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleCenter);
    };
  }, [centerHomeComposer, homeComposerNodeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current) as Node<BranchNodeData>[]);
    },
    [],
  );

  const handleNodeDragStop: OnNodeDrag<Node<BranchNodeData>> = useCallback(
    (_, node) => {
      if (dragDisabled) return;
      void onMoveNode(node.id, node.position);
    },
    [dragDisabled, onMoveNode],
  );

  const handleViewportChange = useCallback(
    (viewport: Viewport) => {
      if (!isHomeInlineComposer) return;

      if (homeViewportBaselineYRef.current === null) {
        homeViewportBaselineYRef.current = viewport.y;
      }

      const baselineY = homeViewportBaselineYRef.current;
      const panLimit = getHomeCanvasPanLimit();
      const rawOffsetY = viewport.y - baselineY;
      const clampedOffsetY = clamp(rawOffsetY, -panLimit, 0);

      onHomeCanvasPanOffsetChange?.(clampedOffsetY);

      if (reactFlowInstance && Math.abs(rawOffsetY - clampedOffsetY) > 0.5) {
        void reactFlowInstance.setViewport(
          {
            ...viewport,
            y: baselineY + clampedOffsetY,
          },
          { duration: 0 },
        );
      }
    },
    [
      getHomeCanvasPanLimit,
      isHomeInlineComposer,
      onHomeCanvasPanOffsetChange,
      reactFlowInstance,
    ],
  );

  const handleHomeWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!isHomeInlineComposer || !reactFlowInstance) return;

      event.preventDefault();
      event.stopPropagation();

      const viewport = reactFlowInstance.getViewport();
      const baselineY = homeViewportBaselineYRef.current ?? viewport.y;
      const deltaY =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_SCROLL_DELTA_MULTIPLIER
          : 1);
      const nextOffsetY = clamp(
        viewport.y - baselineY - deltaY * HOME_CANVAS_WHEEL_PAN_SPEED,
        -getHomeCanvasPanLimit(),
        0,
      );

      homeViewportBaselineYRef.current = baselineY;
      onHomeCanvasPanOffsetChange?.(nextOffsetY);
      void reactFlowInstance.setViewport(
        {
          ...viewport,
          y: baselineY + nextOffsetY,
        },
        { duration: 0 },
      );
    },
    [
      getHomeCanvasPanLimit,
      isHomeInlineComposer,
      onHomeCanvasPanOffsetChange,
      reactFlowInstance,
    ],
  );

  if (graphNodes.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Mind map has no visible nodes"
        data-testid="mind-map-empty-state"
        className="branchmind-grid grid h-full min-h-[360px] place-items-center rounded-2xl lg:rounded-none"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <EyeOff size={28} className="text-neutral-400" />
          <span className="text-sm font-black text-neutral-600">No visible nodes</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={flowContainerRef}
      id="mind-map"
      role="region"
      aria-label="Mind map"
      data-testid="mind-map"
      className="h-full min-h-[360px]"
    >
      <ReactFlow
        aria-label="Interactive mind map canvas"
        data-testid="mind-map-react-flow"
        nodes={nodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={!dragDisabled}
        onInit={setReactFlowInstance}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onViewportChange={handleViewportChange}
        onWheel={handleHomeWheel}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.25}
        maxZoom={1.7}
        zoomOnScroll={!isHomeInlineComposer}
        panOnScroll={false}
        className="branchmind-grid h-full rounded-[28px] lg:rounded-none"
      >
        <Controls
          className={`!rounded-[18px] !border-white/80 !bg-white/80 !shadow-lg ${
            isHomeInlineComposer ? "!hidden sm:!flex" : ""
          }`}
        />
      </ReactFlow>
    </div>
  );
}
