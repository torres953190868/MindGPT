"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, UserCircle } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";

function getInitial(email: string | null | undefined) {
  return email?.trim().charAt(0).toUpperCase() || "B";
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
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  async function loadAccount() {
    setLoading(true);
    try {
      const res = await fetch("/api/account");
      const data = (await res.json().catch(() => null)) as AccountDto | null;
      if (res.ok && data) {
        setAccount(data);
        setDisplayName(data.displayName ?? "");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  async function handleUpdateName() {
    if (account?.authMode !== "supabase" || !account.email) {
      setNameMessage("Sign in to update your profile.");
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
        setAccount(data as AccountDto);
        setNameMessage("Display name updated.");
      } else {
        setNameMessage(data?.error?.message ?? "Failed to update.");
      }
    } finally {
      setSavingName(false);
    }
  }

  async function handleUpdatePassword() {
    setPasswordMessage(null);
    if (account?.authMode !== "supabase" || !account.email) {
      setPasswordMessage("Sign in to update your password.");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("Passwords do not match.");
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
        setPasswordMessage("Password updated successfully.");
      } else {
        const data = await res.json().catch(() => null);
        setPasswordMessage(data?.error?.message ?? "Failed to update password.");
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
  const authMode = account?.authMode ?? (email ? "supabase" : "local");
  const isLocalMode = authMode === "local";
  const isGuestMode = authMode === "guest";
  const canEditAccount = authMode === "supabase" && Boolean(email);
  const profileName =
    account?.displayName ?? email ?? (isLocalMode ? "Local workspace" : "BranchMind account");
  const profileMeta =
    email ?? (isLocalMode ? "Anonymous browser session" : "Sign in to connect your email");
  const emailTitle = email ?? (isLocalMode ? "No email attached" : "Sign in to add email");
  const emailDescription = email
    ? "Used for sign-in, recovery, and account notices."
    : isLocalMode
      ? "This environment is using local storage, so there is no account email to show."
      : "Your email appears here after you sign in.";

  return (
    <div className="space-y-5">
      <SettingsCard title="Profile" description="Your public profile information.">
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
            {canEditAccount ? "Cloud account" : isLocalMode ? "Local workspace" : "Signed out"}
          </span>
        </div>
      </SettingsCard>

      <SettingsCard title="Display Name" description="This is how your name appears across BranchMind.">
        <div className="space-y-3">
          <div className="relative">
            <UserCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!canEditAccount}
              placeholder={canEditAccount ? "Your display name" : "Sign in to edit your name"}
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
              Save
            </button>
            {nameMessage && (
              <p className={`text-sm font-bold ${nameMessage.includes("updated") ? "text-success-600" : "text-danger-600"}`}>
                {nameMessage}
              </p>
            )}
          </div>
          {!canEditAccount && (
            <p className="text-xs font-semibold text-neutral-500">
              Display names are saved with a signed-in account.
            </p>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Email Address" description="Your email is used for sign-in and notifications.">
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface-muted px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-elevated text-neutral-600 ring-1 ring-inset ring-neutral-200">
              <Mail size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-900">{emailTitle}</p>
              <p className="mt-0.5 text-xs font-semibold text-neutral-600">{emailDescription}</p>
            </div>
          </div>
          {email && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-xs font-black text-success-700">
              <CheckCircle2 size={13} />
              Verified
            </span>
          )}
          {isGuestMode && (
            <Link
              href="/auth/sign-in?next=/settings/account"
              className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg bg-neutral-900 px-3 text-xs font-black text-white transition hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              Sign in
            </Link>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Password" description="Update your password to keep your account secure.">
        {canEditAccount ? (
          <div className="space-y-3">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              className={inputClassName}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
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
                Update Password
              </button>
              {passwordMessage && (
                <p className={`text-sm font-bold ${passwordMessage.includes("successfully") ? "text-success-600" : "text-danger-600"}`}>
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
                {isLocalMode ? "Password is not used in this workspace" : "Sign in to update your password"}
              </p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-neutral-600">
                {isLocalMode
                  ? "Local workspaces use an anonymous browser session instead of email/password auth."
                  : "Password management is available once your account session is active."}
              </p>
            </div>
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
