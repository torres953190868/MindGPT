import Link from "next/link";
import { Brain, FileText, FolderKanban, ShieldCheck } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectLauncher } from "@/components/ProjectLauncher";

export default function HomePage() {
  return (
    <main
      aria-labelledby="home-title"
      data-testid="home-page"
      className="min-h-screen px-5 py-6"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-[#f7d8e5] text-[#7c4e70] shadow-sm">
              <Brain size={24} />
            </div>
            <span className="text-xl font-extrabold text-[#342b3a]">BranchMind</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <nav
              aria-label="Primary navigation"
              className="flex flex-wrap items-center justify-end gap-3 text-sm font-extrabold"
              data-testid="home-primary-navigation"
            >
              <Link
                href="/projects"
                data-testid="home-projects-link"
                className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
              >
                <FolderKanban size={18} />
                Projects
              </Link>
              <Link
                href="/reader"
                className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
              >
                <FileText size={17} />
                PDF Reader
              </Link>
              <Link
                href="/privacy"
                data-testid="home-privacy-link"
                className="inline-flex items-center gap-2 rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
              >
                <ShieldCheck size={17} />
                Privacy
              </Link>
              <Link
                href="/terms"
                data-testid="home-terms-link"
                className="rounded-[18px] bg-white/75 px-4 py-3 text-[#554665] shadow-sm transition hover:bg-white"
              >
                Terms
              </Link>
            </nav>
            <AuthPanel />
          </div>
        </header>

        <section
          aria-labelledby="home-title"
          data-testid="home-hero"
          className="grid min-h-[70vh] items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]"
        >
          <div className="space-y-7">
            <p className="inline-flex rounded-full bg-[#e5f6ee] px-4 py-2 text-sm font-extrabold text-[#3d7558]">
              Visual AI learning workspace
            </p>
            <div className="space-y-5">
              <h1
                id="home-title"
                className="max-w-3xl text-5xl font-black leading-tight text-[#312737] md:text-7xl"
              >
                BranchMind
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-[#695d72]">
                Turn one AI conversation into a branching knowledge map with connected nodes,
                focused side paths, and a clear main thread.
              </p>
            </div>
            <ProjectLauncher />
          </div>

          <div className="relative min-h-[440px] overflow-hidden rounded-[32px] border border-white/80 bg-white/60 p-6 shadow-2xl shadow-[#ddcdea]/45">
            <div className="branchmind-grid absolute inset-0 opacity-90" />
            <div className="relative h-full">
              <div className="absolute left-4 top-8 w-64 rounded-[26px] border border-[#f3c4d3] bg-[#fff7fa] p-5 shadow-lg">
                <p className="font-extrabold text-[#5c4157]">Reinforcement Learning</p>
                <p className="mt-3 text-sm leading-6 text-[#7c7184]">
                  Agent, reward, policy, and environment in one overview node.
                </p>
              </div>
              <div className="absolute left-24 top-72 w-64 rounded-[26px] border border-[#c9e8d6] bg-[#f7fff9] p-5 shadow-lg">
                <p className="font-extrabold text-[#3e6d52]">Continue: value functions</p>
                <p className="mt-3 text-sm leading-6 text-[#697b70]">
                  Main path continues without losing the starting context.
                </p>
              </div>
              <div className="absolute right-2 top-32 w-64 rounded-[26px] border border-[#d9caf7] bg-[#fbf8ff] p-5 shadow-lg">
                <p className="font-extrabold text-[#5b4d7d]">Branch: Q-learning</p>
                <p className="mt-3 text-sm leading-6 text-[#777088]">
                  A side node keeps deeper exploration separate.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
