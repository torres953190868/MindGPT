"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  HelpCircle,
  LogIn,
  LogOut,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { writeRememberedAuthEmail } from "@/lib/client/auth-email";
import type { AccountDto } from "@/app/api/account/route";

type AuthSession = {
  configured: boolean;
  user: { id: string; email: string | null } | null;
};

type AuthPanelProps = {
  className?: string;
  placement?: "bottom" | "top";
  variant?: "default" | "sidebar";
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

function getPlanBadgeColor(plan: string) {
  if (plan === "pro") return "border-[#d8c8ea] bg-[#f5f1fa] text-[#62477d]";
  if (plan === "team") return "border-[#bfd6dd] bg-[#eef6f7] text-[#315e68]";
  return "border-[#e4d4ad] bg-[#fbf4e2] text-[#765d35]";
}

function getHighestUsageItem(usage: AccountDto["usage"]) {
  type Item = { key: string; label: string; used: number; limit: number | null };
  const items: Item[] = [
    { key: "projects", label: "Projects", ...usage.projects },
    { key: "nodes", label: "Nodes", ...usage.nodes },
    { key: "documents", label: "PDFs", ...usage.documents },
    { key: "aiMessages", label: "AI msgs", ...usage.aiMessages },
  ];

  let highest: Item | null = null;
  let maxRatio = -1;

  for (const item of items) {
    if (item.limit !== null && item.limit > 0) {
      const ratio = item.used / item.limit;
      if (ratio > maxRatio) {
        maxRatio = ratio;
        highest = item;
      }
    }
  }

  return highest;
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return null;
  const ratio = Math.min(used / limit, 1);
  const percentage = Math.round(ratio * 100);
  const barColor = percentage >= 95 ? "bg-[#9a413d]" : percentage >= 80 ? "bg-[#a9722a]" : "bg-[#2f806b]";

  return (
    <div className="px-3 pb-2.5 pt-1.5">
      <div className="flex items-center justify-between text-[11px] font-semibold text-[#7c7284]">
        <span>{percentage >= 95 ? "Almost at limit" : "Usage"}</span>
        <span>{used}/{limit}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#ece9ef]">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

const accountMenuItemClass =
  "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold text-[#4f4657] transition hover:bg-[#f6f4f1] hover:text-[#2f2934] focus:outline-none focus:ring-2 focus:ring-[#6e4ca0]/15";
const accountMenuIconClass =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#f1eff3] text-[#756b7d]";

const WHATS_NEW_ITEMS = [
  {
    version: "v0.2.0",
    date: "May 2026",
    title: "New: Account & Billing",
    description: "Introducing user plans, usage tracking, and Settings. Free plan includes 5 projects, 100 nodes, and 3 PDFs.",
  },
  {
    version: "v0.1.5",
    date: "May 2026",
    title: "PDF Reader + RAG",
    description: "Upload PDFs, index them, and ask grounded questions with citations. Attach PDFs to BranchMind conversations.",
  },
  {
    version: "v0.1.0",
    date: "April 2026",
    title: "BranchMind Launch",
    description: "Visual branching AI conversation workspace. Continue down or branch right to explore ideas.",
  },
];

function WhatsNewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#f0ebf5] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#f0ebf5] px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            <h2 className="text-base font-extrabold text-[#342b3a]">What&apos;s New</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[#9b8fa8] transition hover:bg-[#f5f1f9]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-5">
          <div className="space-y-5">
            {WHATS_NEW_ITEMS.map((item) => (
              <div key={item.version} className="relative pl-5">
                <div className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-purple-400" />
                <div className="absolute left-[3px] top-4 h-[calc(100%+12px)] w-0.5 bg-[#f0ebf5] last:hidden" />
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-[#f5f1f9] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6c538d]">
                    {item.version}
                  </span>
                  <span className="text-xs text-[#9b8fa8]">{item.date}</span>
                </div>
                <h3 className="mt-1 text-sm font-bold text-[#342b3a]">{item.title}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-[#6b5d7a]">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthPanel({
  className = "",
  placement = "bottom",
  variant = "default",
}: AuthPanelProps) {
  const menuRef = useRef<HTMLElement | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"logout" | null>(null);
  const [signInHref, setSignInHref] = useState("/auth/sign-in");
  const isSidebar = variant === "sidebar";
  const popoverPosition = placement === "top" ? "bottom-full mb-2" : "top-full mt-2";
  const popoverHorizontal = isSidebar ? "left-0 right-0 w-full" : "right-0 w-60";

  async function refreshSession() {
    const response = await fetch("/api/auth/session");
    const data = (await response.json().catch(() => null)) as AuthSession | null;
    if (response.ok && data) setSession(data);
  }

  async function refreshAccount() {
    const response = await fetch("/api/account");
    const data = (await response.json().catch(() => null)) as AccountDto | null;
    if (response.ok && data) setAccount(data);
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
    if (session?.user) {
      void refreshAccount();
    }
  }, [session?.user]);

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
      setSession((current) => (current ? { ...current, user: null } : current));
      setAccount(null);
      setIsMenuOpen(false);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Sign-out failed.");
    } finally {
      setSubmittingAction(null);
    }
  }

  const displayEmail = account?.email ?? session?.user?.email ?? null;
  const displayName = account?.displayName ?? displayEmail;
  const plan = account?.plan ?? "free";
  const highestUsage = account ? getHighestUsageItem(account.usage) : null;
  const isFreePlan = plan === "free";

  if (session && !session.configured) {
    return (
      <section
        aria-label="Local authentication mode"
        className={`${isSidebar ? "flex w-full" : "inline-flex"} ${className}`}
      >
        <div
          role="status"
          data-testid="auth-local-mode-status"
          className={
            isSidebar
              ? "inline-flex h-11 w-full items-center gap-2 rounded-xl border border-[#ebe7f1] bg-white px-3 text-sm font-black text-[#5d5168] shadow-sm"
              : "inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-white/75 px-4 py-2.5 text-sm font-black text-[#5d5168] shadow-sm"
          }
        >
          <CheckCircle2 size={16} />
          Local dev mode
        </div>
      </section>
    );
  }

  if (session?.user) {
    return (
      <>
        <section
          ref={menuRef}
          aria-label="User profile"
          data-testid="user-profile"
          className={`relative ${isSidebar ? "flex w-full" : "inline-flex justify-end"} text-sm ${className}`}
        >
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            data-testid="account-menu-button"
            className={
              isSidebar
                ? "inline-flex h-11 w-full max-w-full items-center gap-2 rounded-xl border border-[#ded8e4] bg-[#fffefd] px-3 text-left font-black text-[#443a49] shadow-[0_1px_2px_rgba(51,42,57,0.06)] transition hover:border-[#d0c9d8] hover:bg-[#f8f7f5] focus:outline-none focus:ring-2 focus:ring-[#6e4ca0]/20"
                : "inline-flex min-h-11 max-w-full items-center gap-2 rounded-[18px] border border-white/80 bg-white/86 px-3 py-2.5 font-black text-[#443a49] shadow-[0_8px_20px_rgba(51,42,57,0.08)] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#6e4ca0]/15"
            }
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#edf5f1] text-xs font-bold text-[#2f6651] ring-1 ring-inset ring-[#d7e8df]">
              {getInitial(displayEmail)}
            </span>
            <span className={`${isSidebar ? "flex-1" : "max-w-36"} truncate`}>
              {displayName ?? "Signed in"}
            </span>
            <ChevronDown size={15} className="shrink-0 text-[#8b8292]" />
          </button>

          {isMenuOpen && (
            <div
              role="dialog"
              aria-label="Account menu"
              data-testid="account-menu-popover"
              className={`absolute ${popoverHorizontal} z-50 rounded-xl border border-[#ded8e4] bg-[#fffefd] p-1.5 text-left shadow-[0_22px_60px_rgba(51,42,57,0.16)] ${popoverPosition}`}
            >
              {/* User info header with plan badge */}
              <div className="rounded-lg border border-[#ebe6ee] bg-[linear-gradient(135deg,#fbfaf8_0%,#f2f6f3_100%)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#edf5f1] text-xs font-bold text-[#2f6651] ring-1 ring-inset ring-[#d2e5dc]">
                    {getInitial(displayEmail)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[#2f2934]">
                      {displayEmail ?? "BranchMind account"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getPlanBadgeColor(plan)}`}>
                        {plan}
                      </span>
                      {isFreePlan && (
                        <Link
                          href="/settings/billing"
                          onClick={() => setIsMenuOpen(false)}
                          className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[#5e5365] transition hover:text-[#2f2934]"
                        >
                          Upgrade
                          <ArrowUpRight size={12} />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Usage bar */}
              {highestUsage && highestUsage.limit !== null && (
                <UsageBar used={highestUsage.used} limit={highestUsage.limit} />
              )}

              {/* Menu links */}
              <div className="mt-1 space-y-0.5">
                <Link
                  href="/settings/account"
                  onClick={() => setIsMenuOpen(false)}
                  className={accountMenuItemClass}
                >
                  <span className={accountMenuIconClass}>
                    <Settings size={14} />
                  </span>
                  Settings
                </Link>
                <Link
                  href="/settings/usage"
                  onClick={() => setIsMenuOpen(false)}
                  className={accountMenuItemClass}
                >
                  <span className={accountMenuIconClass}>
                    <BarChart3 size={14} />
                  </span>
                  Usage & Limits
                </Link>
                <Link
                  href="/settings/billing"
                  onClick={() => setIsMenuOpen(false)}
                  className={accountMenuItemClass}
                >
                  <span className={accountMenuIconClass}>
                    <CreditCard size={14} />
                  </span>
                  Billing
                </Link>
              </div>

              <div className="my-1.5 h-px bg-[#ece7ef]" />

              {/* Bottom links */}
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowWhatsNew(true);
                  }}
                  className={`w-full ${accountMenuItemClass}`}
                >
                  <span className={accountMenuIconClass}>
                    <Sparkles size={14} />
                  </span>
                  What&apos;s New
                </button>
                <a
                  href="mailto:support@branchmind.app"
                  className={accountMenuItemClass}
                >
                  <span className={accountMenuIconClass}>
                    <HelpCircle size={14} />
                  </span>
                  Help & Support
                </a>
              </div>

              <div className="my-1.5 h-px bg-[#ece7ef]" />

              {/* Sign out */}
              <button
                type="button"
                onClick={handleLogout}
                disabled={submittingAction === "logout"}
                aria-label="Sign out"
                data-testid="sign-out-button"
                className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold text-[#7d3b37] transition hover:bg-[#fff1ef] hover:text-[#692f2c] focus:outline-none focus:ring-2 focus:ring-[#9a413d]/15 disabled:cursor-not-allowed disabled:opacity-65"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#f8eeee] text-[#8f3f3a]">
                  <LogOut size={14} />
                </span>
                {submittingAction === "logout" ? "Signing out..." : "Sign out"}
              </button>
              {error && (
                <p role="alert" data-testid="auth-error" className="px-2.5 pb-1 text-xs font-bold text-[#8f3f3a]">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>

        <WhatsNewModal open={showWhatsNew} onClose={() => setShowWhatsNew(false)} />
      </>
    );
  }

  return (
    <section
      ref={menuRef}
      aria-label="User sign in"
      data-testid="user-sign-in"
      className={`relative ${isSidebar ? "flex w-full" : "inline-flex justify-end"} text-sm ${className}`}
    >
      <Link
        href={signInHref}
        data-testid="account-sign-in-button"
        className={
          isSidebar
            ? "inline-flex h-11 w-full items-center gap-2 rounded-xl border border-[#ebe7f1] bg-white px-3 font-black text-[#5d427d] shadow-sm transition hover:bg-[#f7f3fb] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
            : "inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-[#f1e8fb] px-4 py-2.5 font-black text-[#5d427d] shadow-sm transition hover:bg-[#e4d5f6] focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
        }
      >
        <LogIn size={17} />
        Sign in
      </Link>
    </section>
  );
}
