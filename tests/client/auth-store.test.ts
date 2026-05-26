import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountDto } from "@/app/api/account/route";

const signedInSession = {
  configured: true,
  user: {
    id: "user_123",
    email: null,
    accountName: "learner",
  },
};

const account: AccountDto = {
  email: null,
  accountName: "learner",
  displayName: "Learner",
  authMode: "supabase",
  authConfigured: true,
  plan: "pro",
  subscriptionStatus: "active",
  usage: {
    projects: { used: 1, limit: 50 },
    nodes: { used: 2, limit: 1000 },
    documents: { used: 0, limit: 25 },
    aiMessages: { used: 0, limit: 1000 },
  },
};

describe("useAuthStore", () => {
  afterEach(async () => {
    const { resetAuthStoreForTests } = await import("@/store/useAuthStore");
    resetAuthStoreForTests();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("dedupes concurrent session loads and caches the account", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/session") return Response.json(signedInSession);
      if (url === "/api/account") return Response.json(account);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAuthStore } = await import("@/store/useAuthStore");
    const firstLoad = useAuthStore.getState().ensureSessionLoaded();
    const secondLoad = useAuthStore.getState().ensureSessionLoaded();

    await Promise.all([firstLoad, secondLoad]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session");
    expect(fetchMock).toHaveBeenCalledWith("/api/account");
    expect(useAuthStore.getState()).toMatchObject({
      sessionStatus: "authenticated",
      accountStatus: "loaded",
      session: signedInSession,
      account,
    });

    await useAuthStore.getState().ensureSessionLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("force reloads the session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/session") {
        return Response.json({ configured: true, user: null });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAuthStore } = await import("@/store/useAuthStore");
    await useAuthStore.getState().ensureSessionLoaded();
    await useAuthStore.getState().ensureSessionLoaded({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().sessionStatus).toBe("anonymous");
  });

  it("does not load account data for anonymous or local sessions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ configured: true, user: null }))
      .mockResolvedValueOnce(Response.json({ configured: false, user: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { resetAuthStoreForTests, useAuthStore } = await import("@/store/useAuthStore");
    await useAuthStore.getState().ensureSessionLoaded();

    expect(useAuthStore.getState()).toMatchObject({
      sessionStatus: "anonymous",
      accountStatus: "idle",
      account: null,
    });

    resetAuthStoreForTests();
    await useAuthStore.getState().ensureSessionLoaded();

    expect(useAuthStore.getState()).toMatchObject({
      sessionStatus: "local",
      accountStatus: "idle",
      account: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears cached user and account data on sign out", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/session") return Response.json(signedInSession);
      if (url === "/api/account") return Response.json(account);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAuthStore } = await import("@/store/useAuthStore");
    await useAuthStore.getState().ensureSessionLoaded();
    useAuthStore.getState().markSignedOut();

    expect(useAuthStore.getState()).toMatchObject({
      sessionStatus: "anonymous",
      session: { configured: true, user: null },
      accountStatus: "idle",
      account: null,
    });
  });
});
