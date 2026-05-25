import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="settings-shell min-h-[100svh] text-neutral-900">
      <div className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-7 lg:px-6 lg:py-10">
        <div className="mb-5 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/projects"
              aria-label="Back to projects"
              className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-full border border-neutral-200 bg-surface-elevated px-3.5 text-sm font-bold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-surface-soft focus:outline-none focus:ring-4 focus:ring-brand-100"
            >
              <ArrowLeft size={16} />
              Back
            </Link>
            <h1 className="text-2xl font-black tracking-normal text-neutral-900 sm:text-3xl">Settings</h1>
            <p className="mt-1.5 text-sm font-semibold text-neutral-600">
              Manage your account, usage, and billing preferences.
            </p>
          </div>
          <div className="hidden rounded-full border border-neutral-200 bg-surface-elevated/90 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-600 shadow-md lg:block">
            Account center
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
          <SettingsNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </main>
  );
}
