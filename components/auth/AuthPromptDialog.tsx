"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  AuthCredentialsForm,
  type AuthApiResult,
  type AuthMode,
} from "@/components/auth/AuthCredentialsForm";
import { useLanguage } from "@/components/language/LanguageProvider";

type AuthPromptDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: (result: AuthApiResult) => void | Promise<void>;
};

type AuthPromptMode = Extract<AuthMode, "sign-in" | "sign-up">;

const AUTH_PROMPT_TITLE_ID = "auth-required-dialog-title";

export function AuthPromptDialog({
  open,
  onOpenChange,
  onAuthenticated,
}: AuthPromptDialogProps) {
  const { copy } = useLanguage();
  const [mode, setMode] = useState<AuthPromptMode>("sign-in");

  useEffect(() => {
    if (open) setMode("sign-in");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      data-testid="auth-required-dialog-backdrop"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-neutral-950/45 p-3 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={AUTH_PROMPT_TITLE_ID}
        data-testid="auth-required-dialog"
        className="relative w-full max-w-md rounded-lg border border-white/85 bg-white p-4 shadow-2xl shadow-neutral-950/20 sm:p-5 md:p-6"
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={copy.common.close}
          data-testid="auth-dialog-close-button"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-neutral-600 transition hover:bg-neutral-100 focus:outline-none focus:ring-4 focus:ring-brand-100"
        >
          <X size={18} />
        </button>
        <div className="pr-9">
          <AuthCredentialsForm
            mode={mode}
            nextPath="/"
            titleId={AUTH_PROMPT_TITLE_ID}
            showGoogle={false}
            onModeChange={setMode}
            onSuccess={onAuthenticated}
          />
        </div>
      </section>
    </div>
  );
}
