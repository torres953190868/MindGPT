// Pure timeline and geometry for the home onboarding demo.
// No React and no DOM here, so everything can be unit tested.
// The numbers mirror the approved demo video (v3).

export type HomeDemoKind = "continue" | "branch";
export type HomeDemoPoint = { x: number; y: number };
export type HomeDemoRect = { x: number; y: number; width: number; height: number };
export type HomeDemoViewport = { x: number; y: number; zoom: number };
export type HomeDemoStem = [HomeDemoPoint, HomeDemoPoint, HomeDemoPoint, HomeDemoPoint];
export type HomeDemoRgb = [number, number, number];

export type HomeDemoQuestionSet = {
  root: string;
  first: HomeDemoKind;
  firstQuestion: string;
  secondQuestion: string;
};

export type HomeDemoLayout = {
  compact: boolean;
  card: { width: number; height: number; paddingX: number; paddingY: number; radius: number };
  font: {
    label: number;
    labelLine: number;
    title: number;
    titleLine: number;
    text: number;
    textLine: number;
  };
  button: { size: number; gap: number };
  leaf: { length: number; breadth: number };
  stem: { amplitude: number; strokeWidth: number; continueLength: number; branchLength: number };
  // Where a new node's center is framed, as a fraction of the visible canvas.
  framing: { continueY: number; branchX: number };
};

// Desktop and tablet: same width as a real canvas node, golden-ratio card.
export const HOME_DEMO_REGULAR_LAYOUT: HomeDemoLayout = {
  compact: false,
  card: { width: 292, height: 180, paddingX: 20, paddingY: 18, radius: 12 },
  font: { label: 12, labelLine: 16, title: 16, titleLine: 24, text: 14, textLine: 22 },
  button: { size: 32, gap: 8 },
  leaf: { length: 66, breadth: 32 },
  stem: { amplitude: 22, strokeWidth: 2.2, continueLength: 150, branchLength: 170 },
  framing: { continueY: 2 / 3, branchX: 2 / 3 },
};

// Phones (< 640px): 4:3 card, about 5/8 of the screen width.
export const HOME_DEMO_COMPACT_LAYOUT: HomeDemoLayout = {
  compact: true,
  card: { width: 244, height: 183, paddingX: 16, paddingY: 14, radius: 12 },
  font: { label: 11, labelLine: 15, title: 15, titleLine: 21, text: 13, textLine: 19 },
  button: { size: 30, gap: 7 },
  leaf: { length: 54, breadth: 26 },
  stem: { amplitude: 15, strokeWidth: 2, continueLength: 120, branchLength: 104 },
  framing: { continueY: 2 / 3, branchX: 1 / 2 },
};

export const HOME_DEMO_COMPACT_MEDIA_QUERY = "(max-width: 639px)";
export const HOME_DEMO_DISMISSED_STORAGE_KEY = "branchmind-home-demo-dismissed";

export const HOME_DEMO_LOOP_SECONDS = 11.5;
export const HOME_DEMO_TIMELINE = {
  typeStart: 0.5,
  typePerChar: 0.07,
  // Longer (e.g. English) questions type faster so the clicks still land after typing ends.
  typeMaxDuration: 1.2,
  firstGrowth: 2.4,
  secondGrowth: 6.45,
  stemDuration: 0.8,
  returnStart: 10.2,
  ghostTypeDelay: 1.55,
  ghostTypePerChar: 0.075,
  ghostTypeMaxDuration: 1.15,
} as const;
export const HOME_DEMO_CLOSE_TIMELINE = {
  fade: 0.3,
  contentFade: 0.25,
  morphStart: 0.15,
  morphEnd: 0.75,
  cardFadeStart: 0.55,
  cardFadeEnd: 0.8,
} as const;
export const HOME_DEMO_CAMERA_OMEGA = 6.5;
export const HOME_DEMO_CAMERA_STEP = 1 / 120;
export const HOME_DEMO_CARD_MAX_LIFT = 45;
export const HOME_DEMO_HERO_GAP = 24;
export const HOME_DEMO_HERO_FADE_DISTANCE = 110;
export const HOME_DEMO_FULL_RADIUS = 14;

// Fallback colors (warm-limestone) when CSS variables cannot be parsed.
export const HOME_DEMO_FALLBACK_COLORS = {
  continue: [125, 107, 69] as HomeDemoRgb,
  branch: [64, 57, 67] as HomeDemoRgb,
  surface: [248, 241, 231] as HomeDemoRgb,
};

