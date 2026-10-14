"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCcw, Search, X } from "lucide-react";
import type { AdminUserDto } from "@/lib/types";

type UsersResponse = {
  users: AdminUserDto[];
  total: number;
  truncated: boolean;
};

const PAGE_SIZE = 50;
const PASSWORD_MIN_LENGTH = 8;

const cardClassName =
  "rounded-lg border border-neutral-200 bg-surface-elevated shadow-[0_14px_34px_rgba(35,31,26,0.06)]";

const fieldClassName =
  "min-h-10 w-full rounded-lg border border-neutral-200 bg-surface-elevated px-3 py-2 text-sm font-semibold text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-600 focus:ring-2 focus:ring-neutral-200 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-surface-muted disabled:text-text-muted";

const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-black text-white shadow-[0_12px_26px_rgba(60,45,30,0.2)] transition hover:-translate-y-0.5 hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-text-muted disabled:shadow-none disabled:hover:translate-y-0";

const secondaryButtonClassName =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-default bg-surface-elevated px-3 text-sm font-bold text-text-secondary shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-border-default hover:bg-white disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:border-border-default disabled:hover:bg-surface-elevated";

const PLAN_BADGE_CLASSNAMES: Record<AdminUserDto["plan"], string> = {
  free: "bg-neutral-100 text-text-muted",
  pro: "bg-success-50 text-success-600",
  max: "bg-brand-50 text-brand-600",
};

async function readError(response: Response) {
  const data = await response.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    const error = data.error as { message?: unknown };
    if (typeof error.message === "string") return error.message;
  }
  return `Request failed (${response.status}).`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString();
}

function userLabel(user: AdminUserDto) {
  return user.accountName ?? user.email ?? user.userId;
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserDto | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const loadUsers = useCallback(
    async (nextPage: number = page, query: string = activeQuery) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(nextPage) });
        if (query) params.set("query", query);
        const response = await fetch(`/api/admin/users?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(await readError(response));
        const data = (await response.json()) as UsersResponse;
        setUsers(data.users);
        setTotal(data.total);
        setTruncated(data.truncated);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load users.");
      } finally {
        setLoading(false);
      }
    },
    [page, activeQuery],
  );

  useEffect(() => {
    void loadUsers(page, activeQuery);
  }, [page, activeQuery, loadUsers]);

  function applySearch() {
    setMessage(null);
    setPage(1);
    setActiveQuery(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setMessage(null);
    setPage(1);
    setActiveQuery("");
  }

  function openResetDialog(user: AdminUserDto) {
    setResetTarget(user);
    setResetPassword("");
    setResetError(null);
  }

  async function submitReset() {
    if (!resetTarget) return;

    setResetting(true);
    setResetError(null);
    try {
      const response = await fetch(
        `/api/admin/users/${resetTarget.userId}/password`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: resetPassword }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      setMessage(`Password reset for ${userLabel(resetTarget)}.`);
      setResetTarget(null);
      setResetPassword("");
    } catch (resetFailure) {
      setResetError(
        resetFailure instanceof Error ? resetFailure.message : "Failed to reset password.",
      );
    } finally {
      setResetting(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <section className={`${cardClassName} flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between`}>
        <div>
          <h2 className="text-base font-black text-neutral-900">Users</h2>
          <p className="mt-1 text-sm font-semibold text-text-muted">
            Accounts, plans, and AI usage across BranchMind.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1 sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySearch();
              }}
              placeholder="Search account name or email"
              aria-label="Search users"
              className={`${fieldClassName} pl-8`}
            />
          </div>
          <button type="button" onClick={applySearch} className={primaryButtonClassName}>
            <Search size={14} />
            Search
          </button>
          {activeQuery && (
            <button type="button" onClick={clearSearch} className={secondaryButtonClassName}>
              <X size={14} />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadUsers(page, activeQuery)}
            className={secondaryButtonClassName}
          >
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </section>

      {(message || error) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-bold ${
            error
              ? "border-danger-200 bg-danger-50 text-danger-600"
              : "border-success-200 bg-success-50 text-success-700"
          }`}
        >
          {error ?? message}
        </div>
      )}

      {truncated && !error && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm font-bold text-warning-600">
          Search only covers the first 1,000 accounts. Refine your search to narrow the results.
        </div>
      )}

      {loading ? (
        <div className={`${cardClassName} grid min-h-80 place-items-center`}>
          <Loader2 size={24} className="animate-spin text-text-muted" />
        </div>
      ) : users.length === 0 ? (
        <div className={`${cardClassName} p-8 text-center`}>
          <p className="font-black text-neutral-900">No users found.</p>
          <p className="mt-1 text-sm font-semibold text-text-muted">
            {activeQuery ? "Try a different search." : "Once people sign up, they will show up here."}
          </p>
        </div>
      ) : (
        <section className={cardClassName}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-[0.12em] text-text-muted">
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3 text-right">AI today</th>
                  <th className="px-4 py-3 text-right">AI 30d</th>
                  <th className="px-4 py-3 text-right">Projects</th>
                  <th className="px-4 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId} className="border-b border-neutral-200 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-bold text-neutral-900">{userLabel(user)}</p>
                      {user.email && user.accountName && (
                        <p className="mt-0.5 font-mono text-xs text-text-muted">{user.email}</p>
                      )}
                      {user.displayName && (
                        <p className="mt-0.5 text-xs font-semibold text-text-muted">{user.displayName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black uppercase ${PLAN_BADGE_CLASSNAMES[user.plan]}`}>
                        {user.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-text-secondary">
                      {user.subscriptionStatus ?? "inactive"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-text-secondary">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3 font-semibold text-text-secondary">{formatDate(user.lastSignInAt)}</td>
                    <td className="px-4 py-3 text-right font-bold text-text-secondary">{user.aiMessagesToday}</td>
                    <td className="px-4 py-3 text-right font-bold text-text-secondary">{user.aiMessages30d}</td>
                    <td className="px-4 py-3 text-right font-bold text-text-secondary">{user.projectCount}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openResetDialog(user)}
                        className={secondaryButtonClassName}
                      >
                        <KeyRound size={14} />
                        Reset password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3">
            <p className="text-xs font-bold text-text-muted">
              {total} user{total === 1 ? "" : "s"} · Page {page} of {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className={secondaryButtonClassName}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page >= pageCount}
                className={secondaryButtonClassName}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-brand-900/40 px-4" role="dialog" aria-modal="true" aria-label="Reset password">
          <div className={`${cardClassName} w-full max-w-md p-5`}>
            <h3 className="text-lg font-black text-neutral-900">Reset password</h3>
            <p className="mt-1 text-sm font-semibold text-text-muted">
              Set a new password for <span className="font-black text-neutral-900">{userLabel(resetTarget)}</span>. Minimum {PASSWORD_MIN_LENGTH} characters.
            </p>
            <input
              type="password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              placeholder="New password"
              aria-label="New password"
              autoComplete="new-password"
              className={`${fieldClassName} mt-4`}
            />
            {resetError && (
              <p className="mt-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-600">
                {resetError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={resetting}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitReset()}
                disabled={resetting || resetPassword.length < PASSWORD_MIN_LENGTH}
                className={primaryButtonClassName}
              >
                {resetting ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Reset password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
