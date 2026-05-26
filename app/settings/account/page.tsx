"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, UserCircle } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useAuthStore } from "@/store/useAuthStore";

function getInitial(accountName: string | null | undefined) {
  return accountName?.trim().charAt(0).toUpperCase() || "B";
}

const inputClassName =
  "h-10 w-full rounded-lg border border-neutral-200 bg-surface-muted px-4 text-sm font-semibold text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-500";

const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none disabled:hover:translate-y-0";

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-md">
      <h2 className="text-base font-black text-neutral-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm font-semibold text-neutral-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function AccountSettingsPage() {
  const { copy } = useLanguage();
  const setAccountCache = useAuthStore((state) => state.setAccountCache);
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account");
      const data = (await res.json().catch(() => null)) as AccountDto | null;
      if (res.ok && data) {
        setAccount(data);
        setAccountCache(data);
        setDisplayName(data.displayName ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, [setAccountCache]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  async function handleUpdateName() {
    if (account?.authMode !== "supabase") {
      setNameMessage(copy.settings.signInProfile);
      return;
    }

    setSavingName(true);
    setNameMessage(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const updatedAccount = data as AccountDto;
        setAccount(updatedAccount);
        setAccountCache(updatedAccount);
        setNameMessage(copy.settings.displayNameSaved);
      } else {
        setNameMessage(data?.error?.message ?? copy.settings.failedUpdate);
      }
    } finally {
      setSavingName(false);
    }
  }

  async function handleUpdatePassword() {
    setPasswordMessage(null);
    if (account?.authMode !== "supabase") {
      setPasswordMessage(copy.settings.signInPassword);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMessage(copy.settings.passwordMin);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage(copy.settings.passwordMismatch);
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (res.ok) {
        setNewPassword("");
        setConfirmPassword("");
        setPasswordMessage(copy.settings.passwordUpdated);
      } else {
        const data = await res.json().catch(() => null);
        setPasswordMessage(data?.error?.message ?? copy.settings.failedUpdate);
      }
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-neutral-600" />
      </div>
    );
  }

  const email = account?.email ?? null;
  const accountName = account?.accountName ?? email;
  const authMode = account?.authMode ?? (accountName ? "supabase" : "local");
  const isLocalMode = authMode === "local";
  const isGuestMode = authMode === "guest";
  const canEditAccount = authMode === "supabase";
  const profileName =
    account?.displayName ?? accountName ?? (isLocalMode ? copy.settings.localWorkspace : copy.accountMenu.branchMindAccount);
  const profileMeta =
    accountName ?? (isLocalMode ? copy.settings.noAccountNameLocal : copy.settings.signInAddAccountName);
  const accountNameTitle =
    accountName ?? (isLocalMode ? copy.settings.accountNameMissingLocal : copy.settings.accountNameMissingSignedOut);
  const accountNameDescription = accountName
    ? copy.settings.accountNameWithValue
    : isLocalMode
      ? copy.settings.accountNameLocalDescription
      : copy.settings.signInAddAccountName;

  return (
    <div className="space-y-5">
      <SettingsCard title={copy.settings.profile} description={copy.settings.profileDescription}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-success-50 text-lg font-black text-success-700 ring-1 ring-inset ring-success-100">
              {getInitial(profileName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-900">{profileName}</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-neutral-600">{profileMeta}</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-neutral-200 bg-surface-muted px-3 py-1.5 text-xs font-black text-neutral-700">
            <ShieldCheck size={14} />
            {canEditAccount ? copy.settings.cloudAccount : isLocalMode ? copy.settings.localWorkspace : copy.settings.signedOut}
          </span>
        </div>
      </SettingsCard>

      <SettingsCard title={copy.settings.displayName} description={copy.settings.displayNameDescription}>
        <div className="space-y-3">
          <div className="relative">
            <UserCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!canEditAccount}
              placeholder={canEditAccount ? copy.settings.yourDisplayName : copy.settings.signInEditName}
              className={`${inputClassName} pl-9`}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleUpdateName}
              disabled={savingName || !canEditAccount}
              className={primaryButtonClassName}
            >
              {savingName && <Loader2 size={14} className="animate-spin" />}
              {copy.settings.save}
            </button>
            {nameMessage && (
              <p className={`text-sm font-bold ${nameMessage === copy.settings.displayNameSaved ? "text-success-600" : "text-danger-600"}`}>
                {nameMessage}
              </p>
            )}
          </div>
          {!canEditAccount && (
            <p className="text-xs font-semibold text-neutral-500">
              {copy.settings.displayNamesNeedSignIn}
            </p>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={copy.settings.accountName} description={copy.settings.accountNameDescription}>
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface-muted px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-elevated text-neutral-600 ring-1 ring-inset ring-neutral-200">
              <UserCircle size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-900">{accountNameTitle}</p>
              <p className="mt-0.5 text-xs font-semibold text-neutral-600">
                {accountNameDescription}
              </p>
            </div>
          </div>
          {accountName && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-xs font-black text-success-700">
              <CheckCircle2 size={13} />
              {copy.common.active}
            </span>
          )}
          {isGuestMode && (
            <Link
              href="/auth/sign-in?next=/settings/account"
              className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg bg-neutral-900 px-3 text-xs font-black text-white transition hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              {copy.common.signIn}
            </Link>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={copy.settings.password} description={copy.settings.passwordDescription}>
        {canEditAccount ? (
          <div className="space-y-3">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={copy.settings.passwordPlaceholder}
              autoComplete="new-password"
              className={inputClassName}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={copy.auth.confirmPassword}
              autoComplete="new-password"
              className={inputClassName}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleUpdatePassword}
                disabled={savingPassword || !newPassword}
                className={primaryButtonClassName}
              >
                {savingPassword && <Loader2 size={14} className="animate-spin" />}
                {copy.auth.updatePassword}
              </button>
              {passwordMessage && (
                <p className={`text-sm font-bold ${passwordMessage === copy.settings.passwordUpdated ? "text-success-600" : "text-danger-600"}`}>
                  {passwordMessage}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-surface-muted px-4 py-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-elevated text-neutral-600 ring-1 ring-inset ring-neutral-200">
              <KeyRound size={16} />
            </span>
            <div>
              <p className="text-sm font-black text-neutral-900">
                {isLocalMode ? copy.settings.passwordLocal : copy.settings.passwordSignInRequired}
              </p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-neutral-600">
                {isLocalMode
                  ? copy.settings.passwordLocalDescription
                  : copy.settings.passwordSignInRequiredDescription}
              </p>
            </div>
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
