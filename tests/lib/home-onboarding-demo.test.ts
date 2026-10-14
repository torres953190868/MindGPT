import { describe, expect, it } from "vitest";
import {
  HOME_DEMO_CARD_MAX_LIFT,
  HOME_DEMO_COMPACT_LAYOUT,
  HOME_DEMO_HERO_GAP,
  HOME_DEMO_LOOP_SECONDS,
  HOME_DEMO_REGULAR_LAYOUT,
  HOME_DEMO_TIMELINE,
  getButtonCenter,
  getCameraAt,
  getCameraStops,
  getDemoCardRect,
  getHeroOpacity,
  getHomeDemoFrame,
  getHomeDemoPlan,
  getTypingEnd,
  getTypingPerChar,
  springProgress,
  typedText,
} from "@/lib/home-onboarding-demo";
import { LANGUAGE_COPY } from "@/lib/language-copy";

const composerBox = { x: 0, y: 0, width: 760, height: 242 };
const canvas = { width: 1366, height: 768, leftInset: 0 };
const home = { x: 183, y: 159, zoom: 1 };

describe("home onboarding demo timing", () => {
  it("matches the approved spring (damping 13, stiffness 120, mass 0.75)", () => {
    expect(springProgress(0)).toBe(0);
    expect(springProgress(0.33)).toBeCloseTo(1.052, 3);
    expect(springProgress(2)).toBeCloseTo(1, 3);
  });

  it("types one character per step and never past the end", () => {
    expect(typedText("abc", 0.4, 0.5, 0.1)).toBe("");
    expect(typedText("abc", 0.5, 0.5, 0.1)).toBe("a");
    expect(typedText("abc", 0.71, 0.5, 0.1)).toBe("abc");
    expect(typedText("abc", 9, 0.5, 0.1)).toBe("abc");
    expect(typedText("问题？", 0.61, 0.5, 0.1)).toBe("问题");
  });

  it.each(["zh", "en"] as const)("finishes typing before each click (%s)", (language) => {
    const { sets } = LANGUAGE_COPY[language].home.onboardingDemo;
    const t = HOME_DEMO_TIMELINE;
    for (const set of sets) {
      const rootEnd = getTypingEnd(
        set.root,
        t.typeStart,
        getTypingPerChar(set.root, t.typePerChar, t.typeMaxDuration),
      );
      expect(rootEnd).toBeLessThan(2.1);
      for (const [question, growth, next] of [
        [set.firstQuestion, t.firstGrowth, 6.1],
        [set.secondQuestion, t.secondGrowth, t.returnStart - 0.5],
      ] as const) {
        const end = getTypingEnd(
          question,
          growth + t.ghostTypeDelay,
          getTypingPerChar(question, t.ghostTypePerChar, t.ghostTypeMaxDuration),
        );
        expect(end).toBeLessThan(next);
      }
    }
  });
});

describe("home onboarding demo layout", () => {
  it("centers the card on the composer and lifts it without crowding the hero", () => {
    const free = getDemoCardRect(composerBox, HOME_DEMO_REGULAR_LAYOUT, null);
    expect(free.x + free.width / 2).toBe(composerBox.width / 2);
    expect(free.y).toBe((composerBox.height - free.height) / 2 - HOME_DEMO_CARD_MAX_LIFT);

    const heroBottom = -20;
    const clamped = getDemoCardRect(composerBox, HOME_DEMO_REGULAR_LAYOUT, heroBottom);
    expect(clamped.y).toBe(heroBottom + HOME_DEMO_HERO_GAP);
  });

  it("grows continue below and branch to the right", () => {
    const root = { x: 0, y: 0, width: 292, height: 180 };
    const plan = getHomeDemoPlan(root, "continue", HOME_DEMO_REGULAR_LAYOUT);
    expect(plan.secondKind).toBe("branch");
    expect(plan.first).toEqual({ ...root, y: 180 + 150 });
    expect(plan.second).toEqual({ ...plan.first, x: 292 + 170 });
    expect(plan.firstStem[0]).toEqual({ x: 146, y: 180 });
    expect(plan.secondStem[3]).toEqual({ x: 292 + 170, y: plan.first.y + 90 });

    const compact = getHomeDemoPlan(
      { x: 0, y: 0, width: 244, height: 183 },
      "branch",
      HOME_DEMO_COMPACT_LAYOUT,
    );
    expect(compact.first.x).toBe(244 + 104);
    expect(compact.second.y).toBe(183 + 120);
  });

  it("puts the root buttons where the card draws them", () => {
    const root = { x: 10, y: 20, width: 292, height: 180 };
    expect(getButtonCenter(root, "continue", HOME_DEMO_REGULAR_LAYOUT)).toEqual({
      x: 10 + 20 + 16,
      y: 20 + 180 - 18 - 16,
    });
    expect(getButtonCenter(root, "branch", HOME_DEMO_REGULAR_LAYOUT).x).toBe(10 + 20 + 16 + 40);
  });
});

