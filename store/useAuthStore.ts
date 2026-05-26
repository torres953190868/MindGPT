"use client";

import { create } from "zustand";
import type { AccountDto } from "@/app/api/account/route";

export type AuthSession = {
  configured: boolean;
  user: { id: string; email: string | null; accountName: string | null } | null;
};

export type AuthSessionStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "anonymous"
  | "local"
  | "error";

export type AuthAccountStatus = "idle" | "loading" | "loaded" | "error";

type LoadOptions = {
  force?: boolean;
};

type AuthStateData = {
  sessionStatus: AuthSessionStatus;
  session: AuthSession | null;
  accountStatus: AuthAccountStatus;
  account: AccountDto | null;
  error: string | null;
};

type AuthState = AuthStateData & {
  ensureSessionLoaded: (options?: LoadOptions) => Promise<AuthSession | null>;
  ensureAccountLoaded: (options?: LoadOptions) => Promise<AccountDto | null>;
  refreshAuth: (options?: LoadOptions) => Promise<AuthSession | null>;
  setAccountCache: (account: AccountDto) => void;
  markSignedOut: () => void;
};

const initialAuthState: AuthStateData = {
  sessionStatus: "idle",
  session: null,
  accountStatus: "idle",
  account: null,
  error: null,
};

let inFlightSessionRequest: Promise<AuthSession | null> | null = null;
let inFlightAccountRequest: Promise<AccountDto | null> | null = null;
let sessionRequestVersion = 0;
let accountRequestVersion = 0;

function readError(data: unknown) {
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }

  return "Authentication request failed.";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Authentication request failed.";
}

async function getJson<T>(path: string) {
  const response = await fetch(path);
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !data) throw new Error(readError(data));
  return data;
}

function getSessionStatus(session: AuthSession): AuthSessionStatus {
  if (!session.configured) return "local";
  if (session.user) return "authenticated";
  return "anonymous";
}

function shouldReuseSession(status: AuthSessionStatus) {
  return status === "authenticated" || status === "anonymous" || status === "local";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initialAuthState,

  ensureSessionLoaded: async ({ force = false } = {}) => {
    const state = get();

    if (!force && shouldReuseSession(state.sessionStatus)) {
      if (state.sessionStatus === "authenticated" && state.accountStatus === "idle") {
        void get().ensureAccountLoaded();
      }
      return state.session;
    }

    if (!force && inFlightSessionRequest) return inFlightSessionRequest;

    const requestVersion = ++sessionRequestVersion;
    inFlightSessionRequest = (async () => {
      set({ sessionStatus: "loading", error: null });

      try {
        const session = await getJson<AuthSession>("/api/auth/session");
        const sessionStatus = getSessionStatus(session);

        if (requestVersion !== sessionRequestVersion) return get().session;

        set({
          session,
          sessionStatus,
          account: sessionStatus === "authenticated" ? get().account : null,
          accountStatus:
            sessionStatus === "authenticated" ? get().accountStatus : "idle",
          error: null,
        });

        if (sessionStatus === "authenticated") {
          await get().ensureAccountLoaded({ force });
        }

        return session;
      } catch (error) {
        if (requestVersion !== sessionRequestVersion) return get().session;

        set({
          sessionStatus: "error",
          session: null,
          accountStatus: "idle",
          account: null,
          error: getErrorMessage(error),
        });
        return null;
      } finally {
        if (requestVersion === sessionRequestVersion) inFlightSessionRequest = null;
      }
    })();

    return inFlightSessionRequest;
  },

  ensureAccountLoaded: async ({ force = false } = {}) => {
    const state = get();

    if (state.sessionStatus !== "authenticated") return null;
    if (!force && state.accountStatus === "loaded") return state.account;
    if (!force && inFlightAccountRequest) return inFlightAccountRequest;

    const requestVersion = ++accountRequestVersion;
    inFlightAccountRequest = (async () => {
      set({ accountStatus: "loading", error: null });

      try {
        const account = await getJson<AccountDto>("/api/account");
        if (requestVersion !== accountRequestVersion) return get().account;

        set({ account, accountStatus: "loaded", error: null });
        return account;
      } catch (error) {
        if (requestVersion !== accountRequestVersion) return get().account;

        set({
          accountStatus: "error",
          account: null,
          error: getErrorMessage(error),
        });
        return null;
      } finally {
        if (requestVersion === accountRequestVersion) inFlightAccountRequest = null;
      }
    })();

    return inFlightAccountRequest;
  },

  refreshAuth: async ({ force = true } = {}) => {
    sessionRequestVersion += 1;
    accountRequestVersion += 1;
    inFlightSessionRequest = null;
    inFlightAccountRequest = null;
    set(initialAuthState);
    return get().ensureSessionLoaded({ force });
  },

  setAccountCache: (account) => {
    accountRequestVersion += 1;
    inFlightAccountRequest = null;
    set({ account, accountStatus: "loaded", error: null });
  },

  markSignedOut: () => {
    sessionRequestVersion += 1;
    accountRequestVersion += 1;
    inFlightSessionRequest = null;
    inFlightAccountRequest = null;
    set((state) => ({
      sessionStatus: "anonymous",
      session: { configured: state.session?.configured ?? true, user: null },
      accountStatus: "idle",
      account: null,
      error: null,
    }));
  },
}));

export function resetAuthStoreForTests() {
  sessionRequestVersion = 0;
  accountRequestVersion = 0;
  inFlightSessionRequest = null;
  inFlightAccountRequest = null;
  useAuthStore.setState(initialAuthState);
}
