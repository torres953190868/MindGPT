"use client";

import {
  type CSSProperties,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { GitBranch, Ribbon, Send, Sprout } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  HOME_DEMO_CAMERA_STEP,
  HOME_DEMO_CLOSE_TIMELINE,
  HOME_DEMO_COMPACT_LAYOUT,
  HOME_DEMO_COMPACT_MEDIA_QUERY,
  HOME_DEMO_FALLBACK_COLORS,
  HOME_DEMO_FULL_RADIUS,
  HOME_DEMO_LOOP_SECONDS,
  HOME_DEMO_REGULAR_LAYOUT,
  type HomeDemoCameraState,
  type HomeDemoFrame,
  type HomeDemoGrowthFrame,
  type HomeDemoKind,
  type HomeDemoLayout,
  type HomeDemoPlan,
  type HomeDemoQuestionSet,
  type HomeDemoRect,
  type HomeDemoRgb,
  type HomeDemoStem,
  type HomeDemoViewport,
  easeOutCubic,
  getCameraAt,
  getCameraStops,
  getDemoCardRect,
  getHeroOpacity,
  getHomeDemoFrame,
  getHomeDemoPlan,
  isCaretVisible,
  mix,
  mixRgba,
  parseCssColor,
  ramp,
  rgba,
  stemPath,
  stepCamera,
} from "@/lib/home-onboarding-demo";

export type HomeOnboardingDemoPhase = "playing" | "closing";

type HomeOnboardingDemoProps = {
  rootNodeId: string;
  phase: HomeOnboardingDemoPhase;
  canvasLeftInset: number;
  getContainer: () => HTMLElement | null;
  getHomeViewport: () => HomeDemoViewport | null;
  onCardPointerDown: () => void;
  onCardClick: () => void;
  onFinished: () => void;
};

type DemoColors = Record<HomeDemoKind | "surface", HomeDemoRgb>;

type DemoModel = {
  clock: number;
  layout: HomeDemoLayout;
  set: HomeDemoQuestionSet;
  plan: HomeDemoPlan;
  frame: HomeDemoFrame;
  composerBox: HomeDemoRect;
  closing: null | { fade: number; morph: number; contentOpacity: number; cardOpacity: number };
};

const HERO_OFFSET_VAR = "--home-demo-hero-offset-y";
const HERO_OPACITY_VAR = "--home-demo-hero-opacity";

const theme = {
  border: "var(--theme-border-default)",
  surface: "color-mix(in srgb, var(--theme-surface-elevated) 96%, transparent)",
  muted: "var(--theme-surface-muted)",
  text: "var(--theme-text-primary)",
  textMuted: "var(--theme-text-muted)",
  label: "var(--theme-neutral-500)",
  dark: "var(--theme-brand-900)",
  onDark: "var(--theme-surface-elevated)",
  fold: "var(--warm-limestone-fold-600, var(--theme-neutral-700))",
  ring: "0 0 0 2px color-mix(in srgb, var(--theme-brand-900) 12%, transparent), var(--theme-shadow-md)",
};

const kindVar = (kind: HomeDemoKind) =>
  kind === "continue" ? "var(--node-handle-continue)" : "var(--node-handle-branch)";

function readDemoColors(): DemoColors {
  const style = getComputedStyle(document.documentElement);
  return {
    continue: parseCssColor(style.getPropertyValue("--node-handle-continue"), HOME_DEMO_FALLBACK_COLORS.continue),
    branch: parseCssColor(style.getPropertyValue("--node-handle-branch"), HOME_DEMO_FALLBACK_COLORS.branch),
    surface: parseCssColor(style.getPropertyValue("--theme-surface-elevated"), HOME_DEMO_FALLBACK_COLORS.surface),
  };
}

function getHeroIntro(container: HTMLElement | null) {
  return container
    ?.closest<HTMLElement>("[data-testid='mind-map-canvas']")
    ?.querySelector<HTMLElement>("[data-home-canvas-intro]") ?? null;
}

