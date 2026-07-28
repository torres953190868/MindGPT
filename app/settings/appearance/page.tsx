"use client";

import { Palette } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";

export default function AppearanceSettingsPage() {
  const { copy } = useLanguage();

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-md">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
            <Palette size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black text-neutral-900">{copy.settings.appearanceTitle}</h2>
            <p className="mt-0.5 text-sm font-semibold leading-6 text-neutral-600">
              {copy.settings.appearanceDescription}
            </p>
          </div>
        </div>
        <div className="mt-5">
          <ThemeSwitcher />
        </div>
      </section>
    </div>
  );
}
