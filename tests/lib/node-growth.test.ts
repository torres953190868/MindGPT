import { describe, expect, it } from "vitest";
import {
  HOME_DEMO_COMPACT_LAYOUT,
  HOME_DEMO_REGULAR_LAYOUT,
  getGrowthFrame,
  getGrowthShapes,
  getStem,
  getStemLeaflets,
} from "@/lib/home-onboarding-demo";
import {
  getEdgeStem,
  getGrowthCameraTarget,
  getNodeGrowthBase,
} from "@/lib/node-growth";

const layout = HOME_DEMO_REGULAR_LAYOUT;
const parent = { x: 100, y: 100, width: 292, height: 180 };

describe("getEdgeStem", () => {
  const sway = (length: number) => (layout.stem.amplitude * length) / layout.stem.branchLength;

  it("matches the home demo branch stem when aligned at demo length", () => {
    const demo = getStem(parent, "branch", layout);
    expect(getEdgeStem(demo[0], demo[3], "branch")).toEqual(demo);
  });

  it("gives continue stems the branch stem's proportions", () => {
    const demo = getStem(parent, "continue", layout);
    const stem = getEdgeStem(demo[0], demo[3], "continue");
    expect(stem[1]).toEqual({ x: demo[0].x + sway(layout.stem.continueLength), y: demo[1].y });
    expect(stem[2]).toEqual({ x: demo[3].x - sway(layout.stem.continueLength), y: demo[2].y });
  });

  it("softens the sway on short edges", () => {
    const stem = getEdgeStem({ x: 0, y: 0 }, { x: 0, y: 85 }, "continue");
    expect(stem[1].x).toBeCloseTo(layout.stem.amplitude / 2);
    expect(stem[2].x).toBeCloseTo(-layout.stem.amplitude / 2);
  });

  it("keeps the S on a slightly offset card and hugs the handles on a far one", () => {
    const near = getEdgeStem({ x: 0, y: 0 }, { x: 54, y: 200 }, "continue");
    expect(near[1].x).toBeGreaterThan(near[2].x);
    const far = getEdgeStem({ x: 0, y: 0 }, { x: 340, y: 200 }, "continue");
    expect(far[1].x).toBeCloseTo(sway(200));
    expect(far[2].x).toBeCloseTo(340 - sway(200));
  });

  it("draws the same S around the chord for continue and branch, whatever the offset", () => {
    // Deviation of each control point from the straight line between the handles.
    const swayOf = (stem: ReturnType<typeof getEdgeStem>, axis: "x" | "y") => [
      stem[1][axis] - (stem[0][axis] + (stem[3][axis] - stem[0][axis]) * 0.36),
      stem[2][axis] - (stem[0][axis] + (stem[3][axis] - stem[0][axis]) * 0.64),
    ];
    const continueStem = getEdgeStem({ x: 0, y: 0 }, { x: 54, y: 200 }, "continue");
    const branchStem = getEdgeStem({ x: 0, y: 0 }, { x: 200, y: -54 }, "branch");
    const [c1, c2] = swayOf(continueStem, "x");
    const [b1, b2] = swayOf(branchStem, "y");
    expect(c1).toBeCloseTo(-c2);
    expect(Math.abs(c1)).toBeCloseTo(Math.abs(b1));
    expect(Math.abs(c2)).toBeCloseTo(Math.abs(b2));
  });

  it("scales the sway with stem length, within limits", () => {
    const long = getEdgeStem({ x: 0, y: 0 }, { x: 0, y: 300 }, "continue");
    expect(long[1].x).toBeCloseTo(layout.stem.amplitude * 1.5);
  });

  it("loops out of the handle when the target sits behind the source", () => {
    const stem = getEdgeStem({ x: 0, y: 0 }, { x: -100, y: 0 }, "branch");
    expect(stem[1].x).toBeGreaterThan(0);
    expect(stem[2].x).toBeLessThan(-100);
    expect(stem[1].y).toBeCloseTo(0);
  });

  it("keeps leaflets on settled edges", () => {
    const stem = getEdgeStem({ x: 0, y: 0 }, { x: 170, y: 0 }, "branch");
    expect(getStemLeaflets(stem, "branch", 1)).toHaveLength(2);
    expect(getStemLeaflets(stem, "branch", 0)).toHaveLength(0);
  });
});

describe("getGrowthShapes", () => {
  it("is the demo growth frame without the typing", () => {
    const stem = getStem(parent, "branch", layout);
    const box = { x: stem[3].x, y: parent.y, width: 292, height: 180 };
    for (const local of [0.2, 0.7, 1.1, 1.5]) {
      const frame = getGrowthFrame("branch", stem, box, 5 + local, 5, "Why?", layout)!;
      const shapes = getGrowthShapes("branch", stem, box, local, layout);
      expect(shapes.stemProgress).toBeCloseTo(frame.stemProgress, 6);
      expect(shapes.cardOpacity).toBeCloseTo(frame.cardOpacity, 6);
      expect(shapes.leaflets.length).toBe(frame.leaflets.length);
      expect(Boolean(shapes.leaf)).toBe(Boolean(frame.leaf));
      expect(Boolean(shapes.budPath)).toBe(Boolean(frame.budPath));
    }
  });

  it("attaches the leaf at the given card base", () => {
    const box = { x: 500, y: 300, width: 292, height: 220 };
    expect(getNodeGrowthBase(box, "continue")).toEqual({ x: 646, y: 300 });
    expect(getNodeGrowthBase(box, "branch")).toEqual({ x: 500, y: 410 });
  });
});

describe("getGrowthCameraTarget", () => {
  const canvas = { width: 1200, height: 900 };
  const previous = { x: 0, y: 0, zoom: 1 };

  it("frames a continue node at 2/3 height and leaves x alone", () => {
    const node = { x: 400, y: 600, width: 292, height: 180 };
    const target = getGrowthCameraTarget(previous, node, "continue", canvas);
    expect(target.x).toBe(0);
    expect(target.y + (node.y + node.height / 2)).toBeCloseTo(600);
  });

  it("frames a branch node at 2/3 width, or 1/2 on phones", () => {
    const node = { x: 900, y: 300, width: 292, height: 180 };
    const regular = getGrowthCameraTarget(previous, node, "branch", canvas);
    expect(regular.x + node.x + node.width / 2).toBeCloseTo(800);
    expect(regular.y).toBe(0);
    const compact = getGrowthCameraTarget(previous, node, "branch", canvas, HOME_DEMO_COMPACT_LAYOUT);
    expect(compact.x + node.x + node.width / 2).toBeCloseTo(600);
  });

  it("frames inside the part of the canvas a floating sidebar leaves visible", () => {
    const node = { x: 900, y: 300, width: 292, height: 180 };
    const target = getGrowthCameraTarget(previous, node, "branch", { ...canvas, leftInset: 300 });
    expect(target.x + node.x + node.width / 2).toBeCloseTo(300 + (900 * 2) / 3);
  });

  it("pulls a tall card back on screen and centers a card cut off on the other axis", () => {
    const node = { x: 2000, y: 600, width: 292, height: 500 };
    const target = getGrowthCameraTarget(previous, node, "continue", canvas);
    expect(target.y + node.y + node.height).toBeLessThanOrEqual(canvas.height - 24 + 1e-6);
    expect(target.x + node.x + node.width / 2).toBeCloseTo(canvas.width / 2);
  });
});
