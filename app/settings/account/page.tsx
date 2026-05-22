"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, UserCircle } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";

function getInitial(email: string | null | undefined) {
  return email?.trim().charAt(0).toUpperCase() || "B";
}

const inputClassName =
  "h-10 w-full rounded-lg border border-[#ded6cc] bg-[#fffdf9] px-4 text-sm font-semibold text-[#28242d] outline-none transition placeholder:text-[#aaa19a] focus:border-[#6f6256] focus:ring-2 focus:ring-[#e8dfd3] disabled:cursor-not-allowed disabled:border-[#e5dfd7] disabled:bg-[#f4f1eb] disabled:text-[#9a928a]";

const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#25222b] px-4 text-sm font-black text-white shadow-[0_12px_26px_rgba(37,34,43,0.2)] transition hover:-translate-y-0.5 hover:bg-[#17151b] disabled:cursor-not-allowed disabled:bg-[#d9d3ca] disabled:text-[#8a8178] disabled:shadow-none disabled:hover:translate-y-0";

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
    <section className="rounded-lg border border-[#e4ddd4] bg-[#fffdf9] p-5 shadow-[0_14px_34px_rgba(35,31,26,0.06)]">
      <h2 className="text-base font-black text-[#25222b]">{title}</h2>
      {description && <p className="mt-0.5 text-sm font-semibold text-[#7b717f]">{description}</p>}
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
        <Loader2 size={24} className="animate-spin text-[#7b717f]" />
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
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#edf3ef] text-lg font-black text-[#2f6651] ring-1 ring-inset ring-[#d6e4dc]">
              {getInitial(profileName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[#25222b]">{profileName}</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[#7b717f]">{profileMeta}</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#e4ddd4] bg-[#f8f5ee] px-3 py-1.5 text-xs font-black text-[#5c5360]">
            <ShieldCheck size={14} />
            {canEditAccount ? "Cloud account" : isLocalMode ? "Local workspace" : "Signed out"}
          </span>
        </div>
      </SettingsCard>

      <SettingsCard title="Display Name" description="This is how your name appears across BranchMind.">
        <div className="space-y-3">
          <div className="relative">
            <UserCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8c828f]" />
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
              <p className={`text-sm font-bold ${nameMessage.includes("updated") ? "text-[#2f806b]" : "text-[#8f3f3a]"}`}>
                {nameMessage}
              </p>
            )}
          </div>
          {!canEditAccount && (
            <p className="text-xs font-semibold text-[#8c828f]">
              Display names are saved with a signed-in account.
            </p>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Email Address" description="Your email is used for sign-in and notifications.">
        <div className="flex flex-col gap-3 rounded-lg border border-[#e4ddd4] bg-[#f8f5ee] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#fffdf9] text-[#716675] ring-1 ring-inset ring-[#e4ddd4]">
              <Mail size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[#25222b]">{emailTitle}</p>
              <p className="mt-0.5 text-xs font-semibold text-[#7b717f]">{emailDescription}</p>
            </div>
          </div>
          {email && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#eaf4ef] px-2.5 py-1 text-xs font-black text-[#2f6651]">
              <CheckCircle2 size={13} />
              Verified
            </span>
          )}
          {isGuestMode && (
            <Link
              href="/auth/sign-in?next=/settings/account"
              className="inline-flex min-h-9 w-fit items-center justify-center rounded-lg bg-[#25222b] px-3 text-xs font-black text-white transition hover:bg-[#17151b] focus:outline-none focus:ring-2 focus:ring-[#25222b]/20"
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
                <p className={`text-sm font-bold ${passwordMessage.includes("successfully") ? "text-[#2f806b]" : "text-[#8f3f3a]"}`}>
                  {passwordMessage}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-[#e4ddd4] bg-[#f8f5ee] px-4 py-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#fffdf9] text-[#716675] ring-1 ring-inset ring-[#e4ddd4]">
              <KeyRound size={16} />
            </span>
            <div>
              <p className="text-sm font-black text-[#25222b]">
                {isLocalMode ? "Password is not used in this workspace" : "Sign in to update your password"}
              </p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-[#7b717f]">
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
