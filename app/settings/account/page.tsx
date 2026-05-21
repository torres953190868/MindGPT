"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, UserCircle } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";

function getInitial(email: string | null | undefined) {
  return email?.trim().charAt(0).toUpperCase() || "B";
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#f0ebf5] bg-white p-5 shadow-sm">
      <h2 className="text-base font-extrabold text-[#342b3a]">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-[#9b8fa8]">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
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
        <Loader2 size={24} className="animate-spin text-[#9b8fa8]" />
      </div>
    );
  }

  const email = account?.email ?? null;

  return (
    <div className="space-y-5">
      {/* Profile Card */}
      <SettingsCard title="Profile" description="Your public profile information.">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#e5f6ee] text-lg font-bold text-[#3d7558]">
            {getInitial(email)}
          </span>
          <div>
            <p className="text-sm font-bold text-[#342b3a]">{account?.displayName ?? email ?? "BranchMind User"}</p>
            <p className="text-sm text-[#9b8fa8]">{email ?? "Local session"}</p>
          </div>
        </div>
      </SettingsCard>

      {/* Display Name Card */}
      <SettingsCard title="Display Name" description="This is how your name appears across BranchMind.">
        <div className="space-y-3">
          <div className="relative">
            <UserCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b8fa8]" />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-4 text-sm font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleUpdateName}
              disabled={savingName}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 text-sm font-extrabold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-60"
            >
              {savingName && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
            {nameMessage && (
              <p className={`text-sm font-semibold ${nameMessage.includes("updated") ? "text-green-600" : "text-red-600"}`}>
                {nameMessage}
              </p>
            )}
          </div>
        </div>
      </SettingsCard>

      {/* Email Card */}
      <SettingsCard title="Email Address" description="Your email is used for sign-in and notifications.">
        <div className="flex items-center gap-3 rounded-lg bg-[#f9f6fc] px-4 py-3">
          <Mail size={16} className="text-[#9b8fa8]" />
          <span className="text-sm font-semibold text-[#554665]">{email ?? "Not available in local mode"}</span>
        </div>
      </SettingsCard>

      {/* Password Card */}
      <SettingsCard title="Password" description="Update your password to keep your account secure.">
        <div className="space-y-3">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleUpdatePassword}
              disabled={savingPassword || !newPassword}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 text-sm font-extrabold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-60"
            >
              {savingPassword && <Loader2 size={14} className="animate-spin" />}
              Update Password
            </button>
            {passwordMessage && (
              <p className={`text-sm font-semibold ${passwordMessage.includes("successfully") ? "text-green-600" : "text-red-600"}`}>
                {passwordMessage}
              </p>
            )}
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
