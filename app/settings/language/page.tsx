import { Languages } from "lucide-react";
import { LanguageSwitcher } from "@/components/language/LanguageSwitcher";
import { LanguageSettingsHeader } from "./settings-header";

export default function LanguageSettingsPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-md">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
            <Languages size={18} />
          </span>
          <LanguageSettingsHeader />
        </div>
        <div className="mt-5">
          <LanguageSwitcher />
        </div>
      </section>
    </div>
  );
}
