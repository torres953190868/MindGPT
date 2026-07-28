"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  AuthCredentialsForm,
  type AuthApiResult,
  type AuthMode,
} from "@/components/auth/AuthCredentialsForm";
import { useLanguage } from "@/components/language/LanguageProvider";

type AuthPageShellProps = {
  mode: AuthMode;
  nextPath: string;
  initialAccountName?: string;
};

export function AuthPageShell({
  mode,
  nextPath,
  initialAccountName = "",
}: AuthPageShellProps) {
  const { copy } = useLanguage();
  const router = useRouter();

  function handleSuccess(result: AuthApiResult) {
    router.push(result.next || nextPath);
    router.refresh();
  }

  return (
    <main
      aria-labelledby="auth-title"
      data-testid={`auth-${mode}-page`}
      className="min-h-[100svh] px-3 py-4 sm:px-5 sm:py-6"
    >
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] max-w-5xl flex-col sm:min-h-[calc(100svh-3rem)]">
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/90 bg-white/75 px-4 py-2.5 text-sm font-extrabold text-neutral-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            <ArrowLeft size={17} />
            {copy.common.home}
          </Link>
          <Link
            href="/projects"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-success-50 px-4 py-2.5 text-sm font-black text-success-700 shadow-sm transition hover:bg-success-100 focus:outline-none focus:ring-4 focus:ring-success-100"
          >
            <CheckCircle2 size={16} />
            {copy.common.projects}
          </Link>
        </header>

        <section className="grid flex-1 place-items-center py-5 sm:py-8">
          <div className="w-full max-w-md rounded-lg border border-white/85 bg-white/90 p-4 shadow-xl shadow-brand-100/35 backdrop-blur sm:p-5 md:p-6">
            <AuthCredentialsForm
              mode={mode}
              nextPath={nextPath}
              initialAccountName={initialAccountName}
              onSuccess={handleSuccess}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
