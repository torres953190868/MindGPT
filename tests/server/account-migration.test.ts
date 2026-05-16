import { beforeEach, describe, expect, it, vi } from "vitest";

const transferProjectsOwnerMock = vi.hoisted(() => vi.fn());
const transferRagOwnerMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/projects-repository", () => ({
  transferProjectsOwner: transferProjectsOwnerMock,
}));

vi.mock("@/lib/server/rag/store", () => ({
  transferRagOwner: transferRagOwnerMock,
}));

import {
  migrateAnonymousDataToUser,
  tryMigrateAnonymousDataToUser,
} from "@/lib/server/account-migration";

describe("account data migration", () => {
  beforeEach(() => {
    transferProjectsOwnerMock.mockReset();
    transferRagOwnerMock.mockReset();
    transferProjectsOwnerMock.mockResolvedValue(0);
    transferRagOwnerMock.mockResolvedValue(0);
  });

  it("skips missing or identical owners", async () => {
    await expect(migrateAnonymousDataToUser(null, "user_1")).resolves.toMatchObject({
      skipped: true,
      projectsUpdated: 0,
      documentsUpdated: 0,
    });
    await expect(migrateAnonymousDataToUser("user_1", "user_1")).resolves.toMatchObject({
      skipped: true,
    });
    expect(transferProjectsOwnerMock).not.toHaveBeenCalled();
    expect(transferRagOwnerMock).not.toHaveBeenCalled();
  });

  it("transfers projects and documents to the authenticated user", async () => {
    transferProjectsOwnerMock.mockResolvedValue(2);
    transferRagOwnerMock.mockResolvedValue(3);

    await expect(
      migrateAnonymousDataToUser(" anon_session_123 ", " user_123 "),
    ).resolves.toEqual({
      ok: true,
      projectsUpdated: 2,
      documentsUpdated: 3,
      skipped: false,
    });
    expect(transferProjectsOwnerMock).toHaveBeenCalledWith(
      "anon_session_123",
      "user_123",
    );
    expect(transferRagOwnerMock).toHaveBeenCalledWith(
      "anon_session_123",
      "user_123",
    );
  });

  it("returns a non-fatal result when transfer fails", async () => {
    transferProjectsOwnerMock.mockRejectedValue(new Error("database unavailable"));

    await expect(
      tryMigrateAnonymousDataToUser("anon_session_123", "user_123"),
    ).resolves.toMatchObject({
      ok: false,
      skipped: false,
    });
  });
});
