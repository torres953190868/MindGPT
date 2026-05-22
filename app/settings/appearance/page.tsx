import { Palette } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";

export default function AppearanceSettingsPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-md">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
            <Palette size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black text-neutral-900">Interface Theme</h2>
            <p className="mt-0.5 text-sm font-semibold leading-6 text-neutral-600">
              Choose the workspace skin that best matches your preferred working atmosphere.
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