describe("home onboarding demo camera", () => {
  const root = getDemoCardRect(composerBox, HOME_DEMO_REGULAR_LAYOUT, null);
  const plan = getHomeDemoPlan(root, "continue", HOME_DEMO_REGULAR_LAYOUT);
  const stops = getCameraStops(home, plan, canvas, HOME_DEMO_REGULAR_LAYOUT);

  it("frames the continuation at 2/3 height, then the branch at 2/3 width", () => {
    expect(stops.first.x).toBe(home.x);
    expect(stops.first.y + (plan.first.y + plan.first.height / 2)).toBeCloseTo(768 * (2 / 3));
    expect(stops.second.y).toBe(stops.first.y);
    expect(stops.second.x + (plan.second.x + plan.second.width / 2)).toBeCloseTo(1366 * (2 / 3));
  });

  it("starts at home, settles on each stop, and is back home when the loop ends", () => {
    expect(getCameraAt(0, stops)).toMatchObject({ x: home.x, y: home.y });
    const first = getCameraAt(HOME_DEMO_TIMELINE.secondGrowth - 0.01, stops);
    expect(Math.abs(first.y - stops.first.y)).toBeLessThan(1);
    const second = getCameraAt(HOME_DEMO_TIMELINE.returnStart - 0.01, stops);
    expect(Math.abs(second.x - stops.second.x)).toBeLessThan(1);
    const end = getCameraAt(HOME_DEMO_LOOP_SECONDS, stops);
    expect(Math.abs(end.x - home.x)).toBeLessThan(1);
    expect(Math.abs(end.y - home.y)).toBeLessThan(1);
  });

  it("fades the hero out as the camera moves away", () => {
    expect(getHeroOpacity(0)).toBe(1);
    expect(getHeroOpacity(-55)).toBeCloseTo(0.5);
    expect(getHeroOpacity(-500)).toBe(0);
  });
});

describe("home onboarding demo frame", () => {
  const set = LANGUAGE_COPY.zh.home.onboardingDemo.sets[0];
  const root = getDemoCardRect(composerBox, HOME_DEMO_REGULAR_LAYOUT, null);
  const plan = getHomeDemoPlan(root, set.first, HOME_DEMO_REGULAR_LAYOUT);

  it("shows the placeholder, then the typed question, then both ghost nodes", () => {
    const start = getHomeDemoFrame(0, set, plan, HOME_DEMO_REGULAR_LAYOUT);
    expect(start.rootText).toBe("");
    expect(start.placeholderOpacity).toBe(1);
    expect(start.first?.stemProgress ?? 0).toBe(0);

    const late = getHomeDemoFrame(9.5, set, plan, HOME_DEMO_REGULAR_LAYOUT);
    expect(late.rootText).toBe(set.root);
    expect(late.first?.title).toBe(set.firstQuestion);
    expect(late.second?.title).toBe(set.secondQuestion);
    expect(late.ghostOpacity).toBe(1);

    const returned = getHomeDemoFrame(11.2, set, plan, HOME_DEMO_REGULAR_LAYOUT);
    expect(returned.ghostOpacity).toBe(0);
    expect(returned.rootText).toBe("");
  });

  it("uses a cursor on desktop and taps on mobile", () => {
    const desktop = getHomeDemoFrame(2.2, set, plan, HOME_DEMO_REGULAR_LAYOUT);
    expect(desktop.cursor?.opacity).toBeGreaterThan(0);
    expect(desktop.taps).toHaveLength(0);

    const compactPlan = getHomeDemoPlan(
      getDemoCardRect(composerBox, HOME_DEMO_COMPACT_LAYOUT, null),
      set.first,
      HOME_DEMO_COMPACT_LAYOUT,
    );
    const mobile = getHomeDemoFrame(2.2, set, compactPlan, HOME_DEMO_COMPACT_LAYOUT);
    expect(mobile.cursor).toBeNull();
    expect(mobile.taps[0].opacity).toBeGreaterThan(0);
  });
});
