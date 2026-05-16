"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, LogIn, LogOut } from "lucide-react";
import { writeRememberedAuthEmail } from "@/lib/client/auth-email";

type AuthSession = {
  configured: boolean;
  user: { id: string; email: string | null } | null;
};

type AuthPanelProps = {
  className?: string;
  placement?: "bottom" | "top";
};

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

function getCurrentNextPath() {
  if (typeof window === "undefined") return "/projects";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getInitial(email: string | null | undefined) {
  return email?.trim().charAt(0).toUpperCase() || "B";
}

export function AuthPanel({ className = "", placement = "bottom" }: AuthPanelProps) {
  const menuRef = useRef<HTMLElement | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"logout" | null>(null);
  const [signInHref, setSignInHref] = useState("/auth/sign-in");
  const popoverPosition = placement === "top" ? "bottom-full mb-2" : "top-full mt-2";

  async function refreshSession() {
    const response = await fetch("/api/auth/session");
    const data = (await response.json().catch(() => null)) as AuthSession | null;
    if (response.ok && data) setSession(data);
  }

  useEffect(() => {
    void refreshSession();
    const params = new URLSearchParams({ next: getCurrentNextPath() });
    setSignInHref(`/auth/sign-in?${params.toString()}`);
  }, []);

  useEffect(() => {
    if (session?.user?.email) writeRememberedAuthEmail(session.user.email);
  }, [session?.user?.email]);

  useEffect(() => {
    if (!isMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isMenuOpen]);

  async function handleLogout() {
    setSubmittingAction("logout");
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data));
      setSession((current) => current ? { ...current, user: null } : current);
      setIsMenuOpen(false);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-out failed.");
    } finally {
      setSubmittingAction(null);
    }
  }

  if (session && !session.configured) {
    return (
      <section aria-label="Local authentication mode" className={`inline-flex ${className}`}>
        <div
          role="status"
          data-testid="auth-local-mode-status"
          className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-white/75 px-4 py-2.5 text-sm font-black text-[#5d5168] shadow-sm"
        >
          <CheckCircle2 size={16} />
          Local dev mode
        </div>
      </section>
    );
  }

  if (session?.user) {
    return (
      <section
        ref={menuRef}
        aria-label="User profile"
        data-testid="user-profile"
        className={`relative inline-flex justify-end text-sm ${className}`}
      >
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          aria-haspopup="dialog"
          aria-expanded={isMenuOpen}
          data-testid="account-menu-button"
          className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[18px] bg-white/78 px-3 py-2.5 font-black text-[#554665] shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e5f6ee] text-xs text-[#3d7558]">
            {getInitial(session.user.email)}
          </span>
          <span className="max-w-36 truncate">{session.user.email ?? "Signed in"}</span>
          <ChevronDown size={15} />
        </button>

        {isMenuOpen && (
          <div
            role="dialog"
            aria-label="Account menu"
            data-testid="account-menu-popover"
            className={`absolute right-0 z-50 w-64 rounded-[22px] border border-white/85 bg-white/95 p-3 text-left shadow-2xl shadow-[#dfcfe9]/45 backdrop-blur ${popoverPosition}`}
          >
            <div className="rounded-[16px] bg-[#f7f3fb] px-3 py-2.5">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#74687c]">
                Signed in
              </p>
              <p className="mt-1 truncate text-sm font-black text-[#342b3a]">
                {session.user.email ?? "BranchMind account"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={submittingAction === "logout"}
              aria-label="Sign out"
              data-testid="sign-out-button"
              className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] bg-[#ffeceb] px-4 text-sm font-black text-[#8f3f3a] transition hover:bg-[#ffd7d4] disabled:cursor-not-allowed disabled:opacity-65"
            >
              <LogOut size={16} />
              {submittingAction === "logout" ? "Signing out..." : "Sign out"}
            </button>
            {error && (
              <p role="alert" data-testid="auth-error" className="mt-2 text-xs font-bold text-[#8f3f3a]">
                {error}
              </p>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      ref={menuRef}
      aria-label="User sign in"
      data-testid="user-sign-in"
      className={`relative inline-flex justify-end text-sm ${className}`}
    >
      <Link
        href={signInHref}
        data-testid="account-sign-in-button"
        className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-[#f1e8fb] px-4 py-2.5 font-black text-[#5d427d] shadow-sm transition hover:bg-[#e4d5f6] focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
      >
        <LogIn size={17} />
        Sign in
      </Link>
    </section>
  );
}
