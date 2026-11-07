import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readRememberedAuthAccountName,
  REMEMBERED_AUTH_ACCOUNT_NAME_KEY,
  REMEMBERED_AUTH_EMAIL_KEY,
  writeRememberedAuthAccountName,
} from "@/lib/client/auth-email";
import {
  MemoryStorage,
  ReadOnlyStorage,
  stubBlockedStorageWindow,
  stubStorageWindow,
} from "./blocked-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remembered auth account name", () => {
  it("reads the account name, falling back to the legacy email key", () => {
    const storage = new MemoryStorage();
    stubStorageWindow(storage);

    expect(readRememberedAuthAccountName()).toBe("");
    storage.setItem(REMEMBERED_AUTH_EMAIL_KEY, "old@example.com");
    expect(readRememberedAuthAccountName()).toBe("old@example.com");

    writeRememberedAuthAccountName("  Alice  ");
    expect(storage.getItem(REMEMBERED_AUTH_ACCOUNT_NAME_KEY)).toBe("alice");
    expect(readRememberedAuthAccountName()).toBe("alice");
  });

  it("returns an empty name and skips writes when storage access is blocked", () => {
    stubBlockedStorageWindow();

    expect(readRememberedAuthAccountName()).toBe("");
    expect(() => writeRememberedAuthAccountName("alice")).not.toThrow();
  });

  it("ignores write failures such as an exceeded quota", () => {
    stubStorageWindow(new ReadOnlyStorage());

    expect(() => writeRememberedAuthAccountName("alice")).not.toThrow();
  });
});
