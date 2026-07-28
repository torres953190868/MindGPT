"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useAuthStore } from "@/store/useAuthStore";
import { useBranchMindStore } from "@/store/useBranchMindStore";

type DeleteAccountCardProps = {
  accountName: string | null;
  canDelete: boolean;
};

const dangerButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-danger-600 px-4 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-danger-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:shadow-none disabled:hover:translate-y-0";

const confirmInputClassName =
  "h-10 w-full rounded-lg border border-neutral-200 bg-surface-muted px-4 text-sm font-semibold text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-danger-400 focus:ring-2 focus:ring-danger-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500";

function resetWorkspaceStore() {
  useBranchMindStore.setState({
    projects: [],
    activeProjectId: null,
    selectedNodeId: null,
    hydrated: false,
    creatingProject: false,
    creatingNodeId: null,
    streamingNodeId: null,
    streamingMessageId: null,
    pendingInitialProjectStream: null,
    pendingProjectSyncs: {},
    aiError: null,
  });
}

export function DeleteAccountCard({ accountName, canDelete }: DeleteAccountCardProps) {
  const { copy } = useLanguage();
  const router = useRouter();
  const markSignedOut = useAuthStore((state) => state.markSignedOut);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedName = accountName?.trim().toLowerCase() ?? "";
  const deleteEnabled = canDelete && expectedName.length > 0;
  const confirmMatches =
    expectedName.length > 0 && confirmName.trim().toLowerCase() === expectedName;

  function openDialog() {
    setConfirmName("");
    setError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (deleting) return;
    setDialogOpen(false);
  }

  async function handleDeleteAccount() {
    if (!confirmMatches || deleting) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data
            ? (data.error as { message?: unknown }).message
            : null;
        setError(typeof message === "string" ? message : copy.settings.deleteAccountFailed);
        return;
      }

      markSignedOut();
      resetWorkspaceStore();
      router.replace("/");
      router.refresh();
    } catch {
      setError(copy.settings.deleteAccountFailed);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-danger-200 bg-surface-elevated p-5 shadow-md"
      data-testid="delete-account-card"
    >
      <h2 className="text-base font-black text-danger-700">{copy.settings.deleteAccount}</h2>
      <p className="mt-0.5 text-sm font-semibold text-neutral-600">
        {copy.settings.deleteAccountDescription}
      </p>

      <div className="mt-4">
        {deleteEnabled ? (
          <button
            type="button"
            onClick={openDialog}
            className={dangerButtonClassName}
            data-testid="delete-account-button"
          >
            <Trash2 size={15} />
            {copy.settings.deleteAccount}
          </button>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-surface-muted px-4 py-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-elevated text-neutral-600 ring-1 ring-inset ring-neutral-200">
              <ShieldAlert size={16} />
            </span>
            <div>
              <p className="text-sm font-black text-neutral-900">
                {copy.settings.deleteAccountSignInTitle}
              </p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-neutral-600">
                {copy.settings.deleteAccountSignInDescription}
              </p>
            </div>
          </div>
        )}
      </div>

      {dialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
          data-testid="delete-account-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={copy.settings.deleteAccount}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-danger-600" />
                <h3 className="text-base font-extrabold text-neutral-900">
                  {copy.settings.deleteAccount}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={deleting}
                aria-label={copy.common.close}
                className="grid h-8 w-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-sm font-semibold leading-6 text-neutral-700">
                {copy.settings.deleteAccountWarning}
              </p>
              <div className="space-y-2">
                <label
                  htmlFor="delete-account-confirm"
                  className="block text-xs font-black uppercase tracking-wide text-neutral-600"
                >
                  {copy.settings.deleteAccountConfirmLabel(expectedName)}
                </label>
                <input
                  id="delete-account-confirm"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={deleting}
                  placeholder={copy.settings.deleteAccountConfirmPlaceholder}
                  autoComplete="off"
                  className={confirmInputClassName}
                  data-testid="delete-account-confirm-input"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm font-bold text-danger-600">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={deleting}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-200 bg-white px-4 text-sm font-black text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {copy.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={!confirmMatches || deleting}
                  className={dangerButtonClassName}
                  data-testid="delete-account-confirm-button"
                >
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  {deleting
                    ? copy.settings.deleteAccountDeleting
                    : copy.settings.deleteAccountFinal}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
