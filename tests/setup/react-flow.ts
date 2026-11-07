/**
 * Opt-in jsdom mocks for rendering a full `<ReactFlow>` canvas (e.g. MindMap).
 *
 * Based on the React Flow testing guide (https://reactflow.dev/learn/advanced-use/testing):
 * React Flow measures nodes with ResizeObserver + offsetWidth/offsetHeight and
 * reads the viewport zoom from a DOMMatrixReadOnly. jsdom has no layout, so
 * without these mocks nodes never initialise and edges are never drawn.
 *
 * Call `mockReactFlow()` at the top level of a test file (before rendering).
 * The mocks are per test file because each Vitest file runs in its own jsdom.
 */
import { act } from "@testing-library/react";
import { afterAll, beforeAll } from "vitest";

/**
 * ResizeObserver that reports each observed element once, on a microtask.
 *
 * Unlike the synchronous mock in the React Flow guide, the callback is deferred:
 * nodes start observing in their own effects, before the ancestor pane effect
 * registers the canvas DOM node, and a synchronous report would be dropped.
 */
class MeasuringResizeObserver implements ResizeObserver {
  private readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.observed.add(target);
    queueMicrotask(() => {
      if (!this.observed.has(target)) return;
      act(() => {
        this.callback([{ target } as ResizeObserverEntry], this);
      });
    });
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }
}

/** Only `m22` (the scale) is read by React Flow. */
class ScaleOnlyDOMMatrixReadOnly {
  m22: number;

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

export function mockReactFlow() {
  const originals = {
    ResizeObserver: window.ResizeObserver,
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  };

  beforeAll(() => {
    window.ResizeObserver = MeasuringResizeObserver;
    Object.defineProperty(window, "DOMMatrixReadOnly", {
      configurable: true,
      writable: true,
      value: ScaleOnlyDOMMatrixReadOnly,
    });
    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: {
        configurable: true,
        get(this: HTMLElement) {
          return Number.parseFloat(this.style.height) || 1;
        },
      },
      offsetWidth: {
        configurable: true,
        get(this: HTMLElement) {
          return Number.parseFloat(this.style.width) || 1;
        },
      },
    });
  });

  afterAll(() => {
    window.ResizeObserver = originals.ResizeObserver;
    if (originals.offsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originals.offsetHeight);
    }
    if (originals.offsetWidth) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originals.offsetWidth);
    }
  });
}