// ---------- easing ----------

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeOutBack = (overshoot: number) => (t: number) => {
  const u = 1 - t;
  return 1 - u * u * ((overshoot + 1) * u - overshoot);
};

// Like Remotion's interpolate with clamping on both sides.
export function ramp(
  t: number,
  start: number,
  end: number,
  from = 0,
  to = 1,
  ease: (t: number) => number = easeInOutCubic,
) {
  return mix(from, to, ease(clamp01((t - start) / (end - start))));
}

// 0 -> 1 -> 0 between start and end.
export function bump(t: number, start: number, end: number) {
  if (t < start || t > end) return 0;
  return Math.sin(((t - start) / (end - start)) * Math.PI);
}

// Same as Remotion spring({ damping: 13, stiffness: 120, mass: 0.75 }), closed form.
const SPRING_OMEGA = Math.sqrt(120 / 0.75);
const SPRING_ZETA = 13 / (2 * Math.sqrt(120 * 0.75));
const SPRING_OMEGA_D = SPRING_OMEGA * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);
export function springProgress(seconds: number) {
  if (seconds <= 0) return 0;
  const decay = Math.exp(-SPRING_ZETA * SPRING_OMEGA * seconds);
  return (
    1 -
    decay *
      (Math.cos(SPRING_OMEGA_D * seconds) +
        ((SPRING_ZETA * SPRING_OMEGA) / SPRING_OMEGA_D) * Math.sin(SPRING_OMEGA_D * seconds))
  );
}

export function typedText(text: string, t: number, start: number, perChar: number) {
  if (t < start) return "";
  const chars = Array.from(text);
  return chars.slice(0, Math.min(chars.length, Math.floor((t - start) / perChar) + 1)).join("");
}

export function getTypingEnd(text: string, start: number, perChar: number) {
  return start + Array.from(text).length * perChar;
}

/** Seconds per character: `perChar`, unless that would take longer than `maxDuration`. */
export function getTypingPerChar(text: string, perChar: number, maxDuration: number) {
  return Math.min(perChar, maxDuration / Math.max(1, Array.from(text).length));
}

export const isCaretVisible = (clockSeconds: number) => Math.floor(clockSeconds * 2.2) % 2 === 0;

// ---------- layout ----------

export const otherKind = (kind: HomeDemoKind): HomeDemoKind =>
  kind === "continue" ? "branch" : "continue";

export const rectCenter = (rect: HomeDemoRect): HomeDemoPoint => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

// The demo card sits in the middle of the (invisible) full composer and is lifted up to
// HOME_DEMO_CARD_MAX_LIFT, but never closer than HOME_DEMO_HERO_GAP to the hero.
export function getDemoCardRect(
  composerBox: HomeDemoRect,
  layout: HomeDemoLayout,
  heroBottom: number | null,
): HomeDemoRect {
  const center = rectCenter(composerBox);
  const top = center.y - layout.card.height / 2;
  const room = heroBottom === null ? HOME_DEMO_CARD_MAX_LIFT : top - (heroBottom + HOME_DEMO_HERO_GAP);
  const lift = Math.min(HOME_DEMO_CARD_MAX_LIFT, Math.max(0, room));
  return {
    x: center.x - layout.card.width / 2,
    y: top - lift,
    width: layout.card.width,
    height: layout.card.height,
  };
}

export function getChildRect(parent: HomeDemoRect, kind: HomeDemoKind, layout: HomeDemoLayout) {
  return kind === "continue"
    ? { ...parent, y: parent.y + parent.height + layout.stem.continueLength }
    : { ...parent, x: parent.x + parent.width + layout.stem.branchLength };
}

// S-shaped cubic stem from the parent's bottom-center (continue) or right-middle (branch).
export function getStem(parent: HomeDemoRect, kind: HomeDemoKind, layout: HomeDemoLayout): HomeDemoStem {
  const amplitude = layout.stem.amplitude;
  if (kind === "continue") {
    const x = parent.x + parent.width / 2;
    const y0 = parent.y + parent.height;
    const length = layout.stem.continueLength;
    return [
      { x, y: y0 },
      { x: x + amplitude, y: y0 + length * 0.36 },
      { x: x - amplitude, y: y0 + length * 0.64 },
      { x, y: y0 + length },
    ];
  }
  const y = parent.y + parent.height / 2;
  const x0 = parent.x + parent.width;
  const length = layout.stem.branchLength;
  return [
    { x: x0, y },
    { x: x0 + length * 0.36, y: y - amplitude },
    { x: x0 + length * 0.64, y: y + amplitude },
    { x: x0 + length, y },
  ];
}

