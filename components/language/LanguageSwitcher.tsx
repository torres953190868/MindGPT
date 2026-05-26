"use client";

import { Check, Languages } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { BRANCHMIND_LANGUAGES, type BranchMindLanguage } from "@/lib/language";

export function LanguageSwitcher() {
  const { copy, language, saveStatus, setLanguage } = useLanguage();

  function getLanguageDescription(id: BranchMindLanguage) {
    return id === "zh" ? copy.language.zhDescription : copy.language.englishDescription;
  }

  function getLanguageLabel(id: BranchMindLanguage) {
    return id === "zh" ? copy.language.zhLabel : copy.language.englishLabel;
  }

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={copy.language.title}
        className="grid gap-3 sm:grid-cols-2"
      >
        {BRANCHMIND_LANGUAGES.map((languageOption) => {
          const selected = language === languageOption.id;

          return (
            <button
              key={languageOption.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void setLanguage(languageOption.id)}
              className={`group flex min-h-28 items-start justify-between gap-4 rounded-lg border p-4 text-left transition focus:outline-none focus:ring-4 ${
                selected
                  ? "border-brand-400 bg-surface-soft text-neutral-900 shadow-md shadow-brand-100/45 focus:ring-brand-100"
                  : "border-neutral-200 bg-surface-elevated text-neutral-800 hover:border-brand-200 hover:bg-surface-soft focus:ring-brand-100"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"
                  >
                    <Languages size={16} />
                  </span>
                  <span className="text-sm font-black">{getLanguageLabel(languageOption.id)}</span>
                </span>
                <span className="mt-2 block text-sm font-semibold leading-6 text-neutral-600">
                  {getLanguageDescription(languageOption.id)}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition ${
                  selected
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-neutral-300 bg-surface-elevated text-transparent group-hover:border-brand-300"
                }`}
              >
                <Check size={15} />
              </span>
            </button>
          );
        })}
      </div>
      {saveStatus !== "idle" && (
        <p
          role={saveStatus === "error" ? "alert" : "status"}
          className={`text-sm font-bold ${
            saveStatus === "error" ? "text-danger-600" : "text-success-700"
          }`}
        >
          {saveStatus === "saving"
            ? copy.language.saving
            : saveStatus === "error"
              ? copy.language.error
              : copy.language.saved}
        </p>
      )}
    </div>
  );
}
