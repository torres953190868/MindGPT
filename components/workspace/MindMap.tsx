"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
const HOME_COMPOSER_INITIAL_OFFSET_Y = 16;
const HOME_CANVAS_WHEEL_PAN_SPEED = 0.5;
const HOME_HERO_MIN_VISIBLE_TOP = 16;
const HOME_CANVAS_PAN_ACTIVATION_DISTANCE = 6;
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

type HomeCanvasGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetY: number;
  baselineX: number;
  baselineY: number;
  mode: "pending" | "vertical" | "horizontal";
  captured: boolean;
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
  const homeCanvasPanOffsetYRef = useRef(0);
  const homeCanvasGestureRef = useRef<HomeCanvasGesture | null>(null);
  const homeViewportBaselineXRef = useRef<number | null>(null);
  const homeViewportBaselineYRef = useRef<number | null>(null);
  const previousFlowBoundsRef = useRef<DOMRectReadOnly | null>(null);
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
              stroke: isBranchChild
                ? "var(--node-handle-branch)"
                : "var(--node-handle-continue)",
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
        const viewport = reactFlowInstance.getViewport();
        const initialViewport = {
          ...viewport,
          y: viewport.y + HOME_COMPOSER_INITIAL_OFFSET_Y,
        };

        homeViewportBaselineYRef.current = initialViewport.y;
        homeViewportBaselineXRef.current = initialViewport.x;
        homeCanvasPanOffsetYRef.current = 0;
        onHomeCanvasPanOffsetChange?.(0);
        void reactFlowInstance.setViewport(initialViewport, { duration: 0 });
      });
  }, [homeComposerNodeId, onHomeCanvasPanOffsetChange, reactFlowInstance]);

  const getHomeCanvasPanBounds = useCallback(() => {
    const containerHeight = flowContainerRef.current?.clientHeight ?? window.innerHeight;
    const heroTop =
      document
        .querySelector<HTMLElement>("[data-testid='home-hero']")
        ?.getBoundingClientRect().top ?? containerHeight;
    const baselineHeroTop = heroTop - homeCanvasPanOffsetYRef.current;
    const maxUpBeforeHeroLeavesScreen = Math.max(
      0,
      baselineHeroTop - HOME_HERO_MIN_VISIBLE_TOP,
    );
    const panRange = containerHeight * HOME_CANVAS_PAN_RANGE_RATIO;

    return {
      down: 0,
      up: Math.min(panRange, maxUpBeforeHeroLeavesScreen),
    };
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

  useEffect(() => {
    previousFlowBoundsRef.current = null;
  }, [project.id]);

  useEffect(() => {
    if (!reactFlowInstance || isHomeInlineComposer) return undefined;

    const container = flowContainerRef.current;
    if (!container) return undefined;

    let animationFrame = 0;
    const preserveViewportPosition = () => {
      const nextBounds = container.getBoundingClientRect();

      if (nextBounds.width === 0 || nextBounds.height === 0) {
        previousFlowBoundsRef.current = null;
        return;
      }

      const previousBounds = previousFlowBoundsRef.current;
      previousFlowBoundsRef.current = nextBounds;

      if (!previousBounds) return;

      const deltaX = previousBounds.left - nextBounds.left;
      const deltaY = previousBounds.top - nextBounds.top;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

      const viewport = reactFlowInstance.getViewport();
      void reactFlowInstance.setViewport(
        {
          ...viewport,
          x: viewport.x + deltaX,
          y: viewport.y + deltaY,
        },
        { duration: 0 },
      );
    };
    const schedulePreserveViewportPosition = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(preserveViewportPosition);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedulePreserveViewportPosition);

    schedulePreserveViewportPosition();
    observer?.observe(container);
    window.addEventListener("resize", schedulePreserveViewportPosition);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", schedulePreserveViewportPosition);
    };
  }, [isHomeInlineComposer, reactFlowInstance, project.id]);

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
      if (homeViewportBaselineXRef.current === null) {
        homeViewportBaselineXRef.current = viewport.x;
      }

      const baselineX = homeViewportBaselineXRef.current;
      const baselineY = homeViewportBaselineYRef.current;
      const panBounds = getHomeCanvasPanBounds();
      const rawOffsetY = viewport.y - baselineY;
      const clampedOffsetY = clamp(rawOffsetY, -panBounds.up, panBounds.down);
      const shouldCorrectViewport =
        Math.abs(viewport.x - baselineX) > 0.5 ||
        Math.abs(rawOffsetY - clampedOffsetY) > 0.5;

      homeCanvasPanOffsetYRef.current = clampedOffsetY;
      onHomeCanvasPanOffsetChange?.(clampedOffsetY);

      if (reactFlowInstance && shouldCorrectViewport) {
        void reactFlowInstance.setViewport(
          {
            ...viewport,
            x: baselineX,
            y: baselineY + clampedOffsetY,
          },
          { duration: 0 },
        );
      }
    },
    [
      getHomeCanvasPanBounds,
      isHomeInlineComposer,
      onHomeCanvasPanOffsetChange,
      reactFlowInstance,
    ],
  );

  const handleHomeWheel = useCallback(
    (event: WheelEvent) => {
      if (!isHomeInlineComposer || !reactFlowInstance) return;

      const target = event.target instanceof Element ? event.target : null;
      const deltaY =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_SCROLL_DELTA_MULTIPLIER
          : 1);
      const floatingScrollTarget =
        target?.closest<HTMLElement>(".nowheel, [data-testid='chat-model-menu']") ??
        document.querySelector<HTMLElement>("[data-testid='chat-model-menu']");
      if (floatingScrollTarget) {
        floatingScrollTarget.scrollTop += deltaY;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const viewport = reactFlowInstance.getViewport();
      const baselineX = homeViewportBaselineXRef.current ?? viewport.x;
      const baselineY = homeViewportBaselineYRef.current ?? viewport.y;
      const panBounds = getHomeCanvasPanBounds();
      const nextOffsetY = clamp(
        viewport.y - baselineY - deltaY * HOME_CANVAS_WHEEL_PAN_SPEED,
        -panBounds.up,
        0,
      );

      homeViewportBaselineXRef.current = baselineX;
      homeViewportBaselineYRef.current = baselineY;
      homeCanvasPanOffsetYRef.current = nextOffsetY;
      onHomeCanvasPanOffsetChange?.(nextOffsetY);
      void reactFlowInstance.setViewport(
        {
          ...viewport,
          x: baselineX,
          y: baselineY + nextOffsetY,
        },
        { duration: 0 },
      );
    },
    [
      getHomeCanvasPanBounds,
      isHomeInlineComposer,
      onHomeCanvasPanOffsetChange,
      reactFlowInstance,
    ],
  );

  useEffect(() => {
    if (!isHomeInlineComposer || !reactFlowInstance) return;

    const wheelTarget = flowContainerRef.current?.parentElement;
    if (!wheelTarget) return;

    wheelTarget.addEventListener("wheel", handleHomeWheel, { passive: false });
    window.addEventListener("wheel", handleHomeWheel, { passive: false });
    return () => {
      wheelTarget.removeEventListener("wheel", handleHomeWheel);
      window.removeEventListener("wheel", handleHomeWheel);
    };
  }, [handleHomeWheel, isHomeInlineComposer, reactFlowInstance]);

  useEffect(() => {
    if (!isHomeInlineComposer || !reactFlowInstance) return undefined;

    const gestureTarget = flowContainerRef.current;
    if (!gestureTarget) return undefined;

    const stopGesture = (event?: PointerEvent) => {
      const gesture = homeCanvasGestureRef.current;
      if (gesture?.captured && event?.pointerId === gesture.pointerId) {
        try {
          gestureTarget.releasePointerCapture?.(gesture.pointerId);
        } catch {
          // The browser can release capture before pointercancel reaches us.
        }
      }
      homeCanvasGestureRef.current = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;

      const viewport = reactFlowInstance.getViewport();
      const baselineX = homeViewportBaselineXRef.current ?? viewport.x;
      const baselineY = homeViewportBaselineYRef.current ?? viewport.y;

      homeViewportBaselineXRef.current = baselineX;
      homeViewportBaselineYRef.current = baselineY;
      homeCanvasGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffsetY: clamp(
          viewport.y - baselineY,
          -getHomeCanvasPanBounds().up,
          getHomeCanvasPanBounds().down,
        ),
        baselineX,
        baselineY,
        mode: "pending",
        captured: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = homeCanvasGestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;

      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;

      if (gesture.mode === "pending") {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (
          Math.max(absX, absY) < HOME_CANVAS_PAN_ACTIVATION_DISTANCE
        ) {
          return;
        }

        gesture.mode = absY >= absX ? "vertical" : "horizontal";
        gestureTarget.setPointerCapture?.(event.pointerId);
        gesture.captured = true;
      }

      event.preventDefault();
      event.stopPropagation();

      if (gesture.mode === "horizontal") {
        void reactFlowInstance.setViewport(
          {
            ...reactFlowInstance.getViewport(),
            x: gesture.baselineX,
          },
          { duration: 0 },
        );
        return;
      }

      const panBounds = getHomeCanvasPanBounds();
      const nextOffsetY = clamp(
        gesture.startOffsetY + deltaY,
        -panBounds.up,
        panBounds.down,
      );

      homeCanvasPanOffsetYRef.current = nextOffsetY;
      onHomeCanvasPanOffsetChange?.(nextOffsetY);
      void reactFlowInstance.setViewport(
        {
          ...reactFlowInstance.getViewport(),
          x: gesture.baselineX,
          y: gesture.baselineY + nextOffsetY,
        },
        { duration: 0 },
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      stopGesture(event);
    };

    gestureTarget.addEventListener("pointerdown", handlePointerDown);
    gestureTarget.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    gestureTarget.addEventListener("pointerup", handlePointerUp);
    gestureTarget.addEventListener("pointercancel", handlePointerUp);

    return () => {
      gestureTarget.removeEventListener("pointerdown", handlePointerDown);
      gestureTarget.removeEventListener("pointermove", handlePointerMove);
      gestureTarget.removeEventListener("pointerup", handlePointerUp);
      gestureTarget.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    getHomeCanvasPanBounds,
    isHomeInlineComposer,
    onHomeCanvasPanOffsetChange,
    reactFlowInstance,
  ]);

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
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.25}
        maxZoom={1.7}
        zoomOnScroll={!isHomeInlineComposer}
        panOnScroll={false}
        panOnDrag={!isHomeInlineComposer}
        className="branchmind-grid h-full rounded-[28px] lg:rounded-none"
      >
        <Controls
          className={`!rounded-[18px] !border-white/80 !bg-white/80 !shadow-lg ${
            isHomeInlineComposer ? "!hidden lg:!flex" : ""
          }`}
        />
      </ReactFlow>
    </div>
  );
}
