"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bug, Gauge, Settings2 } from "lucide-react";

const navItems = [
  { href: "/admin", label: "Overview", shortLabel: "Home", icon: Gauge },
  { href: "/admin/models", label: "Models", shortLabel: "Models", icon: Settings2 },
  { href: "/admin/bugs", label: "Bug reports", shortLabel: "Bugs", icon: Bug },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="w-full lg:w-60 lg:shrink-0">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#e4ddd4] bg-[#fffdf9]/90 p-1 shadow-[0_10px_30px_rgba(35,31,26,0.06)] lg:sticky lg:top-8 lg:block lg:space-y-1 lg:p-1.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`group flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-[#2b2730]/15 sm:gap-2.5 sm:px-3 lg:justify-start ${
                isActive
                  ? "bg-[#25222b] text-white shadow-[0_12px_28px_rgba(37,34,43,0.22)]"
                  : "text-[#5d5363] hover:bg-[#f6f2ea] hover:text-[#2e2933]"
              }`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition ${
                  isActive
                    ? "bg-white/12 text-white"
                    : "bg-[#f0ece5] text-[#7c7280] group-hover:bg-white"
                }`}
              >
                <item.icon size={15} />
              </span>
              <span className="min-w-0 truncate lg:hidden">{item.shortLabel}</span>
              <span className="hidden min-w-0 truncate lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
