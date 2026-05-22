import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f7f5f0] text-[#25222b]">
      <div className="mx-auto max-w-6xl px-4 py-7 md:px-6 md:py-10">
        <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/projects"
              aria-label="Back to projects"
              className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-full border border-[#ddd5cb] bg-[#fffdf9] px-3.5 text-sm font-bold text-[#4f4650] shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-[#cfc5b8] hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#d9cdbd]/35"
            >
              <ArrowLeft size={16} />
              Back
            </Link>
            <h1 className="text-3xl font-black tracking-normal text-[#25222b]">Settings</h1>
            <p className="mt-1.5 text-sm font-semibold text-[#7b717f]">
              Manage your account, usage, and billing preferences.
            </p>
          </div>
          <div className="hidden rounded-full border border-[#e4ddd4] bg-[#fffdf9] px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#7b717f] shadow-[0_8px_24px_rgba(35,31,26,0.05)] md:block">
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
