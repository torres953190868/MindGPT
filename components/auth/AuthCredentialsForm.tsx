"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Chrome,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  readRememberedAuthAccountName,
  writeRememberedAuthAccountName,
} from "@/lib/client/auth-email";
import { useAuthStore } from "@/store/useAuthStore";

export type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

export type AuthApiResult = {
  ok?: boolean;
  next?: string;
  url?: string;
  error?: string | { code?: string; message?: string };
};

class AuthApiError extends Error {
  code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
  }
}

type AuthCredentialsFormProps = {
  mode: AuthMode;
  nextPath: string;
  initialAccountName?: string;
  titleId?: string;
  showGoogle?: boolean;
  onModeChange?: (mode: Extract<AuthMode, "sign-in" | "sign-up">) => void;
  onSuccess: (result: AuthApiResult) => void | Promise<void>;
};

function getApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const error = (data as AuthApiResult).error;
    if (typeof error === "string") return new AuthApiError(error, null);
    if (error && typeof error === "object" && typeof error.message === "string") {
      return new AuthApiError(
        error.message,
        typeof error.code === "string" ? error.code : null,
      );
    }
  }

  return new AuthApiError(fallback, null);
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  fallbackError: string,
) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as AuthApiResult | null;
  if (!response.ok) throw getApiError(data, fallbackError);
  return data ?? {};
}

