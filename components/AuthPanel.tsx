"use client";

import { FormEvent, useEffect, useState } from "react";
import { LogOut, Mail } from "lucide-react";

type AuthSession = {
  configured: boolean;
  user: { id: string; email: string | null } | null;
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

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function refreshSession() {
    const response = await fetch("/api/auth/session");
    const data = (await response.json().catch(() => null)) as AuthSession | null;
    if (response.ok && data) setSession(data);
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data));
      setStatus("Check your email for a BranchMind sign-in link.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setIsSubmitting(true);
    setStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data));
      setEmail("");
      setSession((current) => current ? { ...current, user: null } : current);
      setStatus("Signed out.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-out failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (session && !session.configured) {
    return (
      <div
        role="status"
        data-testid="auth-local-mode-status"
        className="rounded-[18px] bg-white/75 px-4 py-3 text-sm font-black text-[#5d5168] shadow-sm"
      >
        Local dev mode
      </div>
    );
  }

  if (session?.user) {
    return (
      <section
        aria-label="User profile"
        data-testid="user-profile"
        className="flex flex-wrap items-center justify-end gap-2 text-sm"
      >
        <span className="rounded-[18px] bg-white/75 px-4 py-3 font-bold text-[#5d5168] shadow-sm">
          {session.user.email ?? "Signed in"}
        </span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isSubmitting}
          aria-label="Sign out"
          data-testid="sign-out-button"
          className="inline-flex h-11 items-center gap-2 rounded-[18px] bg-[#ffeceb] px-4 font-black text-[#8f3f3a] transition hover:bg-[#ffd7d4] disabled:cursor-not-allowed disabled:opacity-65"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </section>
    );
  }

  return (
    <section aria-label="User sign in" data-testid="user-sign-in" className="space-y-2">
      <form onSubmit={handleSubmit} className="flex flex-wrap justify-end gap-2">
        <label className="sr-only" htmlFor="auth-email-input">
          Email
        </label>
        <input
          id="auth-email-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          aria-label="Email address"
          data-testid="auth-email-input"
          placeholder="Email"
          className="h-11 w-56 rounded-[18px] border border-white/80 bg-white/80 px-4 text-sm text-[#332b38] outline-none transition placeholder:text-[#665a70] focus:border-[#a98cc9] focus:ring-4 focus:ring-[#eadcf6]"
        />
        <button
          type="submit"
          disabled={isSubmitting || !email.trim()}
          aria-label="Email sign-in link"
          data-testid="email-sign-in-button"
          className="inline-flex h-11 items-center gap-2 rounded-[18px] bg-[#f1e8fb] px-4 text-sm font-black text-[#5d427d] transition hover:bg-[#e4d5f6] disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Mail size={16} />
          {isSubmitting ? "Sending..." : "Sign in"}
        </button>
      </form>
      {status && (
        <p role="status" data-testid="auth-status" className="text-xs font-bold text-[#315f47]">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="auth-error" className="text-xs font-bold text-[#8f3f3a]">
          {error}
        </p>
      )}
    </section>
  );
}
