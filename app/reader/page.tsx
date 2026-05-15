import Link from "next/link";
import { ArrowLeft, Brain, FileText } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { PdfReader } from "@/components/rag/PdfReader";

export default function ReaderPage() {
  return (
    <main
      aria-labelledby="reader-title"
      data-testid="reader-page"
      className="min-h-screen px-5 py-6"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <nav
            aria-label="Reader navigation"
            className="flex flex-wrap items-center gap-3 text-sm font-extrabold"
          >
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Home
            </Link>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
            >
              <Brain size={17} />
              Projects
            </Link>
          </nav>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <AuthPanel />
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-[16px] bg-[#dcefe4] text-[#416c50]">
                <FileText size={22} />
              </div>
              <h1 id="reader-title" className="text-xl font-extrabold text-[#342b3a]">
                PDF Reader
              </h1>
            </div>
          </div>
        </header>

        <PdfReader />
      </div>
    </main>
  );
}
