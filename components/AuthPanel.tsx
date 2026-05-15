"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Chrome, LogOut, Mail, UserCircle } from "lucide-react";

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
  const emailInputId = useId();
  const menuRef = useRef<HTMLElement | null>(null);
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<
    "email" | "google" | "logout" | null
  >(null);
  const isSubmitting = submittingAction !== null;
  const popoverPosition = placement === "top" ? "bottom-full mb-2" : "top-full mt-2";

  async function refreshSession() {
    const response = await fetch("/api/auth/session");
    const data = (await response.json().catch(() => null)) as AuthSession | null;
    if (response.ok && data) setSession(data);
  }

  useEffect(() => {
    void refreshSession();
  }, []);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || isSubmitting) return;

    setSubmittingAction("email");
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), next: getCurrentNextPath() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data));
      setStatus("Check your email for a BranchMind sign-in link.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-in failed.");
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleGoogleSignIn() {
    if (isSubmitting) return;

    setSubmittingAction("google");
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next: getCurrentNextPath() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data));

      const url = data && typeof data === "object" ? (data as { url?: unknown }).url : null;
      if (typeof url !== "string" || !url) {
        throw new Error("Google sign-in did not return a redirect URL.");
      }

      window.location.assign(url);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Google sign-in failed.");
      setSubmittingAction(null);
    }
  }

  async function handleLogout() {
    setSubmittingAction("logout");
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data));
      setEmail("");
      setSession((current) => current ? { ...current, user: null } : current);
      setIsMenuOpen(false);
      setStatus("Signed out.");
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
      <button
        type="button"
        onClick={() => setIsMenuOpen((open) => !open)}
        aria-haspopup="dialog"
        aria-expanded={isMenuOpen}
        data-testid="account-sign-in-button"
        className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-[#f1e8fb] px-4 py-2.5 font-black text-[#5d427d] shadow-sm transition hover:bg-[#e4d5f6] focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
      >
        <UserCircle size={17} />
        Sign in
      </button>

      {isMenuOpen && (
        <div
          role="dialog"
          aria-label="Sign in to BranchMind"
          data-testid="account-sign-in-popover"
          className={`absolute right-0 z-50 w-64 rounded-[22px] border border-white/85 bg-white/95 p-3 text-left shadow-2xl shadow-[#dfcfe9]/45 backdrop-blur sm:w-72 ${popoverPosition}`}
        >
          <div>
            <p className="text-sm font-black text-[#342b3a]">Sign in to BranchMind</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#6f6478]">
              Use an email magic link or Google account.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <label className="sr-only" htmlFor={emailInputId}>
              Email
            </label>
            <input
              id={emailInputId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
              aria-label="Email address"
              data-testid="auth-email-input"
              placeholder="Email"
              className="h-11 w-full rounded-[16px] border border-[#e8ddf2] bg-white px-3 text-sm text-[#332b38] outline-none transition placeholder:text-[#7b7183] focus:border-[#a98cc9] focus:ring-4 focus:ring-[#eadcf6]"
            />
            <button
              type="submit"
              disabled={isSubmitting || !email.trim()}
              aria-label="Email sign-in link"
              data-testid="email-sign-in-button"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] bg-[#f1e8fb] px-4 text-sm font-black text-[#5d427d] transition hover:bg-[#e4d5f6] disabled:cursor-not-allowed disabled:opacity-65"
            >
              <Mail size={16} />
              {submittingAction === "email" ? "Sending..." : "Email magic link"}
            </button>
          </form>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting}
            data-testid="google-sign-in-button"
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] bg-[#e5f6ee] px-4 text-sm font-black text-[#3d7558] transition hover:bg-[#d8f0e4] disabled:cursor-not-allowed disabled:opacity-65"
          >
            <Chrome size={16} />
            {submittingAction === "google" ? "Opening Google..." : "Continue with Google"}
          </button>
          {status && (
            <p role="status" data-testid="auth-status" className="mt-2 text-xs font-bold text-[#315f47]">
              {status}
            </p>
          )}
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
