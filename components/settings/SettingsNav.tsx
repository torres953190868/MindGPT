"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CreditCard, User } from "lucide-react";

const navItems = [
  { href: "/settings/account", label: "Account", icon: User },
  { href: "/settings/usage", label: "Usage & Limits", icon: BarChart3 },
  { href: "/settings/billing", label: "Billing", icon: CreditCard },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="w-full lg:w-56 lg:shrink-0">
      <div className="space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-[#f5f1f9] text-[#5d427d]"
                  : "text-[#554665] hover:bg-[#f9f7fb]"
              }`}
            >
              <item.icon size={16} className={isActive ? "text-[#6c538d]" : "text-[#9b8fa8]"} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