export function HomeOnboardingDemo({
  rootNodeId,
  phase,
  canvasLeftInset,
  getContainer,
  getHomeViewport,
  onCardPointerDown,
  onCardClick,
  onFinished,
}: HomeOnboardingDemoProps) {
  const { copy } = useLanguage();
  const reactFlow = useReactFlow();
  const [model, setModel] = useState<DemoModel | null>(null);
  const [colors, setColors] = useState<DemoColors>(HOME_DEMO_FALLBACK_COLORS);
  const phaseRef = useRef(phase);
  const closingStartRef = useRef<number | null>(null);
  const propsRef = useRef({ canvasLeftInset, getContainer, getHomeViewport, onFinished, sets: copy.home.onboardingDemo.sets });

  useEffect(() => {
    propsRef.current = { canvasLeftInset, getContainer, getHomeViewport, onFinished, sets: copy.home.onboardingDemo.sets };
  });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    setColors(readDemoColors());
  }, []);

  useEffect(() => {
    const compactQuery = window.matchMedia(HOME_DEMO_COMPACT_MEDIA_QUERY);
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    let frameId = 0;
    let lastNow: number | null = null;
    let clock = 0;
    let started = false;
    let finished = false;
    let loopIndex = -1;
    let heroBottom: number | null = null;
    let heroOffset = 0;
    let camera: HomeDemoCameraState | null = null;

    const writeHero = (offsetY: number) => {
      const intro = getHeroIntro(propsRef.current.getContainer());
      if (!intro) return;
      heroOffset = offsetY;
      intro.style.setProperty(HERO_OFFSET_VAR, `${offsetY.toFixed(2)}px`);
      intro.style.setProperty(HERO_OPACITY_VAR, getHeroOpacity(offsetY).toFixed(3));
    };

    const measureHeroBottom = (container: HTMLElement, home: HomeDemoViewport) => {
      const hero = getHeroIntro(container)?.querySelector<HTMLElement>("[data-testid='home-hero']");
      if (!hero) return null;
      const screenBottom =
        hero.getBoundingClientRect().bottom - container.getBoundingClientRect().top - heroOffset;
      return (screenBottom - home.y) / home.zoom;
    };

    const tick = (now: number) => {
      frameId = window.requestAnimationFrame(tick);
      const props = propsRef.current;
      const container = props.getContainer();
      const home = props.getHomeViewport();
      const node = reactFlow.getInternalNode(rootNodeId);
      const width = node?.measured.width;
      const height = node?.measured.height;
      if (!container || !home || !node || !width || !height) {
        lastNow = now;
        return;
      }

      const dt = lastNow === null ? 0 : Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      if (started) clock += dt;
      started = true;

      if (phaseRef.current === "closing" && closingStartRef.current === null) {
        closingStartRef.current = clock;
      }
      const closingStart = closingStartRef.current;
      const playClock = closingStart === null ? clock : Math.min(clock, closingStart);
      const nextLoopIndex = Math.floor(playClock / HOME_DEMO_LOOP_SECONDS);
      const loopTime = playClock - nextLoopIndex * HOME_DEMO_LOOP_SECONDS;
      const layout = compactQuery.matches ? HOME_DEMO_COMPACT_LAYOUT : HOME_DEMO_REGULAR_LAYOUT;
      if (nextLoopIndex !== loopIndex) {
        loopIndex = nextLoopIndex;
        heroBottom = measureHeroBottom(container, home);
      }

      const composerBox = {
        x: node.internals.positionAbsolute.x,
        y: node.internals.positionAbsolute.y,
        width,
        height,
      };
      const sets = props.sets;
      const set = sets[loopIndex % sets.length];
      const root = getDemoCardRect(composerBox, layout, heroBottom);
      const plan = getHomeDemoPlan(root, set.first, layout);
      const canvas = {
        width: container.clientWidth,
        height: container.clientHeight,
        leftInset: desktopQuery.matches ? props.canvasLeftInset : 0,
      };
      const stops = getCameraStops(home, plan, canvas, layout);

      if (closingStart === null) {
        camera = getCameraAt(loopTime, stops);
      } else {
        let state = camera ?? { x: home.x, y: home.y, vx: 0, vy: 0 };
        for (let s = 0; s < dt; s += HOME_DEMO_CAMERA_STEP) {
          state = stepCamera(state, home, Math.min(HOME_DEMO_CAMERA_STEP, dt - s));
        }
        camera = state;
      }
      void reactFlow.setViewport({ x: camera.x, y: camera.y, zoom: home.zoom }, { duration: 0 });
      writeHero(camera.y - home.y);

      let closing: DemoModel["closing"] = null;
      if (closingStart !== null) {
        const since = clock - closingStart;
        const c = HOME_DEMO_CLOSE_TIMELINE;
        closing = {
          fade: ramp(since, 0, c.fade, 1, 0),
          morph: ramp(since, c.morphStart, c.morphEnd, 0, 1, easeOutCubic),
          contentOpacity: ramp(since, 0, c.contentFade, 1, 0),
          cardOpacity: ramp(since, c.cardFadeStart, c.cardFadeEnd, 1, 0),
        };
        const settled =
          Math.abs(camera.x - home.x) < 0.5 &&
          Math.abs(camera.y - home.y) < 0.5 &&
          Math.hypot(camera.vx, camera.vy) < 4;
        if (!finished && since >= c.cardFadeEnd && settled) {
          finished = true;
          void reactFlow.setViewport(home, { duration: 0 });
          props.onFinished();
        }
      }

      setModel({
        clock,
        layout,
        set,
        plan,
        frame: getHomeDemoFrame(loopTime, set, plan, layout),
        composerBox,
        closing,
      });
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
      const intro = getHeroIntro(propsRef.current.getContainer());
      intro?.style.removeProperty(HERO_OFFSET_VAR);
      intro?.style.removeProperty(HERO_OPACITY_VAR);
    };
  }, [reactFlow, rootNodeId]);

  if (!model) return null;

  const { layout, set, plan, frame, closing, clock } = model;
  const fade = closing?.fade ?? 1;
  const ghostOpacity = frame.ghostOpacity * fade;
  const demoCopy = copy.home.onboardingDemo;
  const kindLabels = { continue: copy.workspace.continue, branch: copy.workspace.branch };
  const morph = closing?.morph ?? 0;
  const cardRect = {
    x: mix(plan.root.x, model.composerBox.x, morph),
    y: mix(plan.root.y, model.composerBox.y, morph),
    width: mix(plan.root.width, model.composerBox.width, morph),
    height: mix(plan.root.height, model.composerBox.height, morph),
  };

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    onCardPointerDown();
  }

  return (
    <ViewportPortal>
      <div
        aria-hidden="true"
        data-testid="home-demo-layer"
        className="home-demo-layer"
        style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
      >
        {ghostOpacity > 0 && (
          <>
            {frame.first && (
              <DemoGrowth
                kind={plan.firstKind}
                stem={plan.firstStem}
                box={plan.first}
                growth={frame.first}
                opacity={ghostOpacity}
                layout={layout}
                colors={colors}
                clock={clock}
                question={set.firstQuestion}
                copy={demoCopy}
                labels={kindLabels}
                pressed={frame.firstNodeButtonPress}
              />
            )}
            {frame.second && (
              <DemoGrowth
                kind={plan.secondKind}
                stem={plan.secondStem}
                box={plan.second}
                growth={frame.second}
                opacity={ghostOpacity}
                layout={layout}
                colors={colors}
                clock={clock}
                question={set.secondQuestion}
                copy={demoCopy}
                labels={kindLabels}
                pressed={null}
              />
            )}
          </>
        )}

        <div
          data-testid="home-demo-card"
          onPointerDown={handlePointerDown}
          onClick={onCardClick}
          className="home-demo-card"
          style={{
            position: "absolute",
            left: cardRect.x,
            top: cardRect.y,
            width: cardRect.width,
            height: cardRect.height,
            boxSizing: "border-box",
            border: `1px solid ${theme.border}`,
            borderRadius: mix(layout.card.radius, HOME_DEMO_FULL_RADIUS, morph),
            background: theme.surface,
            boxShadow: theme.ring,
            opacity: closing?.cardOpacity ?? 1,
            pointerEvents: "auto",
            cursor: "text",
          }}
        >
          <DemoRootContent
            layout={layout}
            frame={frame}
            fade={fade}
            clock={clock}
            copy={demoCopy}
            opacity={closing?.contentOpacity ?? 1}
          />
        </div>

        {frame.cursor && frame.cursor.opacity > 0 && fade > 0 && (
          <>
            <DemoRipple x={frame.cursor.rippleX} y={frame.cursor.rippleY} progress={frame.cursor.ripple} />
            <DemoArrow
              x={frame.cursor.x}
              y={frame.cursor.y}
              opacity={frame.cursor.opacity * fade}
              press={frame.cursor.press}
            />
          </>
        )}
        {frame.taps.map((tap, index) =>
          tap.opacity > 0 && fade > 0 ? (
            <div
              key={index}
              style={{
                position: "absolute",
                left: tap.x - 17,
                top: tap.y - 17,
                width: 34,
                height: 34,
                borderRadius: 999,
                background: "color-mix(in srgb, var(--theme-brand-900) 28%, transparent)",
                border: "2px solid rgba(255,255,255,0.85)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                opacity: tap.opacity * fade,
                transform: `scale(${1 - tap.press * 0.22})`,
              }}
            />
          ) : null,
        )}
      </div>
    </ViewportPortal>
  );
}

