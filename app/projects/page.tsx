import Link from "next/link";
import { ArrowLeft, Brain, FileText, ShieldCheck } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectCardList } from "@/components/ProjectCardList";
import { ProjectLauncher } from "@/components/ProjectLauncher";

export default function ProjectsPage() {
  return (
    <main
      aria-labelledby="projects-title"
      data-testid="projects-page"
      className="min-h-screen px-5 py-6"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <nav
            aria-label="Projects navigation"
            className="flex flex-wrap items-center gap-3 text-sm font-extrabold"
            data-testid="projects-navigation"
          >
            <Link
              href="/"
              data-testid="projects-home-link"
              className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
            >
              <ArrowLeft size={18} />
              Home
            </Link>
            <Link
              href="/privacy"
              data-testid="projects-privacy-link"
              className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
            >
              <ShieldCheck size={17} />
              Privacy
            </Link>
            <Link
              href="/reader"
              className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
            >
              <FileText size={17} />
              PDF Reader
            </Link>
            <Link
              href="/terms"
              data-testid="projects-terms-link"
              className="rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
            >
              Terms
            </Link>
          </nav>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <AuthPanel />
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-[16px] bg-[#f7d8e5] text-[#7c4e70]">
                <Brain size={22} />
              </div>
              <h1 id="projects-title" className="text-xl font-extrabold text-[#342b3a]">
                BranchMind Projects
              </h1>
            </div>
          </div>
        </header>

        <section
          aria-label="Create project"
          data-testid="create-project-section"
          className="rounded-[28px] border border-white/80 bg-white/64 p-5 shadow-lg shadow-[#e8dcef]/35"
        >
          <ProjectLauncher compact />
        </section>

        <ProjectCardList />
      </div>
    </main>
  );
}
