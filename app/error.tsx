"use client";

import { useEffect } from "react";
import Link from "next/link";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      className="flex min-h-[100svh] items-center justify-center bg-surface-bg px-4 py-8 text-text-primary"
      aria-labelledby="error-page-title"
      data-testid="error-page"
    >
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface-elevated p-6 text-center shadow-xl sm:p-8">
        <p className="text-5xl font-black tracking-tight text-brand-900">Something went wrong</p>
        <h1 id="error-page-title" className="mt-3 text-xl font-extrabold text-text-primary">
          An error occurred while loading this page
        </h1>
        <p className="mt-1 text-sm font-semibold text-text-muted">页面加载时发生错误</p>
        <p className="mt-4 text-sm leading-relaxed text-text-secondary">
          An unexpected error occurred. Please try again in a moment.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          请重试一次；如果问题持续出现，请稍后再回来。
        </p>
        {error.digest ? (
          <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-muted">
            Error digest 错误编号：{error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] bg-brand-900 px-5 py-2.5 text-sm font-extrabold text-surface-elevated shadow-sm transition hover:bg-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-border-default bg-surface-elevated px-5 py-2.5 text-sm font-extrabold text-text-primary shadow-sm transition hover:border-border-hover hover:bg-surface-soft focus:outline-none focus:ring-4 focus:ring-brand-100"
          >
            Back to home
          </Link>
        </div>
        <p className="mt-2 text-xs text-text-muted">重试 · 返回首页</p>
      </div>
    </main>
  );
}