export function AuthCredentialsForm({
  mode,
  nextPath,
  initialAccountName = "",
  titleId = "auth-title",
  showGoogle = true,
  onModeChange,
  onSuccess,
}: AuthCredentialsFormProps) {
  const { copy } = useLanguage();
  const refreshAuth = useAuthStore((state) => state.refreshAuth);
  const content = {
    "sign-in": {
      title: copy.auth.signIn,
      eyebrow: copy.auth.branchMindAccount,
      submitLabel: copy.auth.signIn,
      pendingLabel: copy.auth.signingIn,
    },
    "sign-up": {
      title: copy.auth.createAccount,
      eyebrow: copy.auth.signUpEyebrow,
      submitLabel: copy.auth.createAccount,
      pendingLabel: copy.auth.creatingAccount,
    },
    "forgot-password": {
      title: copy.auth.resetPassword,
      eyebrow: copy.auth.forgotEyebrow,
      submitLabel: copy.auth.sendResetLink,
      pendingLabel: copy.auth.sending,
    },
    "reset-password": {
      title: copy.auth.chooseNewPassword,
      eyebrow: copy.auth.secureAccount,
      submitLabel: copy.auth.updatePassword,
      pendingLabel: copy.auth.updating,
    },
  }[mode];
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

  useEffect(() => {
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setStatus(null);
    setError(null);
  }, [mode]);

  const alternateMode: Extract<AuthMode, "sign-in" | "sign-up"> =
    mode === "sign-up" ? "sign-in" : "sign-up";

  function getLocalizedAuthError(authError: unknown, fallback: string) {
    if (authError instanceof AuthApiError) {
      if (authError.code === "SIGN_IN_FAILED") return copy.auth.signInFailed;
      if (authError.code === "ACCOUNT_NAME_TAKEN") return copy.auth.accountNameTaken;
      if (authError.code === "SIGN_UP_FAILED") return copy.auth.signUpFailed;
    }
    return authError instanceof Error ? authError.message : fallback;
  }
  const alternateHref = useMemo(() => {
    const params = new URLSearchParams({ next: nextPath });
    return mode === "sign-up"
      ? `/auth/sign-in?${params.toString()}`
      : `/auth/sign-up?${params.toString()}`;
  }, [mode, nextPath]);

  function validateForm() {
    const trimmedAccountName = accountName.trim();
    if (needsAccountName && !trimmedAccountName) {
      return copy.auth.validationAccountRequired;
    }
    if (mode === "sign-up" && trimmedAccountName.length < 3) {
      return copy.auth.validationAccountShort;
    }
    if (mode === "sign-up" && trimmedAccountName.length > 32) {
      return copy.auth.validationAccountLong;
    }
    if (mode === "sign-up" && !/^[a-z0-9._-]+$/i.test(trimmedAccountName)) {
      return copy.auth.validationAccountChars;
    }
    if (needsPassword && password.length < 8) return copy.auth.validationPasswordShort;
    if (needsPassword && password.length > 128) return copy.auth.validationPasswordLong;
    if (needsConfirmation && password !== confirmPassword) {
      return copy.auth.validationPasswordMismatch;
    }
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
        const result = await postJson(
          "/api/auth/sign-in",
          {
            accountName,
            password,
            next: nextPath,
          },
          copy.auth.authFailed,
        );
        await refreshAuth({ force: true });
        await onSuccess(result);
        return;
      }

      if (mode === "sign-up") {
        const result = await postJson(
          "/api/auth/sign-up",
          {
            accountName,
            password,
            next: nextPath,
          },
          copy.auth.authFailed,
        );
        setPassword("");
        setConfirmPassword("");
        await refreshAuth({ force: true });
        await onSuccess(result);
        return;
      }

      if (mode === "forgot-password") {
        await postJson(
          "/api/auth/forgot-password",
          {
            accountName,
            next: nextPath,
          },
          copy.auth.authFailed,
        );
        setStatus(copy.auth.recoveryStatus);
        return;
      }

      const result = await postJson(
        "/api/auth/update-password",
        {
          password,
          next: nextPath,
        },
        copy.auth.authFailed,
      );
      setPassword("");
      setConfirmPassword("");
      await onSuccess(result);
    } catch (authError) {
      setError(getLocalizedAuthError(authError, copy.auth.authFailed));
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
      const result = await postJson(
        "/api/auth/google",
        { next: nextPath },
        copy.auth.googleSignInFailed,
      );
      if (!result.url) throw new Error(copy.auth.googleMissingUrl);
      window.location.assign(result.url);
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : copy.auth.googleSignInFailed,
      );
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-600">
          {content.eyebrow}
        </p>
        <h1 id={titleId} className="mt-2 text-3xl font-black text-neutral-900">
          {content.title}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        {needsAccountName && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-black text-neutral-800">
              {copy.auth.accountName}
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
            <span className="mb-1.5 block text-sm font-black text-neutral-800">
              {copy.auth.password}
            </span>
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
                aria-label={showPassword ? copy.auth.hidePassword : copy.auth.showPassword}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
        )}

        {needsConfirmation && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-black text-neutral-800">
              {copy.auth.confirmPassword}
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
          {isSubmitting ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <UserRound size={16} />
          )}
          {isSubmitting ? content.pendingLabel : content.submitLabel}
        </button>
      </form>

      {showGoogle && (mode === "sign-in" || mode === "sign-up") && (
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
          data-testid="google-sign-in-button"
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[16px] border border-neutral-300 bg-neutral-50 px-4 text-sm font-black text-neutral-900 shadow-sm transition hover:border-neutral-400 hover:bg-white focus:outline-none focus:ring-4 focus:ring-neutral-200 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Chrome size={16} />
          {copy.auth.continueWithGoogle}
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
          {mode === "sign-up" ? copy.auth.alreadyHaveAccount : copy.auth.needAccount}{" "}
          {onModeChange ? (
            <button
              type="button"
              onClick={() => onModeChange(alternateMode)}
              data-testid="auth-mode-switch-button"
              className="font-black text-brand-800 underline decoration-brand-200 underline-offset-4"
            >
              {mode === "sign-up" ? copy.auth.signIn : copy.auth.createOne}
            </button>
          ) : (
            <Link
              href={alternateHref}
              className="font-black text-brand-800 underline decoration-brand-200 underline-offset-4"
            >
              {mode === "sign-up" ? copy.auth.signIn : copy.auth.createOne}
            </Link>
          )}
        </p>
      )}

      {mode === "forgot-password" && (
        <p className="mt-5 text-center text-sm font-semibold text-neutral-600">
          {copy.auth.rememberedIt}{" "}
          <Link
            href={`/auth/sign-in?${new URLSearchParams({ next: nextPath }).toString()}`}
            className="font-black text-brand-800 underline decoration-brand-200 underline-offset-4"
          >
            {copy.auth.signIn}
          </Link>
        </p>
      )}
    </>
  );
}
