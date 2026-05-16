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
  Mail,
} from "lucide-react";
import {
  readRememberedAuthEmail,
  writeRememberedAuthEmail,
} from "@/lib/client/auth-email";

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

type AuthPageShellProps = {
  mode: AuthMode;
  nextPath: string;
  initialEmail?: string;
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
    eyebrow: "Email verification required",
    submitLabel: "Create account",
    pendingLabel: "Creating account...",
  },
  "forgot-password": {
    title: "Reset password",
    eyebrow: "Email recovery",
    submitLabel: "Send reset email",
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

export function AuthPageShell({ mode, nextPath, initialEmail = "" }: AuthPageShellProps) {
  const router = useRouter();
  const content = modeContent[mode];
  const needsEmail = mode !== "reset-password";
  const needsPassword = mode !== "forgot-password";
  const needsConfirmation = mode === "sign-up" || mode === "reset-password";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(initialEmail || readRememberedAuthEmail());
  }, [initialEmail]);

  const alternateHref = useMemo(() => {
    const params = new URLSearchParams({ next: nextPath });
    return mode === "sign-up"
      ? `/auth/sign-in?${params.toString()}`
      : `/auth/sign-up?${params.toString()}`;
  }, [mode, nextPath]);

  const forgotHref = useMemo(() => {
    const params = new URLSearchParams({ next: nextPath });
    if (email.trim()) params.set("email", email.trim().toLowerCase());
    return `/auth/forgot-password?${params.toString()}`;
  }, [email, nextPath]);

  function validateForm() {
    if (needsEmail && !email.trim()) return "Email is required.";
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
      if (needsEmail) writeRememberedAuthEmail(email);

      if (mode === "sign-in") {
        const result = await postJson("/api/auth/sign-in", {
          email,
          password,
          next: nextPath,
        });
        router.push(result.next || nextPath);
        router.refresh();
        return;
      }

      if (mode === "sign-up") {
        await postJson("/api/auth/sign-up", {
          email,
          password,
          next: nextPath,
        });
        setPassword("");
        setConfirmPassword("");
        setStatus(
          "If this email can create a new account, a verification link is on the way. If you already have an account, sign in or reset your password.",
        );
        return;
      }

      if (mode === "forgot-password") {
        await postJson("/api/auth/forgot-password", {
          email,
          next: nextPath,
        });
        setStatus("If that email has an account, a reset link is on the way.");
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
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/90 bg-white/75 px-4 py-2.5 text-sm font-extrabold text-[#554665] shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
          >
            <ArrowLeft size={17} />
            Home
          </Link>
          <Link
            href="/projects"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-[#e5f6ee] px-4 py-2.5 text-sm font-black text-[#3d7558] shadow-sm transition hover:bg-[#d8f0e4] focus:outline-none focus:ring-4 focus:ring-[#d7f0e4]"
          >
            <CheckCircle2 size={16} />
            Projects
          </Link>
        </header>

        <section className="grid flex-1 place-items-center py-8">
          <div className="w-full max-w-md rounded-[24px] border border-white/85 bg-white/86 p-5 shadow-2xl shadow-[#dfcfe9]/45 backdrop-blur md:p-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#74687c]">
                {content.eyebrow}
              </p>
              <h1 id="auth-title" className="mt-2 text-3xl font-black text-[#342b3a]">
                {content.title}
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              {needsEmail && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-black text-[#554665]">Email</span>
                  <span className="relative block">
                    <Mail
                      aria-hidden="true"
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b7183]"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      disabled={isSubmitting}
                      data-testid="auth-email-input"
                      className="h-11 w-full rounded-[16px] border border-[#e8ddf2] bg-white pl-10 pr-3 text-sm text-[#332b38] outline-none transition placeholder:text-[#7b7183] focus:border-[#a98cc9] focus:ring-4 focus:ring-[#eadcf6]"
                    />
                  </span>
                </label>
              )}

              {needsPassword && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-black text-[#554665]">Password</span>
                  <span className="relative block">
                    <LockKeyhole
                      aria-hidden="true"
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b7183]"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                      disabled={isSubmitting}
                      data-testid="auth-password-input"
                      className="h-11 w-full rounded-[16px] border border-[#e8ddf2] bg-white pl-10 pr-12 text-sm text-[#332b38] outline-none transition placeholder:text-[#7b7183] focus:border-[#a98cc9] focus:ring-4 focus:ring-[#eadcf6]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#6f6478] transition hover:bg-[#f1e8fb]"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>
              )}

              {needsConfirmation && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-black text-[#554665]">
                    Confirm password
                  </span>
                  <span className="relative block">
                    <KeyRound
                      aria-hidden="true"
                      size={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b7183]"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      disabled={isSubmitting}
                      data-testid="auth-confirm-password-input"
                      className="h-11 w-full rounded-[16px] border border-[#e8ddf2] bg-white pl-10 pr-3 text-sm text-[#332b38] outline-none transition placeholder:text-[#7b7183] focus:border-[#a98cc9] focus:ring-4 focus:ring-[#eadcf6]"
                    />
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="auth-submit-button"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] bg-[#f1e8fb] px-4 text-sm font-black text-[#5d427d] transition hover:bg-[#e4d5f6] disabled:cursor-not-allowed disabled:opacity-65"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />}
                {isSubmitting ? content.pendingLabel : content.submitLabel}
              </button>
            </form>

            {(mode === "sign-in" || mode === "sign-up") && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                data-testid="google-sign-in-button"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] bg-[#e5f6ee] px-4 text-sm font-black text-[#3d7558] transition hover:bg-[#d8f0e4] disabled:cursor-not-allowed disabled:opacity-65"
              >
                <Chrome size={16} />
                Continue with Google
              </button>
            )}

            {mode === "sign-in" && (
              <div className="mt-3 text-center">
                <Link
                  href={forgotHref}
                  className="text-sm font-bold text-[#5d427d] underline decoration-[#cab6df] underline-offset-4"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            {status && (
              <p
                role="status"
                data-testid="auth-status"
                className="mt-3 rounded-[16px] bg-[#e5f6ee] px-3 py-2 text-sm font-bold text-[#315f47]"
              >
                {status}
              </p>
            )}
            {error && (
              <p
                role="alert"
                data-testid="auth-error"
                className="mt-3 rounded-[16px] bg-[#ffeceb] px-3 py-2 text-sm font-bold text-[#8f3f3a]"
              >
                {error}
              </p>
            )}

            {(mode === "sign-in" || mode === "sign-up") && (
              <p className="mt-5 text-center text-sm font-semibold text-[#6f6478]">
                {mode === "sign-up" ? "Already have an account?" : "Need an account?"}{" "}
                <Link
                  href={alternateHref}
                  className="font-black text-[#5d427d] underline decoration-[#cab6df] underline-offset-4"
                >
                  {mode === "sign-up" ? "Sign in" : "Create one"}
                </Link>
              </p>
            )}

            {mode === "forgot-password" && (
              <p className="mt-5 text-center text-sm font-semibold text-[#6f6478]">
                Remembered it?{" "}
                <Link
                  href={`/auth/sign-in?${new URLSearchParams({ next: nextPath }).toString()}`}
                  className="font-black text-[#5d427d] underline decoration-[#cab6df] underline-offset-4"
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
