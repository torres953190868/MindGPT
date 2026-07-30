import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";

const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

import {
  filterAdminUsersByQuery,
  listAdminUsers,
  resetAdminUserPassword,
} from "@/lib/server/admin-users";

describe("filterAdminUsersByQuery", () => {
  const users = [
    { accountName: "alice", email: null },
    { accountName: "bob", email: "bob@example.com" },
    { accountName: null, email: "carol@example.com" },
  ];

  it("returns every user for a blank query", () => {
    expect(filterAdminUsersByQuery(users, "  ")).toEqual(users);
  });

  it("matches account names case-insensitively", () => {
    expect(filterAdminUsersByQuery(users, "ALI")).toEqual([users[0]]);
  });

  it("matches public emails by substring", () => {
    expect(filterAdminUsersByQuery(users, "example.com")).toEqual([
      users[1],
      users[2],
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterAdminUsersByQuery(users, "nobody")).toEqual([]);
  });
});

describe("admin user storage guard", () => {
  beforeEach(() => {
    hasSupabaseServerConfigMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    hasSupabaseServerConfigMock.mockReturnValue(false);
  });

  it("rejects listAdminUsers with a 503 without Supabase config", async () => {
    const error = await listAdminUsers({ page: 1 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect((error as HttpError).code).toBe("ADMIN_USERS_NOT_CONFIGURED");
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects resetAdminUserPassword with a 503 without Supabase config", async () => {
    const error = await resetAdminUserPassword("user_test", "long-enough-password").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect((error as HttpError).code).toBe("ADMIN_USERS_NOT_CONFIGURED");
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects short passwords before calling Supabase", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);

    const error = await resetAdminUserPassword("user_test", "short").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as HttpError).code).toBe("ADMIN_PASSWORD_INVALID");
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});
