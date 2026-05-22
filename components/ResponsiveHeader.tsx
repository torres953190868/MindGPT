import Link from "next/link";
import type { ReactNode } from "react";
import { Menu } from "lucide-react";

export type ResponsiveHeaderLink = {
  href: string;
  label: string;
  icon?: ReactNode;
  testId?: string;
};

type ResponsiveHeaderProps = {
  title: string;
  icon: ReactNode;
  titleId?: string;
  titleAs?: "h1" | "span";
  eyebrow?: string;
  navLabel: string;
  navTestId?: string;
  links: ResponsiveHeaderLink[];
  actions?: ReactNode;
  className?: string;
};

function HeaderLink({ link, mobile = false }: { link: ResponsiveHeaderLink; mobile?: boolean }) {
  return (
    <Link
      href={link.href}
      data-testid={mobile ? undefined : link.testId}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-white/90 bg-white/75 px-4 py-2.5 text-sm font-extrabold text-neutral-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
    >
      {link.icon}
      {link.label}
    </Link>
  );
}

export function ResponsiveHeader({
  title,
  icon,
  titleId,
  titleAs = "span",
  eyebrow,
  navLabel,
  navTestId,
  links,
  actions,
  className = "",
}: ResponsiveHeaderProps) {
  const TitleTag = titleAs;

  return (
    <header className={`relative flex items-center justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[16px] border border-white/80 bg-white/72 text-brand-700 shadow-sm">
          {icon}
        </div>
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-600">
              {eyebrow}
            </p>
          )}
          <TitleTag id={titleId} className="block truncate text-xl font-extrabold text-neutral-900">
            {title}
          </TitleTag>
        </div>
      </div>

      <div className="hidden min-w-0 items-center justify-end gap-3 md:flex">
        <nav
          aria-label={navLabel}
          className="flex flex-wrap items-center justify-end gap-3"
          data-testid={navTestId}
        >
          {links.map((link) => (
            <HeaderLink key={`${link.href}-${link.label}`} link={link} />
          ))}
        </nav>
        {actions}
      </div>

      <details className="group md:hidden">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-[18px] border border-white/90 bg-white/80 px-4 py-2.5 text-sm font-black text-neutral-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 [&::-webkit-details-marker]:hidden">
          <Menu size={17} />
          Menu
        </summary>
        <div className="absolute left-0 right-0 top-full z-40 mt-3 rounded-[24px] border border-white/80 bg-white/90 p-3 shadow-2xl shadow-brand-100/45 backdrop-blur">
          <nav aria-label={`${navLabel} mobile`} className="grid grid-cols-2 gap-2">
            {links.map((link) => (
              <HeaderLink key={`mobile-${link.href}-${link.label}`} link={link} mobile />
            ))}
          </nav>
          {actions && (
            <div
              data-testid="responsive-header-mobile-actions"
              className="mt-3 flex justify-end border-t border-neutral-200 pt-3"
            >
              {actions}
            </div>
          )}
        </div>
      </details>
    </header>
  );
}
