import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main
      className="flex min-h-[100svh] items-center justify-center bg-surface-bg px-4 py-8 text-text-primary"
      aria-labelledby="not-found-title"
      data-testid="not-found-page"
    >
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface-elevated p-6 text-center shadow-xl sm:p-8">
        <p className="text-5xl font-black tracking-tight text-brand-900">404</p>
        <h1 id="not-found-title" className="mt-3 text-xl font-extrabold text-text-primary">
          This branch does not exist
        </h1>
        <p className="mt-1 text-sm font-semibold text-text-muted">这个分支不存在</p>
        <p className="mt-4 text-sm leading-relaxed text-text-secondary">
          The page you are looking for may have been moved, deleted, or never existed.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          你访问的页面可能已被移动或删除，也可能从未存在过。
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-brand-900 px-5 py-2.5 text-sm font-extrabold text-surface-elevated shadow-sm transition hover:bg-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            Back to home
          </Link>
        </div>
        <p className="mt-2 text-xs text-text-muted">返回首页</p>
      </div>
    </main>
  );
}
