"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { BaseEdge, useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";
import {
  getGrowthShapes,
  getStemLeaflets,
  getStemProgress,
  mix,
  stemPath,
  type HomeDemoGrowthShapes,
  type HomeDemoKind,
} from "@/lib/home-onboarding-demo";
import {
  NODE_GROWTH_DURATION_MS,
  NODE_GROWTH_LAYOUT,
  getEdgeStem,
  getNodeGrowthBase,
} from "@/lib/node-growth";

export type BranchEdgeData = {
  kind: HomeDemoKind;
  /** performance.now() when the child node started growing; unset once it has settled. */
  growthStartedAt?: number;
};

export type BranchEdgeType = Edge<BranchEdgeData, "branchEdge">;

// React Flow dashes and animates every path inside a highlighted (animated) edge.
// The foliage and the growth mask must stay as drawn.
const STATIC_PATH_STYLE: CSSProperties = {
  strokeDasharray: "none",
  animation: "none",
  pointerEvents: "none",
};

const kindColor = (kind: HomeDemoKind) =>
  kind === "continue" ? "var(--node-handle-continue)" : "var(--node-handle-branch)";

/** Seconds since `startedAt`, updated every frame until the growth has settled. */
function useGrowthSeconds(startedAt: number | undefined) {
  const [seconds, setSeconds] = useState<{ startedAt: number; value: number } | null>(null);

  useEffect(() => {
    if (startedAt === undefined) return undefined;
    let frame = 0;
    const tick = () => {
      const value = Math.max(0, (performance.now() - startedAt) / 1000);
      setSeconds({ startedAt, value });
      if (value * 1000 < NODE_GROWTH_DURATION_MS) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [startedAt]);

  if (startedAt === undefined) return null;
  // Before the first frame, render the very start of the growth rather than the full edge.
  return seconds?.startedAt === startedAt ? seconds.value : 0;
}

export function BranchEdge({
  id,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  style,
}: EdgeProps<BranchEdgeType>) {
  const kind = data?.kind ?? "continue";
  const stem = useMemo(
    () => getEdgeStem({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, kind),
    [kind, sourceX, sourceY, targetX, targetY],
  );
  const path = useMemo(() => stemPath(stem), [stem]);
  const settledLeaflets = useMemo(() => getStemLeaflets(stem, kind, 1), [kind, stem]);
  const seconds = useGrowthSeconds(data?.growthStartedAt);
  const targetNode = useInternalNode(target);
  const growing = seconds !== null && seconds * 1000 < NODE_GROWTH_DURATION_MS;

  let shapes: HomeDemoGrowthShapes | null = null;
  const width = targetNode?.measured.width;
  const height = targetNode?.measured.height;
  if (growing && targetNode && width && height) {
    const box = {
      x: targetNode.internals.positionAbsolute.x,
      y: targetNode.internals.positionAbsolute.y,
      width,
      height,
    };
    shapes = getGrowthShapes(kind, stem, box, seconds, NODE_GROWTH_LAYOUT, getNodeGrowthBase(box, kind));
  }

  const stemProgress = shapes?.stemProgress ?? (growing ? getStemProgress(seconds) : 1);
  const leaflets =
    shapes?.leaflets ?? (growing ? getStemLeaflets(stem, kind, stemProgress) : settledLeaflets);
  const color = kindColor(kind);
  const maskId = `branch-edge-growth-${id}`;
  const leaf = shapes?.leaf ?? null;

  let maskBounds: { x: number; y: number; width: number; height: number } | null = null;
  if (stemProgress < 1) {
    const xs = stem.map((point) => point.x);
    const ys = stem.map((point) => point.y);
    const pad = 24;
    maskBounds = {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      width: Math.max(...xs) - Math.min(...xs) + pad * 2,
      height: Math.max(...ys) - Math.min(...ys) + pad * 2,
    };
  }

  return (
    <>
      {maskBounds && (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" {...maskBounds}>
            <path
              d={path}
              fill="none"
              stroke="#fff"
              strokeWidth={8}
              strokeLinecap="round"
              pathLength={1}
              style={{
                ...STATIC_PATH_STYLE,
                strokeDasharray: "1 1",
                strokeDashoffset: 1 - stemProgress,
              }}
            />
          </mask>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        mask={maskBounds ? `url(#${maskId})` : undefined}
      />
      <g data-testid="branch-edge-foliage" data-edge-id={id}>
        {leaflets.map((leaflet, index) => (
          <path
            key={index}
            d={leaflet.path}
            style={{ ...STATIC_PATH_STYLE, fill: color, fillOpacity: 0.5 }}
          />
        ))}
        {shapes?.budPath && (
          <path d={shapes.budPath} style={{ ...STATIC_PATH_STYLE, fill: color, fillOpacity: 0.6 }} />
        )}
        {leaf && shapes && (
          <g data-testid="branch-edge-growth-leaf" opacity={1 - shapes.cardOpacity}>
            <path
              d={leaf.path}
              style={{
                ...STATIC_PATH_STYLE,
                fill: `color-mix(in srgb, ${color} ${((1 - leaf.morph) * 100).toFixed(1)}%, var(--theme-surface-elevated))`,
                fillOpacity: mix(0.4, 0.8, leaf.morph),
              }}
            />
            <path
              d={leaf.path}
              fill="none"
              strokeWidth={1.4}
              style={{ ...STATIC_PATH_STYLE, stroke: color, strokeOpacity: 0.75 * (1 - leaf.morph) }}
            />
            <path
              d={leaf.path}
              fill="none"
              strokeWidth={1.5}
              style={{
                ...STATIC_PATH_STYLE,
                stroke: color,
                strokeOpacity: 0.6 * leaf.morph,
                strokeDasharray: "6 5",
              }}
            />
            {leaf.midrib && (
              <line
                {...leaf.midrib}
                strokeWidth={1.2}
                strokeLinecap="round"
                style={{ ...STATIC_PATH_STYLE, stroke: color, strokeOpacity: 0.55 * (1 - leaf.morph) }}
              />
            )}
          </g>
        )}
      </g>
    </>
  );
}
