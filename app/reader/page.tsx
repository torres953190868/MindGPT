import { Suspense } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { PdfReader } from "@/components/rag/PdfReader";

export default function ReaderPage() {
  return (
    <main
      aria-labelledby="reader-title"
      data-testid="reader-page"
      className="branchmind-reader-surface min-h-screen bg-surface-bg px-4 py-5 text-text-primary sm:px-6"
    >
      <div className="mx-auto max-w-[1440px] space-y-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-900 text-sm font-black text-surface-elevated shadow-sm">
              3
            </span>
            <h1 id="reader-title" className="truncate text-lg font-black text-text-primary">
              PDF Reader desktop
            </h1>
          </div>
          <Link
            href="/"
            aria-label="Back to BranchMind home"
            data-testid="reader-home-button"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border-default bg-surface-elevated px-3 text-sm font-extrabold text-text-secondary shadow-sm transition hover:border-border-hover hover:bg-surface-soft focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <Home size={16} />
            Home
          </Link>
        </div>

        <Suspense
          fallback={
            <div className="rounded-lg border border-border-default bg-surface-elevated p-5 text-sm font-bold text-text-secondary shadow-sm">
              Loading reader
            </div>
          }
        >
          <PdfReader />
        </Suspense>
      </div>
    </main>
  );
}