export type HomeDemoPlan = {
  firstKind: HomeDemoKind;
  secondKind: HomeDemoKind;
  root: HomeDemoRect;
  first: HomeDemoRect;
  second: HomeDemoRect;
  firstStem: HomeDemoStem;
  secondStem: HomeDemoStem;
};

export function getHomeDemoPlan(root: HomeDemoRect, firstKind: HomeDemoKind, layout: HomeDemoLayout): HomeDemoPlan {
  const secondKind = otherKind(firstKind);
  const first = getChildRect(root, firstKind, layout);
  const second = getChildRect(first, secondKind, layout);
  return {
    firstKind,
    secondKind,
    root,
    first,
    second,
    firstStem: getStem(root, firstKind, layout),
    secondStem: getStem(first, secondKind, layout),
  };
}

export function getButtonCenter(rect: HomeDemoRect, kind: HomeDemoKind, layout: HomeDemoLayout): HomeDemoPoint {
  const index = kind === "continue" ? 0 : 1;
  return {
    x: rect.x + layout.card.paddingX + layout.button.size / 2 + index * (layout.button.size + layout.button.gap),
    y: rect.y + rect.height - layout.card.paddingY - layout.button.size / 2,
  };
}

// ---------- camera ----------

export type HomeDemoCanvas = { width: number; height: number; leftInset: number };

// Viewport that puts the new node's center at the framing point. Continue nodes only move
// the camera vertically, branch nodes only horizontally.
export function getFramedViewport(
  previous: HomeDemoViewport,
  node: HomeDemoRect,
  kind: HomeDemoKind,
  canvas: HomeDemoCanvas,
  layout: HomeDemoLayout,
): HomeDemoViewport {
  const center = rectCenter(node);
  if (kind === "continue") {
    return { ...previous, y: canvas.height * layout.framing.continueY - center.y * previous.zoom };
  }
  const visibleWidth = canvas.width - canvas.leftInset;
  return {
    ...previous,
    x: canvas.leftInset + visibleWidth * layout.framing.branchX - center.x * previous.zoom,
  };
}

export type HomeDemoCameraStops = {
  home: HomeDemoViewport;
  first: HomeDemoViewport;
  second: HomeDemoViewport;
};

export function getCameraStops(
  home: HomeDemoViewport,
  plan: HomeDemoPlan,
  canvas: HomeDemoCanvas,
  layout: HomeDemoLayout,
): HomeDemoCameraStops {
  const first = getFramedViewport(home, plan.first, plan.firstKind, canvas, layout);
  const second = getFramedViewport(first, plan.second, plan.secondKind, canvas, layout);
  return { home, first, second };
}

const stemEase = (loopTime: number, start: number) =>
  easeInOutQuad(clamp01((loopTime - start) / HOME_DEMO_TIMELINE.stemDuration));

const mixViewport = (from: HomeDemoViewport, to: HomeDemoViewport, amount: number): HomeDemoViewport => ({
  x: mix(from.x, to.x, amount),
  y: mix(from.y, to.y, amount),
  zoom: to.zoom,
});

// The camera target follows the growing stem tip, then rests on the new node.
export function getCameraTarget(loopTime: number, stops: HomeDemoCameraStops): HomeDemoViewport {
  const { firstGrowth, secondGrowth, returnStart } = HOME_DEMO_TIMELINE;
  if (loopTime >= returnStart || loopTime < firstGrowth) return stops.home;
  if (loopTime < secondGrowth) return mixViewport(stops.home, stops.first, stemEase(loopTime, firstGrowth));
  return mixViewport(stops.first, stops.second, stemEase(loopTime, secondGrowth));
}

export type HomeDemoCameraState = { x: number; y: number; vx: number; vy: number };

// One critically damped spring step toward the target.
export function stepCamera(state: HomeDemoCameraState, target: HomeDemoViewport, dt: number): HomeDemoCameraState {
  const w = HOME_DEMO_CAMERA_OMEGA;
  const vx = state.vx + (w * w * (target.x - state.x) - 2 * w * state.vx) * dt;
  const vy = state.vy + (w * w * (target.y - state.y) - 2 * w * state.vy) * dt;
  return { x: state.x + vx * dt, y: state.y + vy * dt, vx, vy };
}

