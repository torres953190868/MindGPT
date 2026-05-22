"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CreditCard, Palette, User } from "lucide-react";

const navItems = [
  { href: "/settings/account", label: "Account", shortLabel: "Account", icon: User },
  { href: "/settings/appearance", label: "Appearance", shortLabel: "Theme", icon: Palette },
  { href: "/settings/usage", label: "Usage & Limits", shortLabel: "Usage", icon: BarChart3 },
  { href: "/settings/billing", label: "Billing", shortLabel: "Billing", icon: CreditCard },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="w-full lg:w-60 lg:shrink-0">
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-neutral-200 bg-surface-elevated/85 p-1 shadow-md backdrop-blur lg:sticky lg:top-8 lg:block lg:space-y-1 lg:p-1.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`group flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-brand-200 sm:gap-2.5 sm:px-3 lg:justify-start ${
                isActive
                  ? "bg-neutral-900 text-white shadow-lg"
                  : "text-neutral-700 hover:bg-surface-muted hover:text-neutral-900"
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition ${
                  isActive
                    ? "bg-white/12 text-white"
                    : "bg-surface-muted text-neutral-600 group-hover:bg-surface-elevated"
                }`}
              >
                <item.icon size={15} />
              </span>
              <span className="sr-only min-w-0 truncate sm:not-sr-only sm:inline lg:hidden">{item.shortLabel}</span>
              <span className="hidden min-w-0 truncate lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
