"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, ImagePlus, Loader2, Send, X } from "lucide-react";

type BugReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultContactEmail?: string | null;
};

const ACCEPTED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

async function readError(response: Response) {
  const data = await response.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    const error = data.error as { message?: unknown };
    if (typeof error.message === "string") return error.message;
  }
  return `Report failed (${response.status}).`;
}

export function BugReportDialog({
  open,
  onOpenChange,
  defaultContactEmail = null,
}: BugReportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState(defaultContactEmail ?? "");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function resetForm() {
    setTitle("");
    setDescription("");
    setContactEmail(defaultContactEmail ?? "");
    setScreenshot(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closeDialog = useCallback(() => {
    clearCloseTimer();
    onOpenChange(false);
  }, [clearCloseTimer, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    clearCloseTimer();
    setTitle("");
    setDescription("");
    setContactEmail(defaultContactEmail ?? "");
    setScreenshot(null);
    setError(null);
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [clearCloseTimer, defaultContactEmail, open]);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  if (!open) return null;

  function handleScreenshot(file: File | null) {
    setError(null);
    if (!file) {
      setScreenshot(null);
      return;
    }
    if (!ACCEPTED_SCREENSHOT_TYPES.has(file.type)) {
      setError("Screenshot must be PNG, JPG, or WebP.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("Screenshot must be 5 MB or smaller.");
      return;
    }
    setScreenshot(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const formData = new FormData();
      formData.set("title", title);
      formData.set("description", description);
      formData.set("contactEmail", contactEmail);
      formData.set("currentUrl", window.location.href);
      formData.set("userAgent", navigator.userAgent);
      if (screenshot) formData.set("screenshot", screenshot);

      const response = await fetch("/api/bug-reports", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      if (!response.ok) throw new Error(await readError(response));

      setSuccess(true);
      resetForm();
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setSuccess(false);
        onOpenChange(false);
      }, 1600);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center"
      data-testid="bug-report-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) closeDialog();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-5 text-neutral-950 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black">Report a bug</h2>
            <p className="mt-1 text-sm font-medium text-neutral-500">
              Send details directly to the admin queue.
            </p>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            disabled={submitting}
            aria-label="Close bug report form"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-60"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <label className="grid gap-1.5 text-sm font-bold text-neutral-700">
            Title
            <input
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="min-h-10 rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-950 outline-none transition focus:border-neutral-500"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-neutral-700">
            Description
            <textarea
              required
              maxLength={5000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-28 resize-y rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium leading-6 text-neutral-950 outline-none transition focus:border-neutral-500"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-bold text-neutral-700">
            Contact email
            <input
              type="email"
              maxLength={240}
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              className="min-h-10 rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-950 outline-none transition focus:border-neutral-500"
            />
          </label>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => handleScreenshot(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm font-black text-neutral-700 transition hover:bg-neutral-50"
            >
              <ImagePlus size={16} />
              {screenshot ? screenshot.name : "Attach screenshot"}
            </button>
          </div>
        </div>

        {(error || success) && (
          <div
            role="status"
            className={`mt-4 rounded-md border px-3 py-2 text-sm font-bold ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error ?? (
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 size={15} />
                Report sent.
              </span>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 text-sm font-black text-white transition hover:bg-neutral-800 disabled:opacity-60"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Submit report
        </button>
      </form>
    </div>
  );
}
