"use client";

import {
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EyeOff } from "lucide-react";
import {
  Controls,
  ReactFlow,
  applyNodeChanges,
  getViewportForBounds,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type OnMoveStart,
  type OnNodeDrag,
  type ReactFlowInstance,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import { getVisibleNodeIds } from "@/lib/graph";
import {
  HOME_DEMO_CAMERA_STEP,
  HOME_DEMO_COMPACT_LAYOUT,
  HOME_DEMO_COMPACT_MEDIA_QUERY,
  HOME_DEMO_IDLE_REPLAY_MS,
  HOME_DEMO_REGULAR_LAYOUT,
  getStemProgress,
  mix,
  stepCamera,
  type HomeDemoCameraState,
  type HomeDemoKind,
} from "@/lib/home-onboarding-demo";
import { NODE_GROWTH_DURATION_MS, getGrowthCameraTarget } from "@/lib/node-growth";
import type { NodePosition, Project } from "@/lib/types";
import { BranchEdge, type BranchEdgeType } from "./BranchEdge";
import {
  BranchNodeCard,
  type BranchNodeData,
  type InlineNodeComposerData,
  type MobileLongPressStart,
} from "./BranchNodeCard";
import { HomeOnboardingDemo, type HomeOnboardingDemoPhase } from "./HomeOnboardingDemo";

const HOME_CANVAS_PAN_RANGE_RATIO = 1 / 5;
const HOME_COMPOSER_INITIAL_OFFSET_Y = 16;
const HOME_COMPOSER_FIT_PADDING = 0.1;
const MIND_MAP_MIN_ZOOM = 0.25;
const HOME_CANVAS_WHEEL_PAN_SPEED = 0.5;
const HOME_HERO_MIN_VISIBLE_TOP = 16;
const HOME_CANVAS_PAN_ACTIVATION_DISTANCE = 6;
const LINE_SCROLL_DELTA_MULTIPLIER = 20;
const MOBILE_ROOT_FOCUS_MEDIA_QUERY = "(max-width: 1023px)";
const MOBILE_ROOT_FOCUS_ZOOM = 1.15;
const MOBILE_NODE_LONG_PRESS_DELAY_MS = 450;
const MOBILE_NODE_LONG_PRESS_CANCEL_DISTANCE = 8;
const MOBILE_NODE_DRAG_LOCKED_THRESHOLD = 100_000;
const MOBILE_NODE_DRAG_ACTIVE_THRESHOLD = 1;
const MOBILE_MOUSE_LONG_PRESS_POINTER_ID = -1;
const NODE_FOCUS_FALLBACK_WIDTH = 292;
const NODE_FOCUS_FALLBACK_HEIGHT = 220;

const nodeTypes: NodeTypes = {
  branchNode: BranchNodeCard,
};
const edgeTypes: EdgeTypes = {
  branchEdge: BranchEdge,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type MindMapProps = {
  project: Project;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onCreateNode: (nodeId: string, mode: "continue" | "branch") => void | Promise<void>;
  onToggleNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  inlineNodeComposer?: InlineNodeComposerData;
  onHomeCanvasPanOffsetChange?: (offsetY: number) => void;
  homeCanvasLeftInset?: number;
  /** Width of a desktop sidebar floating over the left of the canvas. */
  canvasLeftInset?: number;
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

type MobileNodeLongPressGesture = {
  nodeId: string;
  pointerId: number;
  startX: number;
  startY: number;
  startNodePosition: NodePosition;
  startFlowPosition: NodePosition | null;
  latestPosition: NodePosition | null;
  timerId: number;
  activated: boolean;
  moved: boolean;
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
  homeCanvasLeftInset = 0,
  canvasLeftInset = 0,
}: MindMapProps) {
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const homeCanvasPanOffsetYRef = useRef(0);
  const homeCanvasGestureRef = useRef<HomeCanvasGesture | null>(null);
  const homeViewportBaselineXRef = useRef<number | null>(null);
  const homeViewportBaselineYRef = useRef<number | null>(null);
  const homeCenterRequestRef = useRef(0);
  const previousFlowBoundsRef = useRef<DOMRectReadOnly | null>(null);
  const previousProjectIdRef = useRef<string | null>(null);
  const previousNodeIdsRef = useRef<Set<string>>(new Set());
  const nodeEntranceTimersRef = useRef<Set<number>>(new Set());
  const mobileRootFocusProjectIdRef = useRef<string | null>(null);
  const mobileRootFocusPendingRef = useRef(false);
  const mobileNodeLongPressGestureRef =
    useRef<MobileNodeLongPressGesture | null>(null);
  const activeMobileNodeDragIdRef = useRef<string | null>(null);
  const suppressMobileNodeClickRef = useRef<string | null>(null);
  const visibleNodeIds = useMemo(() => getVisibleNodeIds(project), [project]);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileLongPressDragNodeId, setMobileLongPressDragNodeId] =
    useState<string | null>(null);
  const [enteringNodeIds, setEnteringNodeIds] = useState<Map<string, number>>(
    () => new Map(),
  );
  const growthCameraFrameRef = useRef(0);
  const canvasLeftInsetRef = useRef(canvasLeftInset);
  useLayoutEffect(() => {
    canvasLeftInsetRef.current = canvasLeftInset;
  }, [canvasLeftInset]);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance<Node<BranchNodeData>, BranchEdgeType> | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const isHomeInlineComposer = inlineNodeComposer?.variant === "home";
  const homeComposerNodeId = isHomeInlineComposer ? inlineNodeComposer?.nodeId : null;
  const homeOnboardingDemo = isHomeInlineComposer ? inlineNodeComposer?.onboardingDemo : undefined;
  const hasHomeOnboardingDemo = Boolean(homeOnboardingDemo);
  const autoPlayHomeDemo = homeOnboardingDemo?.autoPlay ?? false;
  const isHomeComposerBusy = inlineNodeComposer?.isBusy ?? false;
  const [homeDemoPhase, setHomeDemoPhase] = useState<HomeOnboardingDemoPhase | "off">("off");
  // Read by the native pointer/wheel listeners and by centerHomeComposer, which must not
  // wait for a re-render after the demo is dismissed.
  const homeDemoPhaseRef = useRef<HomeOnboardingDemoPhase | "off">("off");
  const homeDemoStartedRef = useRef(false);
  const homeDemoDismissRef = useRef<(() => void) | null>(null);
  const mobileLongPressDragEnabled =
    isMobileViewport && !isHomeInlineComposer;

  const resetMobileNodeLongPressState = useCallback((suppressClick = false) => {
    const gesture = mobileNodeLongPressGestureRef.current;
    const nodeIdToSuppress =
      gesture?.nodeId ?? activeMobileNodeDragIdRef.current ?? null;

    if (gesture) {
      window.clearTimeout(gesture.timerId);
    }

    if ((suppressClick || gesture?.activated) && nodeIdToSuppress) {
      suppressMobileNodeClickRef.current = nodeIdToSuppress;
    }

    mobileNodeLongPressGestureRef.current = null;
    activeMobileNodeDragIdRef.current = null;
    setMobileLongPressDragNodeId(null);
  }, []);

  const handleMobileNodeLongPressStart = useCallback(
    (nodeId: string, event: MobileLongPressStart) => {
      if (!mobileLongPressDragEnabled) return;
      if (!reactFlowInstance) return;
      if (!event.isPrimary || event.button !== 0) return;

      const node = project.nodes[nodeId];
      if (!node) return;

      resetMobileNodeLongPressState(false);

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const timerId = window.setTimeout(() => {
        const gesture = mobileNodeLongPressGestureRef.current;
        if (!gesture || gesture.pointerId !== pointerId || gesture.nodeId !== nodeId) {
          return;
        }

        gesture.activated = true;
        gesture.startFlowPosition = reactFlowInstance.screenToFlowPosition({
          x: gesture.startX,
          y: gesture.startY,
        });
        gesture.latestPosition = gesture.startNodePosition;
        activeMobileNodeDragIdRef.current = nodeId;
        setMobileLongPressDragNodeId(nodeId);
      }, MOBILE_NODE_LONG_PRESS_DELAY_MS);

      mobileNodeLongPressGestureRef.current = {
        nodeId,
        pointerId,
        startX,
        startY,
        startNodePosition: node.position,
        startFlowPosition: null,
        latestPosition: null,
        timerId,
        activated: false,
        moved: false,
      };
    },
    [mobileLongPressDragEnabled, project.nodes, reactFlowInstance, resetMobileNodeLongPressState],
  );

  const consumeMobileNodeClickSuppression = useCallback((nodeId: string) => {
    if (suppressMobileNodeClickRef.current !== nodeId) return false;

    suppressMobileNodeClickRef.current = null;
    return true;
  }, []);

  const graphNodes = useMemo<Node<BranchNodeData>[]>(() => {
    return Object.values(project.nodes)
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => ({
        id: node.id,
        type: "branchNode",
        position: node.position,
        selected: selectedNodeId === node.id,
        dragHandle: ".branch-node-edge-hit-area",
        // While the onboarding demo runs, clicks must reach the demo card under this node.
        // React Flow sets pointer-events inline on the node wrapper, so override it via style.
        ...(homeDemoPhase !== "off" && node.id === homeComposerNodeId
          ? { className: "home-demo-composer-node", style: { pointerEvents: "none" as const } }
          : {}),
        data: {
          mindNode: node,
          selected: selectedNodeId === node.id,
          isEntering: enteringNodeIds.has(node.id),
          onSelect: onSelectNode,
          onCreate: onCreateNode,
          onToggle: onToggleNode,
          isStreaming: streamingNodeId === node.id,
          creationDisabled: Boolean(creatingNodeId),
          mobileLongPressDragEnabled,
          mobileLongPressDragging: mobileLongPressDragNodeId === node.id,
          onMobileLongPressStart: handleMobileNodeLongPressStart,
          consumeMobileNodeClickSuppression,
          inlineComposer:
            inlineNodeComposer?.nodeId === node.id ? inlineNodeComposer : undefined,
        },
      }));
  }, [
    creatingNodeId,
    homeComposerNodeId,
    homeDemoPhase,
    inlineNodeComposer,
    consumeMobileNodeClickSuppression,
    handleMobileNodeLongPressStart,
    mobileLongPressDragEnabled,
    mobileLongPressDragNodeId,
    onCreateNode,
    onSelectNode,
    onToggleNode,
    project.nodes,
    selectedNodeId,
    streamingNodeId,
    visibleNodeIds,
    enteringNodeIds,
  ]);
  const [nodes, setNodes] = useState(graphNodes);

  const graphEdges = useMemo<BranchEdgeType[]>(() => {
    return Object.values(project.nodes).flatMap((node) =>
      node.children
        .filter((childId) => visibleNodeIds.has(node.id) && visibleNodeIds.has(childId))
        .map((childId): BranchEdgeType => {
          const child = project.nodes[childId];
          const isBranchChild = child?.branchType === "branch";
          const kind: HomeDemoKind = isBranchChild ? "branch" : "continue";
          const isHighlighted = selectedNodeId === node.id || selectedNodeId === childId;
          return {
            id: `${node.id}-${childId}`,
            type: "branchEdge",
            source: node.id,
            target: childId,
            sourceHandle: isBranchChild ? "branch-source" : "continue-source",
            targetHandle: isBranchChild ? "branch-target" : "continue-target",
            animated: isHighlighted,
            data: {
              kind,
              growthStartedAt: enteringNodeIds.get(childId),
            },
            style: {
              stroke: isBranchChild
                ? "var(--node-handle-branch)"
                : "var(--node-handle-continue)",
              // 继续与分支用同一种虚线茎；方向（向下 / 向右）和颜色区分两者。
              strokeWidth: 2,
              strokeDasharray: "6 5",
            },
          };
        }),
    );
  }, [enteringNodeIds, project.nodes, selectedNodeId, visibleNodeIds]);

  const fitViewOptions = useMemo(
    () => ({
      // Keep the initial workspace view readable. Users can still zoom in manually
      // up to the ReactFlow maxZoom below after the canvas has opened.
      maxZoom: 1,
    }),
    [],
  );

  const offsetHomeViewport = useCallback(
    (viewport: Viewport): Viewport => {
      const leftInset = window.matchMedia("(min-width: 1024px)").matches
        ? homeCanvasLeftInset
        : 0;
      return {
        ...viewport,
        x: viewport.x + leftInset / 2,
        y: viewport.y + HOME_COMPOSER_INITIAL_OFFSET_Y,
      };
    },
    [homeCanvasLeftInset],
  );

  // Same result as centerHomeComposer, computed synchronously so the onboarding demo can
  // read it every frame without touching the real viewport.
  const getHomeDemoViewport = useCallback(() => {
    const container = flowContainerRef.current;
    if (!reactFlowInstance || !homeComposerNodeId || !container) return null;
    const bounds = reactFlowInstance.getNodesBounds([homeComposerNodeId]);
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return offsetHomeViewport(
      getViewportForBounds(
        bounds,
        container.clientWidth,
        container.clientHeight,
        MIND_MAP_MIN_ZOOM,
        1,
        HOME_COMPOSER_FIT_PADDING,
      ),
    );
  }, [homeComposerNodeId, offsetHomeViewport, reactFlowInstance]);

  const centerHomeComposer = useCallback(() => {
    if (!reactFlowInstance || !homeComposerNodeId) return;
    // The onboarding demo drives the camera itself and returns it to this same viewport.
    if (homeDemoPhaseRef.current !== "off") return;

    // React Flow shares one pending fitView promise between calls. Only the latest call may
    // apply the offsets below, otherwise each queued caller adds them again.
    const requestId = ++homeCenterRequestRef.current;
    void reactFlowInstance
      .fitView({
        nodes: [{ id: homeComposerNodeId }],
        maxZoom: 1,
        duration: 0,
      })
      .then(() => {
        if (requestId !== homeCenterRequestRef.current) return;
        if (homeDemoPhaseRef.current !== "off") return;
        const initialViewport = offsetHomeViewport(reactFlowInstance.getViewport());

        homeViewportBaselineYRef.current = initialViewport.y;
        homeViewportBaselineXRef.current = initialViewport.x;
        homeCanvasPanOffsetYRef.current = 0;
        onHomeCanvasPanOffsetChange?.(0);
        void reactFlowInstance.setViewport(initialViewport, { duration: 0 });
      });
  }, [homeComposerNodeId, offsetHomeViewport, onHomeCanvasPanOffsetChange, reactFlowInstance]);

  useLayoutEffect(() => {
    homeDemoDismissRef.current = homeOnboardingDemo?.onDismiss ?? null;
  });

  const startHomeDemo = useCallback(() => {
    if (homeDemoPhaseRef.current !== "off") return;
    homeDemoStartedRef.current = true;
    homeDemoPhaseRef.current = "playing";
    setHomeDemoPhase("playing");
  }, []);

  // Layout effect: switch to "playing" before the first paint so the real composer never
  // flashes before the demo card covers it.
  useLayoutEffect(() => {
    if (!autoPlayHomeDemo || homeDemoStartedRef.current) return;
    startHomeDemo();
  }, [autoPlayHomeDemo, startHomeDemo]);

  const getFlowContainer = useCallback(() => flowContainerRef.current, []);

  const focusHomeComposerInput = useCallback(() => {
    flowContainerRef.current
      ?.querySelector<HTMLTextAreaElement>(
        ".branch-node-card-surface[data-home-composer='true'] textarea[data-testid='message-instruction-input']",
      )
      ?.focus({ preventScroll: true });
  }, []);

  const dismissHomeDemo = useCallback(() => {
    if (homeDemoPhaseRef.current !== "playing") return;
    homeDemoPhaseRef.current = "closing";
    setHomeDemoPhase("closing");
    homeDemoDismissRef.current?.();
  }, []);

  const handleHomeDemoCardPointerDown = useCallback(() => {
    dismissHomeDemo();
    focusHomeComposerInput();
  }, [dismissHomeDemo, focusHomeComposerInput]);

  const handleHomeDemoFocusCapture = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      if (homeDemoPhaseRef.current !== "playing") return;
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".home-demo-composer-node, [data-home-composer='true']")) return;
      dismissHomeDemo();
    },
    [dismissHomeDemo],
  );

  const handleHomeDemoFinished = useCallback(() => {
    homeDemoPhaseRef.current = "off";
    setHomeDemoPhase("off");
  }, []);

  useEffect(() => {
    if (homeDemoPhase !== "off" || !homeDemoStartedRef.current) return undefined;
    // Re-sync the pan baseline once the demo has handed the camera back.
    const animationFrame = window.requestAnimationFrame(centerHomeComposer);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [centerHomeComposer, homeDemoPhase]);

  useEffect(() => {
    if (!hasHomeOnboardingDemo || homeDemoPhase !== "off" || isHomeComposerBusy) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timerId: number | undefined;
    let isComposing = false;

    const scheduleReplay = () => {
      window.clearTimeout(timerId);
      if (document.visibilityState !== "visible" || reducedMotion.matches) return;

      timerId = window.setTimeout(() => {
        if (document.visibilityState !== "visible" || reducedMotion.matches || isComposing) return;
        const container = flowContainerRef.current;
        const workspace = container?.closest("[data-draft-workspace='true']");
        if (!container || !workspace) return;
        const hasDraft = Array.from(workspace.querySelectorAll("textarea"))
          .some((input) => input.value.trim().length > 0);
        const hasAttachment = workspace.querySelector("[data-testid='pending-attachment-chip']");
        const hasOpenOverlay = document.querySelector("[role='dialog'], [role='menu']");
        if (hasDraft || hasAttachment || hasOpenOverlay) return;

        if (document.activeElement instanceof HTMLElement && container.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        startHomeDemo();
      }, HOME_DEMO_IDLE_REPLAY_MS);
    };

    const handleCompositionStart = () => {
      isComposing = true;
      scheduleReplay();
    };
    const handleCompositionEnd = () => {
      isComposing = false;
      scheduleReplay();
    };
    const activityEvents = ["pointerdown", "pointermove", "keydown", "input", "wheel", "focusin"] as const;
    for (const event of activityEvents) {
      window.addEventListener(event, scheduleReplay, { capture: true, passive: true });
    }
    window.addEventListener("compositionstart", handleCompositionStart, true);
    window.addEventListener("compositionend", handleCompositionEnd, true);
    document.addEventListener("visibilitychange", scheduleReplay);
    reducedMotion.addEventListener("change", scheduleReplay);
    scheduleReplay();

    return () => {
      window.clearTimeout(timerId);
      for (const event of activityEvents) window.removeEventListener(event, scheduleReplay, true);
      window.removeEventListener("compositionstart", handleCompositionStart, true);
      window.removeEventListener("compositionend", handleCompositionEnd, true);
      document.removeEventListener("visibilitychange", scheduleReplay);
      reducedMotion.removeEventListener("change", scheduleReplay);
    };
  }, [hasHomeOnboardingDemo, homeDemoPhase, isHomeComposerBusy, startHomeDemo]);

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
    const draggingNodeId =
      draggingNodeIdRef.current ?? activeMobileNodeDragIdRef.current;
    if (!draggingNodeId) {
      setNodes(graphNodes);
      return;
    }

    // Keep the in-progress drag position while streaming updates rebuild the nodes.
    setNodes((current) => {
      const draggedNode = current.find((node) => node.id === draggingNodeId);
      if (!draggedNode) return graphNodes;
      return graphNodes.map((node) =>
        node.id === draggingNodeId ? { ...node, position: draggedNode.position } : node,
      );
    });
  }, [graphNodes]);

  const stopGrowthCamera = useCallback(() => {
    window.cancelAnimationFrame(growthCameraFrameRef.current);
    growthCameraFrameRef.current = 0;
  }, []);

  // Same camera as the home demo: the target follows the growing stem tip and a critically
  // damped spring chases it, then rests with the new node framed.
  const startGrowthCamera = useCallback(
    (nodeId: string, kind: HomeDemoKind, startedAt: number) => {
      if (!reactFlowInstance) return;
      stopGrowthCamera();

      const from = reactFlowInstance.getViewport();
      const layout = window.matchMedia(HOME_DEMO_COMPACT_MEDIA_QUERY).matches
        ? HOME_DEMO_COMPACT_LAYOUT
        : HOME_DEMO_REGULAR_LAYOUT;
      let state: HomeDemoCameraState = { x: from.x, y: from.y, vx: 0, vy: 0 };
      let lastNow = startedAt;

      const tick = (now: number) => {
        const container = flowContainerRef.current;
        const node = reactFlowInstance.getInternalNode(nodeId);
        if (!container || !node) {
          growthCameraFrameRef.current = 0;
          return;
        }

        const target = getGrowthCameraTarget(
          from,
          {
            x: node.internals.positionAbsolute.x,
            y: node.internals.positionAbsolute.y,
            width: node.measured.width ?? NODE_FOCUS_FALLBACK_WIDTH,
            height: node.measured.height ?? NODE_FOCUS_FALLBACK_HEIGHT,
          },
          kind,
          {
            width: container.clientWidth,
            height: container.clientHeight,
            leftInset: window.matchMedia("(min-width: 1024px)").matches
              ? canvasLeftInsetRef.current
              : 0,
          },
          layout,
        );
        const progress = getStemProgress(Math.max(0, (now - startedAt) / 1000));
        const goal = {
          x: mix(from.x, target.x, progress),
          y: mix(from.y, target.y, progress),
          zoom: from.zoom,
        };
        const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
        lastNow = now;
        for (let s = 0; s < dt; s += HOME_DEMO_CAMERA_STEP) {
          state = stepCamera(state, goal, Math.min(HOME_DEMO_CAMERA_STEP, dt - s));
        }

        const settled =
          progress >= 1 &&
          Math.abs(state.x - target.x) < 0.5 &&
          Math.abs(state.y - target.y) < 0.5 &&
          Math.hypot(state.vx, state.vy) < 4;
        if (settled) {
          growthCameraFrameRef.current = 0;
          void reactFlowInstance.setViewport(
            { x: target.x, y: target.y, zoom: from.zoom },
            { duration: 0 },
          );
          return;
        }

        void reactFlowInstance.setViewport(
          { x: state.x, y: state.y, zoom: from.zoom },
          { duration: 0 },
        );
        growthCameraFrameRef.current = window.requestAnimationFrame(tick);
      };

      growthCameraFrameRef.current = window.requestAnimationFrame(tick);
    },
    [reactFlowInstance, stopGrowthCamera],
  );

  // A user pan or zoom takes the camera back; programmatic moves have no event.
  const handleMoveStart: OnMoveStart = useCallback(
    (event) => {
      if (event) stopGrowthCamera();
    },
    [stopGrowthCamera],
  );

  useEffect(() => {
    const currentNodeIds = new Set(graphNodes.map((node) => node.id));

    if (previousProjectIdRef.current !== project.id) {
      nodeEntranceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      nodeEntranceTimersRef.current.clear();
      stopGrowthCamera();
      previousProjectIdRef.current = project.id;
      previousNodeIdsRef.current = currentNodeIds;
      setEnteringNodeIds(new Map());
      return;
    }

    const newChild = graphNodes.find(
      (node) =>
        !previousNodeIdsRef.current.has(node.id) &&
        node.data.mindNode.parentId === creatingNodeId,
    );

    if (!newChild) {
      previousNodeIdsRef.current = currentNodeIds;
      return;
    }
    if (!reactFlowInstance) return;

    previousNodeIdsRef.current = currentNodeIds;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.requestAnimationFrame(() => {
        const renderedNode = reactFlowInstance.getNode(newChild.id);
        void reactFlowInstance.setCenter(
          newChild.position.x + (renderedNode?.measured?.width ?? NODE_FOCUS_FALLBACK_WIDTH) / 2,
          newChild.position.y + (renderedNode?.measured?.height ?? NODE_FOCUS_FALLBACK_HEIGHT) / 2,
          { zoom: reactFlowInstance.getZoom(), duration: 0 },
        );
      });
      return;
    }

    const startedAt = performance.now();
    const kind: HomeDemoKind =
      newChild.data.mindNode.branchType === "branch" ? "branch" : "continue";
    setEnteringNodeIds((current) => new Map(current).set(newChild.id, startedAt));
    startGrowthCamera(newChild.id, kind, startedAt);

    const timer = window.setTimeout(() => {
      nodeEntranceTimersRef.current.delete(timer);
      setEnteringNodeIds((current) => {
        if (!current.has(newChild.id)) return current;
        const next = new Map(current);
        next.delete(newChild.id);
        return next;
      });
    }, NODE_GROWTH_DURATION_MS);
    nodeEntranceTimersRef.current.add(timer);
  }, [
    creatingNodeId,
    graphNodes,
    project.id,
    reactFlowInstance,
    startGrowthCamera,
    stopGrowthCamera,
  ]);

  useEffect(
    () => () => {
      nodeEntranceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      nodeEntranceTimersRef.current.clear();
      window.cancelAnimationFrame(growthCameraFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_ROOT_FOCUS_MEDIA_QUERY);
    const updateMobileViewport = () => setIsMobileViewport(mobileQuery.matches);

    updateMobileViewport();
    mobileQuery.addEventListener("change", updateMobileViewport);
    return () => mobileQuery.removeEventListener("change", updateMobileViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport || !reactFlowInstance) {
      resetMobileNodeLongPressState(false);
      return undefined;
    }

    const handleMobileLongPressMove = (
      pointerId: number,
      clientX: number,
      clientY: number,
      event: PointerEvent | MouseEvent | TouchEvent,
    ) => {
      const gesture = mobileNodeLongPressGestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) {
        return;
      }

      const deltaX = clientX - gesture.startX;
      const deltaY = clientY - gesture.startY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (gesture.activated) {
        const startFlowPosition = gesture.startFlowPosition;
        if (!startFlowPosition) return;

        event.preventDefault();
        const nextFlowPosition = reactFlowInstance.screenToFlowPosition({
          x: clientX,
          y: clientY,
        });
        const nextPosition = {
          x: gesture.startNodePosition.x + nextFlowPosition.x - startFlowPosition.x,
          y: gesture.startNodePosition.y + nextFlowPosition.y - startFlowPosition.y,
        };

        gesture.latestPosition = nextPosition;
        gesture.moved = distance > MOBILE_NODE_LONG_PRESS_CANCEL_DISTANCE;
        setNodes((current) =>
          current.map((node) =>
            node.id === gesture.nodeId ? { ...node, position: nextPosition } : node,
          ),
        );
        return;
      }

      if (distance <= MOBILE_NODE_LONG_PRESS_CANCEL_DISTANCE) return;

      window.clearTimeout(gesture.timerId);
      mobileNodeLongPressGestureRef.current = null;
    };

    const handleMobileLongPressEnd = (pointerId: number) => {
      const gesture = mobileNodeLongPressGestureRef.current;
      if (!gesture || gesture.pointerId !== pointerId) return;

      if (gesture.activated && gesture.moved && gesture.latestPosition) {
        void onMoveNode(gesture.nodeId, gesture.latestPosition);
      }

      resetMobileNodeLongPressState(gesture.activated);
    };

    const handlePointerMove = (event: PointerEvent) => {
      handleMobileLongPressMove(event.pointerId, event.clientX, event.clientY, event);
    };
    const handlePointerEnd = (event: PointerEvent) => {
      handleMobileLongPressEnd(event.pointerId);
    };
    const handleMouseMove = (event: MouseEvent) => {
      handleMobileLongPressMove(
        MOBILE_MOUSE_LONG_PRESS_POINTER_ID,
        event.clientX,
        event.clientY,
        event,
      );
    };
    const handleMouseEnd = () => {
      handleMobileLongPressEnd(MOBILE_MOUSE_LONG_PRESS_POINTER_ID);
    };
    const handleTouchMove = (event: TouchEvent) => {
      const gesture = mobileNodeLongPressGestureRef.current;
      if (!gesture) return;

      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === gesture.pointerId,
      );
      if (!touch) return;

      handleMobileLongPressMove(
        touch.identifier,
        touch.clientX,
        touch.clientY,
        event,
      );
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = mobileNodeLongPressGestureRef.current;
      if (!gesture) return;

      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === gesture.pointerId,
      );
      if (!touch) return;

      handleMobileLongPressEnd(touch.identifier);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", handleMouseEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isMobileViewport, onMoveNode, reactFlowInstance, resetMobileNodeLongPressState]);

  useEffect(() => {
    resetMobileNodeLongPressState(false);
  }, [
    isHomeInlineComposer,
    project.id,
    resetMobileNodeLongPressState,
  ]);

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
    mobileRootFocusProjectIdRef.current = null;
    mobileRootFocusPendingRef.current = false;
  }, [project.id]);

  const focusMobileRootNode = useCallback(() => {
    if (!reactFlowInstance || isHomeInlineComposer) return;
    if (mobileRootFocusProjectIdRef.current === project.id) return;
    if (mobileRootFocusPendingRef.current) return;
    if (!window.matchMedia(MOBILE_ROOT_FOCUS_MEDIA_QUERY).matches) return;
    if (!graphNodes.some((node) => node.id === project.rootNodeId)) return;

    const container = flowContainerRef.current;
    const bounds = container?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;

    mobileRootFocusPendingRef.current = true;
    void reactFlowInstance
      .fitView({
        nodes: [{ id: project.rootNodeId }],
        minZoom: MOBILE_ROOT_FOCUS_ZOOM,
        maxZoom: MOBILE_ROOT_FOCUS_ZOOM,
        duration: 0,
      })
      .then((didFit) => {
        if (didFit) {
          mobileRootFocusProjectIdRef.current = project.id;
        }
      })
      .finally(() => {
        mobileRootFocusPendingRef.current = false;
      });
  }, [
    graphNodes,
    isHomeInlineComposer,
    project.id,
    project.rootNodeId,
    reactFlowInstance,
  ]);

  useEffect(() => {
    if (!reactFlowInstance || isHomeInlineComposer) return undefined;

    const container = flowContainerRef.current;
    if (!container) return undefined;

    let animationFrame = 0;
    const scheduleFocusRoot = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(focusMobileRootNode);
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleFocusRoot);

    scheduleFocusRoot();
    observer?.observe(container);
    window.addEventListener("resize", scheduleFocusRoot);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleFocusRoot);
    };
  }, [focusMobileRootNode, isHomeInlineComposer, reactFlowInstance]);

  const preserveViewportPosition = useCallback(() => {
    if (!reactFlowInstance || isHomeInlineComposer) return;
    const container = flowContainerRef.current;
    if (!container) return;

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
  }, [isHomeInlineComposer, reactFlowInstance]);

  useLayoutEffect(() => {
    preserveViewportPosition();
  });

  useEffect(() => {
    if (!reactFlowInstance || isHomeInlineComposer) return undefined;

    let animationFrame = 0;
    const schedulePreserveViewportPosition = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(preserveViewportPosition);
    };
    const container = flowContainerRef.current;
    if (!container) return undefined;

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
  }, [
    isHomeInlineComposer,
    preserveViewportPosition,
    reactFlowInstance,
    project.id,
  ]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current) as Node<BranchNodeData>[]);
    },
    [],
  );

  const handleNodeClick = useCallback(
    (_: ReactMouseEvent, node: Node<BranchNodeData>) => {
      if (consumeMobileNodeClickSuppression(node.id)) return;

      onSelectNode(node.id);
    },
    [consumeMobileNodeClickSuppression, onSelectNode],
  );

  const handleNodeDragStart: OnNodeDrag<Node<BranchNodeData>> = useCallback(
    (_, node) => {
      draggingNodeIdRef.current = node.id;
      if (!isMobileViewport) return;

      activeMobileNodeDragIdRef.current = node.id;
      setMobileLongPressDragNodeId(node.id);
    },
    [isMobileViewport],
  );

  const handleNodeDragStop: OnNodeDrag<Node<BranchNodeData>> = useCallback(
    (_, node) => {
      draggingNodeIdRef.current = null;
      if (isMobileViewport) {
        resetMobileNodeLongPressState(true);
      }

      void onMoveNode(node.id, node.position);
    },
    [isMobileViewport, onMoveNode, resetMobileNodeLongPressState],
  );

  const handleViewportChange = useCallback(
    (viewport: Viewport) => {
      if (!isHomeInlineComposer) return;
      // setViewport from the demo also lands here; do not clamp or record it as a pan.
      if (homeDemoPhaseRef.current !== "off") return;

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
      if (homeDemoPhaseRef.current !== "off") return;

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
      if (homeDemoPhaseRef.current !== "off") return;

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
      data-home-demo={homeDemoPhase === "off" ? undefined : homeDemoPhase}
      onFocusCapture={homeDemoPhase === "playing" ? handleHomeDemoFocusCapture : undefined}
      className="h-full min-h-[360px]"
    >
      <ReactFlow
        aria-label="Interactive mind map canvas"
        data-testid="mind-map-react-flow"
        nodes={nodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!isMobileViewport}
        onInit={setReactFlowInstance}
        onNodeClick={handleNodeClick}
        onViewportChange={handleViewportChange}
        onMoveStart={handleMoveStart}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={MIND_MAP_MIN_ZOOM}
        maxZoom={1.7}
        nodeDragThreshold={
          isMobileViewport
            ? MOBILE_NODE_DRAG_LOCKED_THRESHOLD
            : MOBILE_NODE_DRAG_ACTIVE_THRESHOLD
        }
        zoomOnScroll={!isHomeInlineComposer}
        panOnScroll={false}
        panOnDrag={!isHomeInlineComposer}
        className="branchmind-grid h-full rounded-[28px] lg:rounded-none"
      >
        {!isHomeInlineComposer && (
          <Controls className="!rounded-[18px] !border-white/80 !bg-white/80 !shadow-lg" />
        )}
        {homeComposerNodeId && homeDemoPhase !== "off" && (
          <HomeOnboardingDemo
            rootNodeId={homeComposerNodeId}
            phase={homeDemoPhase}
            canvasLeftInset={homeCanvasLeftInset}
            getContainer={getFlowContainer}
            getHomeViewport={getHomeDemoViewport}
            onCardPointerDown={handleHomeDemoCardPointerDown}
            onCardClick={focusHomeComposerInput}
            onFinished={handleHomeDemoFinished}
          />
        )}
      </ReactFlow>
    </div>
  );
}
