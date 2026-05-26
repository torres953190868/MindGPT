"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, CreditCard, Languages, Palette, User } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";

const navIcons = {
  account: User,
  appearance: Palette,
  language: Languages,
  usage: BarChart3,
  billing: CreditCard,
};

export function SettingsNav() {
  const pathname = usePathname();
  const { copy } = useLanguage();
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const navItems = [
    {
      href: "/settings/account",
      label: copy.settings.navAccount,
      shortLabel: copy.settings.navAccount,
      icon: navIcons.account,
    },
    {
      href: "/settings/appearance",
      label: copy.settings.navAppearance,
      shortLabel: copy.settings.navAppearanceShort,
      icon: navIcons.appearance,
    },
    {
      href: "/settings/language",
      label: copy.settings.language,
      shortLabel: copy.settings.languageShort,
      icon: navIcons.language,
    },
    {
      href: "/settings/usage",
      label: copy.settings.navUsage,
      shortLabel: copy.settings.navUsageShort,
      icon: navIcons.usage,
    },
    {
      href: "/settings/billing",
      label: copy.settings.billing,
      shortLabel: copy.settings.billingShort,
      icon: navIcons.billing,
    },
  ];

  return (
    <nav aria-label={copy.common.settings} className="w-full lg:w-60 lg:shrink-0">
      <div
        onMouseLeave={() => setHoveredHref(null)}
        className="grid grid-cols-5 gap-1 rounded-lg border border-neutral-200 bg-surface-elevated/85 p-1 shadow-md backdrop-blur lg:sticky lg:top-8 lg:block lg:space-y-1 lg:p-1.5"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const isHighlighted = hoveredHref === item.href || (isActive && hoveredHref === null);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onMouseEnter={() => setHoveredHref(item.href)}
              onMouseLeave={() => setHoveredHref(null)}
              className={`group flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-brand-200 sm:gap-2.5 sm:px-3 lg:justify-start ${
                isHighlighted
                  ? "bg-neutral-900 text-white shadow-lg duration-1000 ease-out"
                  : "text-neutral-700 duration-100 ease-in"
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-all ${
                  isHighlighted
                    ? "bg-white/12 text-white duration-1000 ease-out"
                    : "bg-surface-muted text-neutral-600 duration-100 ease-in"
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
