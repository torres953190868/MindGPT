// Canvas edges and new-node growth, sharing the home onboarding demo's stem, leaf and
// camera math so a real "continue" / "branch" grows exactly like the demo.
// Pure functions only, so everything can be unit tested.

import {
  HOME_DEMO_REGULAR_LAYOUT,
  clamp01,
  getFramedViewport,
  type HomeDemoKind,
  type HomeDemoLayout,
  type HomeDemoPoint,
  type HomeDemoRect,
  type HomeDemoStem,
  type HomeDemoViewport,
} from "./home-onboarding-demo";

export const NODE_GROWTH_LAYOUT = HOME_DEMO_REGULAR_LAYOUT;
// The leaf has faded under the real card by 1.7s (see getGrowthShapes); a little slack
// before the edge drops back to its static look.
export const NODE_GROWTH_DURATION_MS = 1800;
const NODE_GROWTH_CAMERA_MARGIN = 24;
// React Flow's bezier curvature, used when a target sits behind its source.
const REVERSE_CURVATURE = 0.25;

const reachFor = (length: number) =>
  length > 0 ? length * 0.36 : REVERSE_CURVATURE * 25 * Math.sqrt(-length);

// The S is drawn around the straight line between the two handles, so a card that sits a
// little to one side neither cancels nor exaggerates it, and continue and branch stems get
// the same shape. Far-off cards (sibling lanes, dragged nodes) blend back to leaving each
// handle straight, like a bezier.
const CHORD_FOLLOW_DISTANCE = 80;
const HANDLE_HUG_DISTANCE = 280;
const lateralLean = (offset: number) =>
  offset *
  0.36 *
  (1 - clamp01((Math.abs(offset) - CHORD_FOLLOW_DISTANCE) / (HANDLE_HUG_DISTANCE - CHORD_FOLLOW_DISTANCE)));

// Sway grows with stem length so every stem keeps the demo branch's proportions (one shared
// proportion, so continue and branch stems look the same), within limits.
const MAX_SWAY_SCALE = 1.5;
const swayFor = (length: number, layout: HomeDemoLayout) =>
  layout.stem.amplitude * Math.min(MAX_SWAY_SCALE, Math.max(0, length / layout.stem.branchLength));

/**
 * S-shaped cubic between a source handle and a target handle. An aligned branch stem at the
 * demo length is exactly the demo's stem (see getStem); every other stem, continue included,
 * keeps the same proportions.
 */
export function getEdgeStem(
  source: HomeDemoPoint,
  target: HomeDemoPoint,
  kind: HomeDemoKind,
  layout: HomeDemoLayout = NODE_GROWTH_LAYOUT,
): HomeDemoStem {
  if (kind === "continue") {
    const length = target.y - source.y;
    const reach = reachFor(length);
    const amplitude = swayFor(length, layout);
    const lean = lateralLean(target.x - source.x);
    return [
      source,
      { x: source.x + amplitude + lean, y: source.y + reach },
      { x: target.x - amplitude - lean, y: target.y - reach },
      target,
    ];
  }
  const length = target.x - source.x;
  const reach = reachFor(length);
  const amplitude = swayFor(length, layout);
  const lean = lateralLean(target.y - source.y);
  return [
    source,
    { x: source.x + reach, y: source.y - amplitude + lean },
    { x: target.x - reach, y: target.y + amplitude - lean },
    target,
  ];
}

/** Where the leaf attaches to the new card: top-center (continue) or left-middle (branch). */
export function getNodeGrowthBase(box: HomeDemoRect, kind: HomeDemoKind): HomeDemoPoint {
  return kind === "continue"
    ? { x: box.x + box.width / 2, y: box.y }
    : { x: box.x, y: box.y + box.height / 2 };
}

/**
 * Where the camera settles after a node grows. Like the demo, a continue node is framed at
 * 2/3 of the height and a branch node at 2/3 (1/2 on phones) of the width, moving the camera
 * along that axis only (nudged so a large card is not cut off). The other axis moves only if
 * the node would be cut off there.
 */
export function getGrowthCameraTarget(
  previous: HomeDemoViewport,
  node: HomeDemoRect,
  kind: HomeDemoKind,
  canvas: { width: number; height: number; leftInset?: number },
  layout: HomeDemoLayout = NODE_GROWTH_LAYOUT,
): HomeDemoViewport {
  // A floating sidebar can cover the left of the canvas; frame inside what stays visible.
  const leftInset = canvas.leftInset ?? 0;
  const framed = getFramedViewport(previous, node, kind, { ...canvas, leftInset }, layout);
  const zoom = framed.zoom;
  const along = kind === "continue" ? "y" : "x";
  const across = kind === "continue" ? "x" : "y";
  const visibleStart = (axis: "x" | "y") => (axis === "x" ? leftInset : 0);
  const visibleEnd = (axis: "x" | "y") => (axis === "x" ? canvas.width : canvas.height);
  const start = (axis: "x" | "y") => (axis === "x" ? node.x : node.y);
  const size = (axis: "x" | "y") => (axis === "x" ? node.width : node.height);
  const margin = NODE_GROWTH_CAMERA_MARGIN;

  // Primary axis: keep the framing, but pull a card that overflows the far edge back in,
  // never past the near edge.
  let offset = framed[along];
  const farOverflow = offset + (start(along) + size(along)) * zoom - (visibleEnd(along) - margin);
  if (farOverflow > 0) offset -= farOverflow;
  const nearOverflow = visibleStart(along) + margin - (offset + start(along) * zoom);
  if (nearOverflow > 0) offset += nearOverflow;

  // Other axis: untouched unless the card is cut off, then centered.
  let crossOffset = framed[across];
  const crossStart = crossOffset + start(across) * zoom;
  const crossEnd = crossStart + size(across) * zoom;
  if (crossStart < visibleStart(across) + margin || crossEnd > visibleEnd(across) - margin) {
    const center = (visibleStart(across) + visibleEnd(across)) / 2;
    crossOffset = center - (start(across) + size(across) / 2) * zoom;
  }

  return { ...framed, [along]: offset, [across]: crossOffset };
}
