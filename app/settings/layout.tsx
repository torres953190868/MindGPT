import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#faf8fc]">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-10">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl font-extrabold text-[#342b3a]">Settings</h1>
          <p className="mt-1 text-sm font-medium text-[#9b8fa8]">
            Manage your account, usage, and billing preferences.
          </p>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          <SettingsNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </main>
  );
}