type DemoCopy = ReturnType<typeof useLanguage>["copy"]["home"]["onboardingDemo"];

function Caret({ clock, color }: { clock: number; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 2,
        height: "1.05em",
        marginLeft: 2,
        // Zero net advance, so the caret never pushes a full line onto a new one.
        marginRight: -4,
        verticalAlign: "-0.15em",
        background: color,
        opacity: isCaretVisible(clock) ? 1 : 0,
      }}
    />
  );
}

function DemoIconButton({
  Icon,
  size,
  color,
  press = 0,
  dim = false,
}: {
  Icon: ComponentType<{ size?: number }>;
  size: number;
  color: string;
  press?: number;
  dim?: boolean;
}) {
  const pressed = press > 0.05;
  return (
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        boxSizing: "border-box",
        borderRadius: 8,
        border: `1px solid ${pressed ? theme.dark : theme.border}`,
        background: pressed ? theme.dark : theme.muted,
        color: pressed ? theme.onDark : color,
        opacity: dim && !pressed ? 0.6 : 1,
        transform: `scale(${1 - press * 0.08})`,
      }}
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

function DemoRootContent({
  layout,
  frame,
  fade,
  clock,
  copy,
  opacity,
}: {
  layout: HomeDemoLayout;
  frame: HomeDemoFrame;
  fade: number;
  clock: number;
  copy: DemoCopy;
  opacity: number;
}) {
  const { card, font, button } = layout;
  const press = frame.rootButtonPress;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: card.width,
        height: card.height,
        boxSizing: "border-box",
        padding: `${card.paddingY}px ${card.paddingX}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        opacity,
      }}
    >
      <div>
        <div
          style={{
            fontSize: font.label,
            lineHeight: `${font.labelLine}px`,
            fontWeight: 900,
            letterSpacing: "0.16em",
            color: theme.label,
          }}
        >
          {copy.label}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: font.title,
            lineHeight: `${font.titleLine}px`,
            minHeight: font.titleLine,
            fontWeight: 700,
          }}
        >
          {frame.rootText ? (
            <span style={{ color: theme.text, opacity: frame.rootTextOpacity * fade }}>
              {frame.rootText}
              {frame.rootTyping && <Caret clock={clock} color={theme.text} />}
            </span>
          ) : (
            <span style={{ color: theme.textMuted, fontWeight: 500, opacity: frame.placeholderOpacity }}>
              {copy.placeholder}
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: font.text,
            lineHeight: `${font.textLine}px`,
            color: theme.textMuted,
            fontWeight: 500,
            opacity: fade,
          }}
        >
          {copy.hint}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: button.gap, opacity: fade }}>
          <DemoIconButton
            Icon={Sprout}
            size={button.size}
            color={theme.dark}
            press={press.kind === "continue" ? press.press : 0}
          />
          <DemoIconButton
            Icon={GitBranch}
            size={button.size}
            color={theme.dark}
            press={press.kind === "branch" ? press.press : 0}
          />
        </div>
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: button.size,
            height: button.size,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--theme-brand-900) 50%, transparent)",
            color: theme.onDark,
          }}
        >
          <Send size={Math.round(button.size * 0.44)} />
        </span>
      </div>
    </div>
  );
}

function DemoGrowth({
  kind,
  stem,
  box,
  growth,
  opacity,
  layout,
  colors,
  clock,
  question,
  copy,
  labels,
  pressed,
}: {
  kind: HomeDemoKind;
  stem: HomeDemoStem;
  box: HomeDemoRect;
  growth: HomeDemoGrowthFrame;
  opacity: number;
  layout: HomeDemoLayout;
  colors: DemoColors;
  clock: number;
  question: string;
  copy: DemoCopy;
  labels: { continue: string; branch: string };
  pressed: { kind: HomeDemoKind; press: number } | null;
}) {
  const color = colors[kind];
  const solid = rgba(color, 1);
  const dashed = rgba(color, 0.6);
  const leaf = growth.leaf;
  const { card, font, button } = layout;
  const Icon = kind === "continue" ? Sprout : GitBranch;
  const typingDone = growth.title.length === Array.from(question).length;
  return (
    <>
      <svg
        width={1}
        height={1}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity }}
      >
        <circle cx={stem[0].x} cy={stem[0].y} r={3.4} fill={solid} opacity={0.8} />
        <path
          d={stemPath(stem)}
          fill="none"
          stroke={solid}
          strokeOpacity={0.72}
          strokeWidth={layout.stem.strokeWidth}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - growth.stemProgress}
        />
        {growth.leaflets.map((leaflet, index) => (
          <path key={index} d={leaflet.path} fill={solid} fillOpacity={0.5} />
        ))}
        {growth.budPath && <path d={growth.budPath} fill={solid} fillOpacity={0.6} />}
        {leaf && (
          <g opacity={1 - growth.cardOpacity}>
            <path d={leaf.path} fill={mixRgba(color, 0.4, colors.surface, 0.8, leaf.morph)} />
            <path d={leaf.path} fill="none" stroke={solid} strokeOpacity={0.75 * (1 - leaf.morph)} strokeWidth={1.4} />
            <path d={leaf.path} fill="none" stroke={dashed} strokeOpacity={leaf.morph} strokeWidth={1.5} strokeDasharray="6 5" />
            {leaf.midrib && (
              <line
                {...leaf.midrib}
                stroke={solid}
                strokeOpacity={0.55 * (1 - leaf.morph)}
                strokeWidth={1.2}
                strokeLinecap="round"
              />
            )}
          </g>
        )}
        {growth.cardOpacity > 0 && (
          <rect
            x={box.x + 0.75}
            y={box.y + 0.75}
            width={box.width - 1.5}
            height={box.height - 1.5}
            rx={card.radius}
            fill={rgba(colors.surface, 0.8)}
            stroke={dashed}
            strokeWidth={1.5}
            strokeDasharray="6 5"
            opacity={growth.cardOpacity}
          />
        )}
      </svg>
      {growth.contentOpacity > 0 && (
        <div
          data-testid="home-demo-ghost"
          data-kind={kind}
          style={{
            position: "absolute",
            left: box.x,
            top: box.y,
            width: card.width,
            height: card.height,
            boxSizing: "border-box",
            padding: `${card.paddingY}px ${card.paddingX}px`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            opacity: growth.contentOpacity * opacity,
          } as CSSProperties}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: font.label,
                  lineHeight: `${font.labelLine}px`,
                  fontWeight: 900,
                  letterSpacing: "0.16em",
                  color: kindVar(kind),
                }}
              >
                <Icon size={font.label + 1} />
                {kind === "continue" ? labels.continue : labels.branch}
              </span>
              <span
                style={{
                  fontSize: font.label - 0.5,
                  lineHeight: `${font.labelLine + 3}px`,
                  fontWeight: 800,
                  color: theme.textMuted,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 999,
                  padding: "0 7px",
                  background: theme.muted,
                }}
              >
                {copy.example}
              </span>
            </div>
            <div
              style={{
                marginTop: 6,
                minHeight: font.titleLine,
                fontSize: font.title,
                lineHeight: `${font.titleLine}px`,
                fontWeight: 900,
                color: theme.dark,
              }}
            >
              {growth.title}
              {growth.typing && <Caret clock={clock} color={theme.dark} />}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: font.text,
                lineHeight: `${font.textLine}px`,
                fontWeight: 500,
                color: theme.textMuted,
                opacity: typingDone ? growth.explanationOpacity : 0,
              }}
            >
              {kind === "continue" ? copy.explainContinue : copy.explainBranch}
            </div>
          </div>
          <div style={{ display: "flex", gap: button.gap }}>
            <DemoIconButton
              Icon={Sprout}
              size={button.size}
              color={theme.dark}
              dim
              press={pressed?.kind === "continue" ? pressed.press : 0}
            />
            <DemoIconButton
              Icon={GitBranch}
              size={button.size}
              color={theme.dark}
              dim
              press={pressed?.kind === "branch" ? pressed.press : 0}
            />
            <DemoIconButton Icon={Ribbon} size={button.size} color={theme.fold} dim />
          </div>
        </div>
      )}
    </>
  );
}

function DemoArrow({ x, y, opacity, press }: { x: number; y: number; opacity: number; press: number }) {
  return (
    <svg
      width={26}
      height={30}
      viewBox="-2 -2 26 30"
      style={{
        position: "absolute",
        left: x - 2,
        top: y - 2,
        opacity,
        overflow: "visible",
        transform: `scale(${1 - press * 0.12})`,
        transformOrigin: "2px 2px",
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.25))",
      }}
    >
      <path
        d="M0 0 L0 20 L5.2 15.4 L8.8 23.6 L12.4 22 L8.9 14 L15.6 14 Z"
        fill="#ffffff"
        stroke="var(--theme-brand-900)"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DemoRipple({ x, y, progress }: { x: number; y: number; progress: number }) {
  if (progress <= 0 || progress >= 1) return null;
  const radius = 6 + 18 * progress;
  return (
    <div
      style={{
        position: "absolute",
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: 999,
        border: "2px solid color-mix(in srgb, var(--theme-brand-900) 50%, transparent)",
        opacity: 1 - progress,
      }}
    />
  );
}
