"use client";

import { useLanguage } from "@/components/language/LanguageProvider";

export function LanguageSettingsHeader() {
  const { copy } = useLanguage();

  return (
    <div className="min-w-0">
      <h2 className="text-base font-black text-neutral-900">{copy.language.title}</h2>
      <p className="mt-0.5 text-sm font-semibold leading-6 text-neutral-600">
        {copy.language.description}
      </p>
    </div>
  );
}
