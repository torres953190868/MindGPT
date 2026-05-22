"use client";

import { Check } from "lucide-react";
import { BRANCHMIND_THEMES } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {BRANCHMIND_THEMES.map((themeOption) => {
        const selected = theme === themeOption.id;

        return (
          <button
            key={themeOption.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(themeOption.id)}
            className={`group flex min-h-28 items-start justify-between gap-4 rounded-lg border p-4 text-left transition focus:outline-none focus:ring-4 ${
              selected
                ? "border-brand-400 bg-surface-soft text-neutral-900 shadow-md shadow-brand-100/45 focus:ring-brand-100"
                : "border-neutral-200 bg-surface-elevated text-neutral-800 hover:border-brand-200 hover:bg-surface-soft focus:ring-brand-100"
            }`}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="flex -space-x-1.5" aria-hidden="true">
                  {themeOption.swatches.map((swatch) => (
                    <span
                      key={swatch}
                      className="h-5 w-5 rounded-full border border-surface-elevated shadow-sm ring-1 ring-black/5"
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </span>
                <span className="text-sm font-black">{themeOption.name}</span>
              </span>
              <span className="mt-2 block text-sm font-semibold leading-6 text-neutral-600">
                {themeOption.description}
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
  );
}
