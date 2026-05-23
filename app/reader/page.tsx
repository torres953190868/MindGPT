import { Suspense } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { PdfReader } from "@/components/rag/PdfReader";

export default function ReaderPage() {
  return (
    <main
      aria-labelledby="reader-title"
      data-testid="reader-page"
      className="branchmind-reader-surface min-h-screen bg-[#fbfafc] px-4 py-5 text-[#1f1a2a] sm:px-6"
    >
      <div className="mx-auto max-w-[1440px] space-y-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#8463c7] text-sm font-black text-white">
              3
            </span>
            <h1 id="reader-title" className="truncate text-lg font-black text-[#1f1a2a]">
              PDF Reader desktop
            </h1>
          </div>
          <Link
            href="/"
            aria-label="Back to BranchMind home"
            data-testid="reader-home-button"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-[#e5dfec] bg-white px-3 text-sm font-extrabold text-[#554665] shadow-sm transition hover:bg-[#f8f5fc] focus:outline-none focus:ring-2 focus:ring-[#d9caef]"
          >
            <Home size={16} />
            Home
          </Link>
        </div>

        <Suspense
          fallback={
            <div className="rounded-lg border border-[#e4dfeb] bg-white p-5 text-sm font-bold text-[#76667f] shadow-sm">
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
