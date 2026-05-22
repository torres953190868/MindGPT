import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="settings-shell min-h-screen text-[#29252f]">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-6 md:py-10">
        <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/projects"
              aria-label="Back to projects"
              className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-full border border-[#d9d0c2] bg-[#fffdf8] px-3.5 text-sm font-bold text-[#514a55] shadow-[0_1px_2px_rgba(52,45,35,0.05)] transition hover:border-[#c7bcad] hover:bg-[#fffaf3] focus:outline-none focus:ring-4 focus:ring-[#dbe9e2]"
            >
              <ArrowLeft size={16} />
              Back
            </Link>
            <h1 className="text-3xl font-black tracking-normal text-[#29252f]">Settings</h1>
            <p className="mt-1.5 text-sm font-semibold text-[#766d78]">
              Manage your account, usage, and billing preferences.
            </p>
          </div>
          <div className="hidden rounded-full border border-[#ddd4c7] bg-[#fffdf8]/90 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#766d78] shadow-[0_10px_28px_rgba(52,45,35,0.055)] md:block">
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
