"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Chrome,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import {
  readRememberedAuthAccountName,
  writeRememberedAuthAccountName,
} from "@/lib/client/auth-email";

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

type AuthPageShellProps = {
  mode: AuthMode;
  nextPath: string;
  initialAccountName?: string;
};

type ApiResult = {
  ok?: boolean;
  next?: string;
  url?: string;
  error?: string | { message?: string };
};

const modeContent: Record<
  AuthMode,
  {
    title: string;
    eyebrow: string;
    submitLabel: string;
    pendingLabel: string;
  }
> = {
  "sign-in": {
    title: "Sign in",
    eyebrow: "BranchMind account",
    submitLabel: "Sign in",
    pendingLabel: "Signing in...",
  },
  "sign-up": {
    title: "Create account",
    eyebrow: "Account name registration",
    submitLabel: "Create account",
    pendingLabel: "Creating account...",
  },
  "forgot-password": {
    title: "Reset password",
    eyebrow: "Recovery disabled",
    submitLabel: "Send reset link",
    pendingLabel: "Sending...",
  },
  "reset-password": {
    title: "Choose new password",
    eyebrow: "Secure your account",
    submitLabel: "Update password",
    pendingLabel: "Updating...",
  },
};

function getApiError(data: unknown) {
  if (data && typeof data === "object") {
    const error = (data as ApiResult).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof error.message === "string") {
      return error.message;
    }
  }

  return "Authentication request failed.";
}

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as ApiResult | null;
  if (!response.ok) throw new Error(getApiError(data));
  return data ?? {};
}

