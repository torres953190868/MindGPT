/**
 * Setup for the `dom` Vitest project: React component tests (`*.test.tsx`) in jsdom.
 *
 * Node-environment tests (`*.test.ts`) never load this file.
 *
 * Shims are intentionally minimal: only browser APIs that jsdom lacks and that
 * BranchMind components touch during render or common interactions.
 * React Flow needs a few extra measurement mocks; those live in
 * `tests/setup/react-flow.ts` and are opt-in per test file.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// --- One-time browser API shims (jsdom does not implement these) -----------

/** No-op ResizeObserver; components only use it to react to layout changes. */
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in window)) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: NoopResizeObserver,
  });
}

/** `matchMedia` that never matches (desktop, no reduced-motion preference). */
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Scrolling is a no-op in jsdom; conversation panels call these on update. */
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// --- Per-test state --------------------------------------------------------

/**
 * Unmocked network calls fail loudly-but-harmlessly with a 404 so components
 * that fetch on mount (auth session, model catalog) render their fallback
 * state. Tests that care about a request install their own `fetch` mock.
 */
function unmockedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return Promise.resolve(
    new Response(JSON.stringify({ error: `No fetch mock for ${url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // `unstubGlobals: true` in vitest.config.ts restores these after each test.
  vi.stubGlobal("fetch", vi.fn(unmockedFetch));
  // Note: `userEvent.setup()` replaces this with its own clipboard stub.
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.resolve("")),
    },
  });
});

afterEach(() => {
  cleanup();
});