// Camera position at loopTime, integrated from the start of the loop. Pure, so frame drops or
// tab switches never desync it from the rest of the timeline.
export function getCameraAt(loopTime: number, stops: HomeDemoCameraStops): HomeDemoCameraState {
  let state: HomeDemoCameraState = { x: stops.home.x, y: stops.home.y, vx: 0, vy: 0 };
  for (let s = 0; s < loopTime; s += HOME_DEMO_CAMERA_STEP) {
    state = stepCamera(state, getCameraTarget(s, stops), HOME_DEMO_CAMERA_STEP);
  }
  return state;
}

export function getHeroOpacity(offsetY: number) {
  return 1 - clamp01(Math.abs(offsetY) / HOME_DEMO_HERO_FADE_DISTANCE);
}

// ---------- shapes ----------

export function cubicPoint(points: HomeDemoStem, t: number): HomeDemoPoint {
  const u = 1 - t;
  return {
    x: u * u * u * points[0].x + 3 * u * u * t * points[1].x + 3 * u * t * t * points[2].x + t * t * t * points[3].x,
    y: u * u * u * points[0].y + 3 * u * u * t * points[1].y + 3 * u * t * t * points[2].y + t * t * t * points[3].y,
  };
}

export function cubicAngle(points: HomeDemoStem, t: number) {
  const a = cubicPoint(points, Math.max(0, t - 0.01));
  const b = cubicPoint(points, Math.min(1, t + 0.01));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export const stemPath = (stem: HomeDemoStem) =>
  `M${stem[0].x},${stem[0].y} C${stem[1].x},${stem[1].y} ${stem[2].x},${stem[2].y} ${stem[3].x},${stem[3].y}`;

const rotate = (u: number, v: number, angle: number): [number, number] => [
  u * Math.cos(angle) - v * Math.sin(angle),
  u * Math.sin(angle) + v * Math.cos(angle),
];

const leafProfile = (s: number) => Math.pow(Math.sin(Math.PI * Math.pow(s, 0.78)), 0.85);

// Small pointed leaf starting at `base`, pointing along `angle`.
export function leafPath(base: HomeDemoPoint, angle: number, length: number, breadth: number, steps = 18) {
  const right: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const s = i / steps;
    right.push([s * length, (breadth / 2) * leafProfile(s)]);
  }
  const left = right
    .slice(1, -1)
    .reverse()
    .map(([u, v]) => [u, -v] as [number, number]);
  return (
    "M" +
    [...right, ...left]
      .map(([u, v]) => {
        const [x, y] = rotate(u, v, angle);
        return `${(base.x + x).toFixed(2)},${(base.y + y).toFixed(2)}`;
      })
      .join(" L") +
    " Z"
  );
}

// Superellipse that morphs from a leaf (morph = 0, exponent 1.3, wider at the base) into the
// card (morph = 1, exponent 10). `length` runs along `angle`, `breadth` across it.
export function leafToCardPath(
  base: HomeDemoPoint,
  angle: number,
  leafLength: number,
  leafBreadth: number,
  morph: number,
  cardLength: number,
  cardBreadth: number,
  steps = 128,
) {
  const settled = clamp01(morph);
  const a = mix(leafLength / 2, cardLength / 2, morph);
  const b = mix(leafBreadth / 2, cardBreadth / 2, morph);
  const exponent = mix(1.3, 10, Math.pow(settled, 0.8));
  const points: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const theta = (i / steps) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / exponent);
    let y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / exponent);
    y *= 1 + 0.32 * (1 - settled) * (-x / Math.max(a, 1));
    const [rx, ry] = rotate(x + a, y, angle);
    points.push(`${(base.x + rx).toFixed(2)},${(base.y + ry).toFixed(2)}`);
  }
  return "M" + points.join(" L") + " Z";
}

