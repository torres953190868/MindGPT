import { vi } from "vitest";

/**
 * Test helpers for browser storage that is unavailable: Safari with cookies
 * disabled or sandboxed iframes throw a `SecurityError` on property access, and
 * a full quota makes `setItem` throw.
 */

export function createSecurityError() {
  return new DOMException("The operation is insecure.", "SecurityError");
}

export class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

/** Storage whose reads work but whose writes and removes throw (e.g. quota exceeded). */
export class ReadOnlyStorage extends MemoryStorage {
  constructor(entries: Record<string, string> = {}) {
    super();
    for (const [key, value] of Object.entries(entries)) super.setItem(key, value);
  }

  setItem() {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }

  removeItem() {
    throw createSecurityError();
  }
}

/** Stubs a minimal `window` whose `localStorage`/`sessionStorage` getters throw. */
export function stubBlockedStorageWindow() {
  const blockedWindow: Record<string, unknown> = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  for (const key of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(blockedWindow, key, {
      get() {
        throw createSecurityError();
      },
    });
  }
  vi.stubGlobal("window", blockedWindow);
  return blockedWindow;
}

/** Stubs a minimal `window` backed by the given storage. */
export function stubStorageWindow(localStorage: Storage) {
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}
