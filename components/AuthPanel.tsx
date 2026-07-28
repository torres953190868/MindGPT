"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Bug,
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
import { BugReportDialog } from "@/components/BugReportLauncher";
import { useLanguage } from "@/components/language/LanguageProvider";
import { writeRememberedAuthAccountName } from "@/lib/client/auth-email";
import { getEffectiveUpgradePlan, useAuthStore } from "@/store/useAuthStore";
import type { AccountDto } from "@/app/api/account/route";

type AuthPanelProps = {
  className?: string;
  placement?: "bottom" | "top";
  variant?: "default" | "sidebar";
};

function readError(data: unknown, fallback = "Authentication request failed.") {
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return fallback;
}

function getCurrentNextPath() {
  if (typeof window === "undefined") return "/projects";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getInitial(accountName: string | null | undefined) {
  return accountName?.trim().charAt(0).toUpperCase() || "B";
}

function getPlanBadgeColor(plan: string) {
  if (plan === "pro") return "border-brand-200 bg-brand-50 text-brand-800";
  if (plan === "max") return "border-success-200 bg-success-50 text-success-700";
  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

function getHighestUsageItem(usage: AccountDto["usage"]) {
  type Item = { key: string; label: string; used: number; limit: number | null };
  const items: Item[] = [
    { key: "projects", label: "Projects", ...usage.projects },
    { key: "nodes", label: "Nodes", ...usage.nodes },
    { key: "documents", label: "PDFs", ...usage.documents },
    { key: "aiMessages", label: "AI messages", ...usage.aiMessages },
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

function UsageBar({
  used,
  limit,
  almostAtLimitLabel,
  usageLabel,
}: {
  used: number;
  limit: number | null;
  almostAtLimitLabel: string;
  usageLabel: string;
}) {
  if (limit === null) return null;
  const ratio = Math.min(used / limit, 1);
  const percentage = Math.round(ratio * 100);
  const barColor = percentage >= 95 ? "bg-danger-500" : percentage >= 80 ? "bg-brand-500" : "bg-success-500";

  return (
    <div className="px-3 pb-2.5 pt-1.5">
      <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-600">
        <span>{percentage >= 95 ? almostAtLimitLabel : usageLabel}</span>
        <span>{used}/{limit}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-200">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

const accountMenuItemClass =
  "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-100";
const accountMenuDangerItemClass =
  "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-danger-100 disabled:cursor-not-allowed disabled:opacity-65";
const accountMenuIconBaseClass =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md bg-transparent transition-all";

function getAccountMenuItemClass(isHighlighted: boolean) {
  return `${accountMenuItemClass} ${
    isHighlighted
      ? "bg-neutral-900 text-white shadow-lg duration-1000 ease-out"
      : "text-neutral-700 duration-100 ease-in"
  }`;
}

function getAccountMenuDangerItemClass(isHighlighted: boolean) {
  return `${accountMenuDangerItemClass} ${
    isHighlighted
      ? "bg-neutral-900 text-white shadow-lg duration-1000 ease-out"
      : "text-danger-600 duration-100 ease-in"
  }`;
}

function getAccountMenuIconClass(isHighlighted: boolean, tone: "default" | "danger" = "default") {
  if (isHighlighted) {
    return `${accountMenuIconBaseClass} text-white duration-1000 ease-out`;
  }

  return `${accountMenuIconBaseClass} ${
    tone === "danger"
      ? "text-danger-600 duration-100 ease-in"
      : "text-neutral-600 duration-100 ease-in"
  }`;
}

function WhatsNewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { copy } = useLanguage();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-500" />
            <h2 className="text-base font-extrabold text-neutral-900">{copy.accountMenu.whatsNew}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-neutral-100"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-5">
          <div className="space-y-5">
            {copy.accountMenu.whatsNewItems.map((item) => (
              <div key={item.version} className="relative pl-5">
                <div className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-brand-400" />
                <div className="absolute left-[3px] top-4 h-[calc(100%+12px)] w-0.5 bg-neutral-200 last:hidden" />
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">
                    {item.version}
                  </span>
                  <span className="text-xs text-neutral-500">{item.date}</span>
                </div>
                <h3 className="mt-1 text-sm font-bold text-neutral-900">{item.title}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-neutral-700">{item.description}</p>
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
  const { copy } = useLanguage();
  const pathname = usePathname();
  const menuRef = useRef<HTMLElement | null>(null);
  const sessionStatus = useAuthStore((state) => state.sessionStatus);
  const session = useAuthStore((state) => state.session);
  const accountStatus = useAuthStore((state) => state.accountStatus);
  const account = useAuthStore((state) => state.account);
  const ensureSessionLoaded = useAuthStore((state) => state.ensureSessionLoaded);
  const markSignedOut = useAuthStore((state) => state.markSignedOut);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hoveredMenuItem, setHoveredMenuItem] = useState<string | null>(null);
  const [showBugReport, setShowBugReport] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"logout" | null>(null);
  const [signInHref, setSignInHref] = useState("/auth/sign-in");
  const isSidebar = variant === "sidebar";
  const popoverPosition = placement === "top" ? "bottom-full mb-2" : "top-full mt-2";
  const popoverHorizontal = isSidebar ? "left-0 right-0 w-full" : "right-0 w-60";

  useEffect(() => {
    void ensureSessionLoaded();
    const params = new URLSearchParams({ next: getCurrentNextPath() });
    setSignInHref(`/auth/sign-in?${params.toString()}`);
  }, [ensureSessionLoaded]);

  useEffect(() => {
    if (session?.user?.accountName) writeRememberedAuthAccountName(session.user.accountName);
  }, [session?.user?.accountName]);

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

  useEffect(() => {
    if (!isMenuOpen) setHoveredMenuItem(null);
  }, [isMenuOpen]);

  async function handleLogout() {
    setSubmittingAction("logout");
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(data, copy.auth.authFailed));
      markSignedOut();
      setIsMenuOpen(false);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : copy.auth.authFailed);
    } finally {
      setSubmittingAction(null);
    }
  }

  const displayEmail = account?.email ?? session?.user?.email ?? null;
  const displayAccountName = account?.accountName ?? session?.user?.accountName ?? displayEmail;
  const displayName = account?.displayName ?? displayAccountName;
  const plan = account?.plan ?? null;
  const effectiveUpgradePlan = getEffectiveUpgradePlan(
    account,
    sessionStatus,
    accountStatus,
  );
  const highestUsage = account ? getHighestUsageItem(account.usage) : null;
  const isFreePlan = effectiveUpgradePlan === "free";
  const isUsageSettingsActive = pathname.startsWith("/settings/usage");
  const isBillingSettingsActive = pathname.startsWith("/settings/billing");
  const isAccountSettingsActive =
    pathname.startsWith("/settings") && !isUsageSettingsActive && !isBillingSettingsActive;

  function isAccountMenuItemHighlighted(id: string, active = false) {
    return hoveredMenuItem === id || (active && hoveredMenuItem === null);
  }

  function getAccountMenuHoverHandlers(id: string) {
    return {
      onMouseEnter: () => setHoveredMenuItem(id),
      onMouseLeave: () => setHoveredMenuItem(null),
    };
  }

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return (
      <section
        aria-label={copy.accountMenu.loadingUserAccount}
        data-testid="user-profile-loading"
        className={`${isSidebar ? "flex w-full" : "inline-flex justify-end"} text-sm ${className}`}
      >
        <div
          role="status"
          aria-live="polite"
          className={
            isSidebar
              ? "inline-flex h-11 w-full max-w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 shadow-sm"
              : "inline-flex min-h-11 min-w-28 max-w-full items-center gap-2 rounded-[18px] border border-white/80 bg-white/86 px-3 py-2.5 shadow-md"
          }
        >
          <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-neutral-200" />
          <span className="h-3.5 flex-1 animate-pulse rounded-full bg-neutral-200" />
        </div>
      </section>
    );
  }

  if (sessionStatus === "local") {
    return (
      <section
        aria-label={copy.accountMenu.localDevMode}
        className={`${isSidebar ? "flex w-full" : "inline-flex"} ${className}`}
      >
        <div
          role="status"
          data-testid="auth-local-mode-status"
          className={
            isSidebar
              ? "inline-flex h-11 w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-black text-neutral-700 shadow-sm"
              : "inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-white/75 px-4 py-2.5 text-sm font-black text-neutral-700 shadow-sm"
          }
        >
          <CheckCircle2 size={16} />
          {copy.accountMenu.localDevMode}
        </div>
      </section>
    );
  }

  if (sessionStatus === "authenticated" && session?.user) {
    return (
      <>
        <section
          ref={menuRef}
          aria-label={copy.accountMenu.userProfile}
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
                ? "inline-flex h-11 w-full max-w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-left font-black text-neutral-800 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
                : "inline-flex min-h-11 max-w-full items-center gap-2 rounded-[18px] border border-white/80 bg-white/86 px-3 py-2.5 font-black text-neutral-800 shadow-md transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
            }
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
              {getInitial(displayAccountName)}
            </span>
            <span className={`${isSidebar ? "flex-1" : "max-w-36"} truncate`}>
              {displayName ?? copy.accountMenu.signedIn}
            </span>
            <ChevronDown size={15} className="shrink-0 text-neutral-500" />
          </button>

          {isMenuOpen && (
            <div
              role="dialog"
              aria-label={copy.accountMenu.accountMenu}
              data-testid="account-menu-popover"
              onMouseLeave={() => setHoveredMenuItem(null)}
              className={`absolute ${popoverHorizontal} z-50 rounded-xl border border-[var(--theme-border-default)] bg-white p-1.5 text-left shadow-2xl ${popoverPosition}`}
            >
              {/* User info header with plan badge */}
              <div className="rounded-lg border border-[var(--theme-border-default)] bg-surface-soft px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                    {getInitial(displayAccountName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-neutral-900">
                      {displayAccountName ?? copy.accountMenu.branchMindAccount}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {plan && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getPlanBadgeColor(plan)}`}>
                          {plan}
                        </span>
                      )}
                      {!plan && accountStatus === "loading" && (
                        <span className="h-4 w-12 animate-pulse rounded-full bg-neutral-200" />
                      )}
                      {isFreePlan && (
                        <Link
                          href="/settings/billing"
                          onClick={() => setIsMenuOpen(false)}
                          className="inline-flex items-center gap-0.5 text-[11px] font-bold text-neutral-700 transition hover:text-neutral-900"
                        >
                          {copy.accountMenu.upgrade}
                          <ArrowUpRight size={12} />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Usage bar */}
              {highestUsage && highestUsage.limit !== null && (
                <UsageBar
                  used={highestUsage.used}
                  limit={highestUsage.limit}
                  almostAtLimitLabel={copy.accountMenu.almostAtLimit}
                  usageLabel={copy.common.usage}
                />
              )}

              {/* Menu links */}
              <div className="mt-1 space-y-0.5">
                <Link
                  href="/settings/account"
                  aria-current={isAccountSettingsActive ? "page" : undefined}
                  onClick={() => setIsMenuOpen(false)}
                  {...getAccountMenuHoverHandlers("settings-account")}
                  className={getAccountMenuItemClass(
                    isAccountMenuItemHighlighted("settings-account", isAccountSettingsActive),
                  )}
                >
                  <span
                    className={getAccountMenuIconClass(
                      isAccountMenuItemHighlighted("settings-account", isAccountSettingsActive),
                    )}
                  >
                    <Settings size={14} />
                  </span>
                  {copy.common.settings}
                </Link>
                <Link
                  href="/settings/usage"
                  aria-current={isUsageSettingsActive ? "page" : undefined}
                  onClick={() => setIsMenuOpen(false)}
                  {...getAccountMenuHoverHandlers("settings-usage")}
                  className={getAccountMenuItemClass(
                    isAccountMenuItemHighlighted("settings-usage", isUsageSettingsActive),
                  )}
                >
                  <span
                    className={getAccountMenuIconClass(
                      isAccountMenuItemHighlighted("settings-usage", isUsageSettingsActive),
                    )}
                  >
                    <BarChart3 size={14} />
                  </span>
                  {copy.settings.navUsage}
                </Link>
                <Link
                  href="/settings/billing"
                  aria-current={isBillingSettingsActive ? "page" : undefined}
                  onClick={() => setIsMenuOpen(false)}
                  {...getAccountMenuHoverHandlers("settings-billing")}
                  className={getAccountMenuItemClass(
                    isAccountMenuItemHighlighted("settings-billing", isBillingSettingsActive),
                  )}
                >
                  <span
                    className={getAccountMenuIconClass(
                      isAccountMenuItemHighlighted("settings-billing", isBillingSettingsActive),
                    )}
                  >
                    <CreditCard size={14} />
                  </span>
                  {copy.settings.billing}
                </Link>
              </div>

              <div className="my-1.5 h-px bg-[var(--theme-border-default)]" />

              {/* Bottom links */}
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowWhatsNew(true);
                  }}
                  {...getAccountMenuHoverHandlers("whats-new")}
                  className={`w-full ${getAccountMenuItemClass(
                    isAccountMenuItemHighlighted("whats-new"),
                  )}`}
                >
                  <span
                    className={getAccountMenuIconClass(
                      isAccountMenuItemHighlighted("whats-new"),
                    )}
                  >
                    <Sparkles size={14} />
                  </span>
                  {copy.accountMenu.whatsNew}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowBugReport(true);
                  }}
                  data-testid="report-bug-menu-item"
                  {...getAccountMenuHoverHandlers("report-bug")}
                  className={`w-full ${getAccountMenuItemClass(
                    isAccountMenuItemHighlighted("report-bug"),
                  )}`}
                >
                  <span
                    className={getAccountMenuIconClass(
                      isAccountMenuItemHighlighted("report-bug"),
                    )}
                  >
                    <Bug size={14} />
                  </span>
                  {copy.accountMenu.reportBug}
                </button>
                <Link
                  href="/help"
                  {...getAccountMenuHoverHandlers("help-support")}
                  className={getAccountMenuItemClass(
                    isAccountMenuItemHighlighted("help-support"),
                  )}
                >
                  <span
                    className={getAccountMenuIconClass(
                      isAccountMenuItemHighlighted("help-support"),
                    )}
                  >
                    <HelpCircle size={14} />
                  </span>
                  {copy.accountMenu.helpSupport}
                </Link>
              </div>

              <div className="my-1.5 h-px bg-[var(--theme-border-default)]" />

              {/* Sign out */}
              <button
                type="button"
                onClick={handleLogout}
                disabled={submittingAction === "logout"}
                aria-label={copy.common.signOut}
                data-testid="sign-out-button"
                {...getAccountMenuHoverHandlers("sign-out")}
                className={getAccountMenuDangerItemClass(
                  isAccountMenuItemHighlighted("sign-out"),
                )}
              >
                <span
                  className={getAccountMenuIconClass(
                    isAccountMenuItemHighlighted("sign-out"),
                    "danger",
                  )}
                >
                  <LogOut size={14} />
                </span>
                {submittingAction === "logout" ? copy.common.signingOut : copy.common.signOut}
              </button>
              {error && (
                <p role="alert" data-testid="auth-error" className="px-2.5 pb-1 text-xs font-bold text-danger-600">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>

        <BugReportDialog
          open={showBugReport}
          onOpenChange={setShowBugReport}
          defaultContactEmail={displayEmail}
        />
        <WhatsNewModal open={showWhatsNew} onClose={() => setShowWhatsNew(false)} />
      </>
    );
  }

  if (sessionStatus !== "anonymous") {
    return (
      <section
        aria-label={copy.accountMenu.unavailableLabel}
        data-testid="user-profile-unavailable"
        className={`${isSidebar ? "flex w-full" : "inline-flex justify-end"} text-sm ${className}`}
      >
        <div
          role="status"
          className={
            isSidebar
              ? "inline-flex h-11 w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 font-black text-neutral-600 shadow-sm"
              : "inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-white/75 px-4 py-2.5 font-black text-neutral-600 shadow-sm"
          }
        >
          <HelpCircle size={16} />
          {copy.accountMenu.accountUnavailable}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={menuRef}
      aria-label={copy.accountMenu.userSignIn}
      data-testid="user-sign-in"
      className={`relative ${isSidebar ? "flex w-full" : "inline-flex justify-end"} text-sm ${className}`}
    >
      <div className={`flex items-center gap-2 ${isSidebar ? "w-full" : ""}`}>
        <button
          type="button"
          onClick={() => setShowBugReport(true)}
          aria-label={copy.accountMenu.reportBug}
          title={copy.accountMenu.reportBug}
          data-testid="report-bug-anonymous-button"
          className={
            isSidebar
              ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
              : "inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-white/75 text-neutral-600 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          }
        >
          <Bug size={16} />
        </button>
        <Link
          href="/help"
          aria-label={copy.accountMenu.helpSupport}
          title={copy.accountMenu.helpSupport}
          data-testid="help-support-anonymous-link"
          className={
            isSidebar
              ? "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
              : "inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-white/75 text-neutral-600 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          }
        >
          <HelpCircle size={16} />
        </Link>
        <Link
          href={signInHref}
          data-testid="account-sign-in-button"
          className={
            isSidebar
              ? "inline-flex h-11 w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 font-black text-brand-800 shadow-sm transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
              : "inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-brand-50 px-4 py-2.5 font-black text-brand-800 shadow-sm transition hover:bg-brand-100 focus:outline-none focus:ring-4 focus:ring-brand-100"
          }
        >
          <LogIn size={17} />
          {copy.common.signIn}
        </Link>
      </div>
      <BugReportDialog open={showBugReport} onOpenChange={setShowBugReport} />
    </section>
  );
}