export function parseCssColor(value: string, fallback: HomeDemoRgb): HomeDemoRgb {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as HomeDemoRgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

export const rgba = (rgb: HomeDemoRgb, alpha: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;

export const mixRgba = (from: HomeDemoRgb, fromAlpha: number, to: HomeDemoRgb, toAlpha: number, amount: number) =>
  `rgba(${[0, 1, 2].map((i) => Math.round(mix(from[i], to[i], amount))).join(",")},${mix(fromAlpha, toAlpha, amount).toFixed(3)})`;

// ---------- per-frame state ----------

export type HomeDemoGrowthFrame = {
  stemProgress: number;
  leaflets: { path: string }[];
  budPath: string | null;
  leaf: null | {
    path: string;
    morph: number;
    midrib: { x1: number; y1: number; x2: number; y2: number } | null;
  };
  cardOpacity: number;
  contentOpacity: number;
  title: string;
  typing: boolean;
  explanationOpacity: number;
};

export function getGrowthFrame(
  kind: HomeDemoKind,
  stem: HomeDemoStem,
  box: HomeDemoRect,
  loopTime: number,
  start: number,
  question: string,
  layout: HomeDemoLayout,
): HomeDemoGrowthFrame | null {
  if (loopTime < start) return null;
  const local = loopTime - start;
  const axis = kind === "continue" ? Math.PI / 2 : 0;
  const stemProgress = stemEase(loopTime, start);
  const leafScale = ramp(loopTime, start + 0.66, start + 1, 0.14, 1, easeOutCubic);
  const morph = springProgress(local - 0.9);
  const settled = clamp01(morph);
  const sway =
    (cubicAngle(stem, 1) - axis) * (1 - morph) + 0.05 * Math.sin(local * 9) * (1 - settled);
  const tip = cubicPoint(stem, stemProgress);
  const base = stem[3];
  const showLeaf = local >= 0.66;
  const leafLength = mix(layout.leaf.length * 0.14, layout.leaf.length, leafScale);
  const leafBreadth = mix(layout.leaf.breadth * 0.14, layout.leaf.breadth, leafScale);
  const cardLength = kind === "continue" ? box.height : box.width;
  const cardBreadth = kind === "continue" ? box.width : box.height;
  const leafletScale = layout.compact ? 0.85 : 1;
  const leaflets = [0.4, 0.7].flatMap((at, index) => {
    const scale = ramp(stemProgress, at, Math.min(1, at + 0.25), 0, 1, easeOutBack(1.6));
    if (scale <= 0) return [];
    const side = index === 0 ? -1 : 1;
    const angle = cubicAngle(stem, at) + side * 0.95 * (kind === "continue" ? 1 : -1);
    return [
      {
        path: leafPath(
          cubicPoint(stem, at),
          angle,
          (index === 0 ? 15 : 12) * scale * leafletScale,
          (index === 0 ? 8 : 7) * scale * leafletScale,
        ),
      },
    ];
  });
  let midrib: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (showLeaf && settled < 0.98) {
    const [dx, dy] = rotate(leafLength * 0.9, 0, axis + sway);
    midrib = { x1: base.x, y1: base.y, x2: base.x + dx * (1 - settled), y2: base.y + dy * (1 - settled) };
  }
  const titleStart = start + HOME_DEMO_TIMELINE.ghostTypeDelay;
  const titlePerChar = getTypingPerChar(
    question,
    HOME_DEMO_TIMELINE.ghostTypePerChar,
    HOME_DEMO_TIMELINE.ghostTypeMaxDuration,
  );
  const titleEnd = getTypingEnd(question, titleStart, titlePerChar);
  return {
    stemProgress,
    leaflets,
    budPath:
      !showLeaf && stemProgress > 0.03
        ? leafPath(tip, cubicAngle(stem, stemProgress), layout.leaf.length * 0.15, layout.leaf.breadth * 0.19)
        : null,
    leaf: showLeaf
      ? {
          path: leafToCardPath(base, axis + sway, leafLength, leafBreadth, morph, cardLength, cardBreadth),
          morph: settled,
          midrib,
        }
      : null,
    cardOpacity: ramp(loopTime, start + 1.4, start + 1.7),
    contentOpacity: ramp(loopTime, start + 1.3, start + 1.55),
    title: typedText(question, loopTime, titleStart, titlePerChar),
    typing: loopTime >= titleStart && loopTime < titleEnd + 0.4,
    explanationOpacity: ramp(loopTime, titleEnd + 0.05, titleEnd + 0.3),
  };
}

export type HomeDemoPointer = {
  x: number;
  y: number;
  opacity: number;
  press: number;
  rippleX: number;
  rippleY: number;
  ripple: number;
};

export type HomeDemoFrame = {
  rootText: string;
  rootTyping: boolean;
  rootTextOpacity: number;
  placeholderOpacity: number;
  ghostOpacity: number;
  rootButtonPress: { kind: HomeDemoKind; press: number };
  firstNodeButtonPress: { kind: HomeDemoKind; press: number } | null;
  cursor: HomeDemoPointer | null;
  taps: { x: number; y: number; opacity: number; press: number }[];
  first: HomeDemoGrowthFrame | null;
  second: HomeDemoGrowthFrame | null;
};

export function getHomeDemoFrame(
  loopTime: number,
  set: HomeDemoQuestionSet,
  plan: HomeDemoPlan,
  layout: HomeDemoLayout,
): HomeDemoFrame {
  const { typeStart, typeMaxDuration, returnStart, firstGrowth, secondGrowth } = HOME_DEMO_TIMELINE;
  const typePerChar = getTypingPerChar(set.root, HOME_DEMO_TIMELINE.typePerChar, typeMaxDuration);
  const rootEnd = getTypingEnd(set.root, typeStart, typePerChar);
  const firstPress = layout.compact ? bump(loopTime, 2.15, 2.55) : bump(loopTime, 2.2, 2.6);
  const secondPress = layout.compact ? bump(loopTime, 6.15, 6.55) : bump(loopTime, 6.2, 6.6);
  const rootButton = getButtonCenter(plan.root, plan.firstKind, layout);
  const firstNodeButton = getButtonCenter(plan.first, plan.secondKind, layout);

  let cursor: HomeDemoPointer | null = null;
  if (!layout.compact) {
    if (loopTime < 4.5) {
      const from = { x: plan.root.x + plan.root.width + 34, y: plan.root.y + plan.root.height + 174 };
      const travel = ramp(loopTime, 1.6, 2.15);
      cursor = {
        x: mix(from.x, rootButton.x + 4, travel),
        y: mix(from.y, rootButton.y + 3, travel),
        opacity: ramp(loopTime, 1.5, 1.7) - ramp(loopTime, 2.6, 2.9),
        press: bump(loopTime, 2.15, 2.4),
        rippleX: rootButton.x,
        rippleY: rootButton.y,
        ripple: ramp(loopTime, 2.2, 2.65, 0, 1, easeOutQuad),
      };
    } else {
      const firstCenter = rectCenter(plan.first);
      const from = { x: firstCenter.x + 190, y: firstCenter.y + 130 };
      const travel = ramp(loopTime, 5.55, 6.15);
      cursor = {
        x: mix(from.x, firstNodeButton.x + 4, travel),
        y: mix(from.y, firstNodeButton.y + 3, travel),
        opacity: ramp(loopTime, 5.45, 5.65) - ramp(loopTime, 6.6, 6.9),
        press: bump(loopTime, 6.15, 6.4),
        rippleX: firstNodeButton.x,
        rippleY: firstNodeButton.y,
        ripple: ramp(loopTime, 6.2, 6.65, 0, 1, easeOutQuad),
      };
    }
  }

  const taps = layout.compact
    ? [
        {
          ...rootButton,
          opacity: ramp(loopTime, 1.95, 2.15) - ramp(loopTime, 2.45, 2.65),
          press: bump(loopTime, 2.1, 2.4),
        },
        {
          ...firstNodeButton,
          opacity: ramp(loopTime, 5.95, 6.15) - ramp(loopTime, 6.45, 6.65),
          press: bump(loopTime, 6.1, 6.4),
        },
      ]
    : [];

  return {
    rootText: loopTime > returnStart + 0.4 ? "" : typedText(set.root, loopTime, typeStart, typePerChar),
    rootTyping: loopTime >= typeStart && loopTime < rootEnd + 0.5,
    rootTextOpacity: ramp(loopTime, returnStart, returnStart + 0.4, 1, 0),
    placeholderOpacity: loopTime < typeStart ? 1 : ramp(loopTime, returnStart + 0.5, returnStart + 0.8),
    ghostOpacity: ramp(loopTime, returnStart, returnStart + 0.45, 1, 0),
    rootButtonPress: { kind: plan.firstKind, press: loopTime < 4.5 ? firstPress : 0 },
    firstNodeButtonPress: loopTime > 4.5 ? { kind: plan.secondKind, press: secondPress } : null,
    cursor,
    taps,
    first: getGrowthFrame(plan.firstKind, plan.firstStem, plan.first, loopTime, firstGrowth, set.firstQuestion, layout),
    second: getGrowthFrame(plan.secondKind, plan.secondStem, plan.second, loopTime, secondGrowth, set.secondQuestion, layout),
  };
}
