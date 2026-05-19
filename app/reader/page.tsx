import { Suspense } from "react";
import { PdfReader } from "@/components/rag/PdfReader";

export default function ReaderPage() {
  return (
    <main
      aria-labelledby="reader-title"
      data-testid="reader-page"
      className="min-h-screen bg-[#fbfafc] px-4 py-5 text-[#1f1a2a] sm:px-6"
    >
      <div className="mx-auto max-w-[1440px] space-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#8463c7] text-sm font-black text-white">
            3
          </span>
          <h1 id="reader-title" className="truncate text-lg font-black text-[#1f1a2a]">
            PDF Reader desktop
          </h1>
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