export function AuthPageShell({ mode, nextPath, initialAccountName = "" }: AuthPageShellProps) {
  const router = useRouter();
  const content = modeContent[mode];
  const needsAccountName = mode !== "reset-password";
  const needsPassword = mode !== "forgot-password";
  const needsConfirmation = mode === "sign-up" || mode === "reset-password";
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccountName(initialAccountName || readRememberedAuthAccountName());
  }, [initialAccountName]);

  const alternateHref = useMemo(() => {
    const params = new URLSearchParams({ next: nextPath });
    return mode === "sign-up"
      ? `/auth/sign-in?${params.toString()}`
      : `/auth/sign-up?${params.toString()}`;
  }, [mode, nextPath]);

  function validateForm() {
    const trimmedAccountName = accountName.trim();
    if (needsAccountName && !trimmedAccountName) return "Account name is required.";
    if (mode === "sign-up" && trimmedAccountName.length < 3) {
      return "Account name must be at least 3 characters.";
    }
    if (mode === "sign-up" && trimmedAccountName.length > 32) {
      return "Account name must be 32 characters or fewer.";
    }
    if (mode === "sign-up" && !/^[a-z0-9._-]+$/i.test(trimmedAccountName)) {
      return "Account name can only include letters, numbers, dots, underscores, and hyphens.";
    }
    if (needsPassword && password.length < 8) return "Password must be at least 8 characters.";
    if (needsPassword && password.length > 128) return "Password must be 128 characters or fewer.";
    if (needsConfirmation && password !== confirmPassword) return "Passwords do not match.";
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setStatus(null);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setStatus(null);

    try {
      if (needsAccountName) writeRememberedAuthAccountName(accountName);

      if (mode === "sign-in") {
        const result = await postJson("/api/auth/sign-in", {
          accountName,
          password,
          next: nextPath,
        });
        router.push(result.next || nextPath);
        router.refresh();
        return;
      }

      if (mode === "sign-up") {
        const result = await postJson("/api/auth/sign-up", {
          accountName,
          password,
          next: nextPath,
        });
        setPassword("");
        setConfirmPassword("");
        router.push(result.next || nextPath);
        router.refresh();
        return;
      }

      if (mode === "forgot-password") {
        await postJson("/api/auth/forgot-password", {
          accountName,
          next: nextPath,
        });
        setStatus("If that account supports recovery, a reset link is on the way.");
        return;
      }

      const result = await postJson("/api/auth/update-password", {
        password,
        next: nextPath,
      });
      setPassword("");
      setConfirmPassword("");
      router.push(result.next || nextPath);
      router.refresh();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setStatus(null);

    try {
      const result = await postJson("/api/auth/google", { next: nextPath });
      if (!result.url) throw new Error("Google sign-in did not return a redirect URL.");
      window.location.assign(result.url);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Google sign-in failed.");
      setIsSubmitting(false);
    }
  }

  return (
    <main
      aria-labelledby="auth-title"
      data-testid={`auth-${mode}-page`}
      className="min-h-screen px-5 py-6"
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/90 bg-white/75 px-4 py-2.5 text-sm font-extrabold text-neutral-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            <ArrowLeft size={17} />
            Home
          </Link>
          <Link
            href="/projects"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-success-50 px-4 py-2.5 text-sm font-black text-success-700 shadow-sm transition hover:bg-success-100 focus:outline-none focus:ring-4 focus:ring-success-100"
          >
            <CheckCircle2 size={16} />
            Projects
          </Link>
        </header>

        <section className="grid flex-1 place-items-center py-8">
          <div className="w-full max-w-md rounded-[24px] border border-white/85 bg-white/86 p-5 shadow-2xl shadow-brand-100/45 backdrop-blur md:p-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-600">
                {content.eyebrow}
              </p>
              <h1 id="auth-title" className="mt-2 text-3xl font-black text-neutral-900">
                {content.title}
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              {needsAccountName && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-black text-neutral-800">
                    Account name
                  </span>
                  <span className="relative block">
                    <UserRound
                      aria-hidden="true"
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                    />
                    <input
                      type="text"
                      value={accountName}
                      onChange={(event) => setAccountName(event.target.value)}
                      autoComplete="username"
                      disabled={isSubmitting}
                      data-testid="auth-account-name-input"
                      className="h-11 w-full rounded-[16px] border border-neutral-200 bg-white pl-10 pr-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                    />
                  </span>
                </label>
              )}

              {needsPassword && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-black text-neutral-800">Password</span>
                  <span className="relative block">
                    <LockKeyhole
                      aria-hidden="true"
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                      disabled={isSubmitting}
                      data-testid="auth-password-input"
                      className="h-11 w-full rounded-[16px] border border-neutral-200 bg-white pl-10 pr-12 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-neutral-600 transition hover:bg-brand-50"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>
              )}

              {needsConfirmation && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-black text-neutral-800">
                    Confirm password
                  </span>
                  <span className="relative block">
                    <KeyRound
                      aria-hidden="true"
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      disabled={isSubmitting}
                      data-testid="auth-confirm-password-input"
                      className="h-11 w-full rounded-[16px] border border-neutral-200 bg-white pl-10 pr-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                    />
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="auth-submit-button"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] bg-brand-800 px-4 text-sm font-black text-white shadow-md shadow-brand-900/15 transition hover:bg-brand-900 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <UserRound size={16} />}
                {isSubmitting ? content.pendingLabel : content.submitLabel}
              </button>
            </form>

            {(mode === "sign-in" || mode === "sign-up") && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                data-testid="google-sign-in-button"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-neutral-300 bg-neutral-50 px-4 text-sm font-black text-neutral-900 shadow-sm transition hover:border-neutral-400 hover:bg-white focus:outline-none focus:ring-4 focus:ring-neutral-200 disabled:cursor-not-allowed disabled:opacity-65"
              >
                <Chrome size={16} />
                Continue with Google
              </button>
            )}

            {status && (
              <p
                role="status"
                data-testid="auth-status"
                className="mt-3 rounded-[16px] border border-success-200 bg-success-100 px-3.5 py-3 text-sm font-extrabold leading-relaxed text-success-800 shadow-sm"
              >
                {status}
              </p>
            )}
            {error && (
              <p
                role="alert"
                data-testid="auth-error"
                className="mt-3 rounded-[16px] bg-danger-100 px-3 py-2 text-sm font-bold text-danger-600"
              >
                {error}
              </p>
            )}

            {(mode === "sign-in" || mode === "sign-up") && (
              <p className="mt-5 text-center text-sm font-semibold text-neutral-600">
                {mode === "sign-up" ? "Already have an account?" : "Need an account?"}{" "}
                <Link
                  href={alternateHref}
                  className="font-black text-brand-800 underline decoration-brand-200 underline-offset-4"
                >
                  {mode === "sign-up" ? "Sign in" : "Create one"}
                </Link>
              </p>
            )}

            {mode === "forgot-password" && (
              <p className="mt-5 text-center text-sm font-semibold text-neutral-600">
                Remembered it?{" "}
                <Link
                  href={`/auth/sign-in?${new URLSearchParams({ next: nextPath }).toString()}`}
                  className="font-black text-brand-800 underline decoration-brand-200 underline-offset-4"
                >
                  Sign in
                </Link>
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
