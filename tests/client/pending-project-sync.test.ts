import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPendingProjectSyncRecord,
  PENDING_PROJECT_SYNC_KEY,
  readPendingProjectSyncRecords,
  removePendingProjectSyncRecord,
  upsertPendingProjectSyncRecord,
} from "@/lib/client/pending-project-sync";
import {
  MemoryStorage,
  ReadOnlyStorage,
  stubBlockedStorageWindow,
  stubStorageWindow,
} from "./blocked-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pending project sync storage", () => {
  it("round-trips records and treats malformed JSON as empty", () => {
    const storage = new MemoryStorage();
    stubStorageWindow(storage);
    const record = createPendingProjectSyncRecord("Learn Rust");

    upsertPendingProjectSyncRecord(record);
    expect(readPendingProjectSyncRecords().map((item) => item.project.id)).toEqual([
      record.project.id,
    ]);

    removePendingProjectSyncRecord(record.project.id);
    expect(readPendingProjectSyncRecords()).toEqual([]);

    storage.setItem(PENDING_PROJECT_SYNC_KEY, "{broken");
    expect(readPendingProjectSyncRecords()).toEqual([]);
  });

  it("reads no records when storage access is blocked", () => {
    stubBlockedStorageWindow();

    expect(readPendingProjectSyncRecords()).toEqual([]);
  });

  it("reports write failures to the caller so it can fall back to the server", () => {
    // `persistPendingSyncRecord` relies on these throwing to choose the direct
    // server create path instead of an optimistic local project.
    const record = createPendingProjectSyncRecord("Learn Rust");

    stubBlockedStorageWindow();
    expect(() => upsertPendingProjectSyncRecord(record)).toThrow();

    stubStorageWindow(new ReadOnlyStorage());
    expect(() => upsertPendingProjectSyncRecord(record)).toThrow();
  });
});
