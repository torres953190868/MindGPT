import {
  Brain,
  FileText,
  FolderKanban,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import { ResponsiveHeader } from "@/components/ResponsiveHeader";

export default function HomePage() {
  return (
    <main
      aria-labelledby="home-title"
      data-testid="home-page"
      className="home-research-canvas relative min-h-screen overflow-hidden px-5 py-6"
    >
      <div className="branchmind-grid absolute inset-0 opacity-80" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#fffced]/80 to-transparent" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col">
        <ResponsiveHeader
          title="BranchMind"
          icon={<Brain size={23} />}
          navLabel="Primary navigation"
          navTestId="home-primary-navigation"
          actions={<AuthPanel />}
          links={[
            {
              href: "/projects",
              label: "Projects",
              icon: <FolderKanban size={18} />,
              testId: "home-projects-link",
            },
            { href: "/reader", label: "PDF Reader", icon: <FileText size={17} /> },
            {
              href: "/privacy",
              label: "Privacy",
              icon: <ShieldCheck size={17} />,
              testId: "home-privacy-link",
            },
            {
              href: "/terms",
              label: "Terms",
              icon: <ScrollText size={17} />,
              testId: "home-terms-link",
            },
          ]}
        />

        <section
          aria-labelledby="home-title"
          data-testid="home-hero"
          className="relative flex flex-1 items-center justify-center py-8 md:py-20"
        >
          <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
            <svg
              className="absolute left-1/2 top-1/2 h-[560px] w-[900px] -translate-x-1/2 -translate-y-[42%]"
              viewBox="0 0 900 560"
              fill="none"
            >
              <path
                d="M245 265 C322 218 381 212 448 250 C520 292 587 275 656 210"
                stroke="#bba5db"
                strokeWidth="2"
                strokeDasharray="7 8"
                opacity="0.44"
              />
              <path
                d="M305 365 C366 405 441 400 514 350 C570 312 612 320 684 365"
                stroke="#9bcfb2"
                strokeWidth="2"
                strokeDasharray="7 8"
                opacity="0.5"
              />
              <path
                d="M410 180 C472 145 526 142 588 170"
                stroke="#efbfd1"
                strokeWidth="2"
                strokeDasharray="7 8"
                opacity="0.46"
              />
            </svg>

            <div className="absolute left-[4%] top-[18%] w-64 rounded-[24px] border border-[#f1bfd1] bg-[#fff7fa]/80 p-4 shadow-lg shadow-[#edd3df]/50 backdrop-blur">
              <p className="text-sm font-black text-[#5c4157]">Reinforcement Learning</p>
              <p className="mt-2 text-sm leading-6 text-[#7c7184]">
                Agent, reward, policy, and environment in one map.
              </p>
            </div>
            <div className="absolute right-[6%] top-[26%] w-60 rounded-[24px] border border-[#d7c4f5] bg-[#fbf8ff]/80 p-4 shadow-lg shadow-[#ded2ef]/50 backdrop-blur">
              <p className="text-sm font-black text-[#5b4d7d]">Branch: Q-learning</p>
              <p className="mt-2 text-sm leading-6 text-[#777088]">
                Keep side explorations close without losing focus.
              </p>
            </div>
            <div className="absolute bottom-[12%] left-[2%] w-60 rounded-[24px] border border-[#c8e8d4] bg-[#f7fff9]/80 p-4 shadow-lg shadow-[#d4e8dc]/50 backdrop-blur">
              <p className="text-sm font-black text-[#3e6d52]">Continue: value functions</p>
              <p className="mt-2 text-sm leading-6 text-[#697b70]">
                Extend the main path with the original context intact.
              </p>
            </div>
            <div className="absolute bottom-[17%] right-[2%] w-56 rounded-[24px] border border-[#f3e0a3] bg-[#fffbed]/80 p-4 shadow-lg shadow-[#efe5bf]/50 backdrop-blur">
              <p className="text-sm font-black text-[#725b25]">Policy Optimization</p>
              <p className="mt-2 text-sm leading-6 text-[#766b53]">
                Compare tradeoffs before opening a deeper node.
              </p>
            </div>
          </div>

          <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
            <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/90 bg-[#e5f6ee]/80 px-4 py-2 text-sm font-extrabold text-[#3d7558] shadow-sm">
              <Sparkles size={16} />
              Visual AI learning workspace
            </p>
            <h1
              id="home-title"
              className="home-title-soft mt-5 text-5xl font-black leading-none text-[#312737] sm:text-6xl md:mt-8 md:text-8xl"
            >
              BranchMind
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#695d72] md:mt-6 md:text-xl md:leading-8">
              Turn one AI conversation into a branching knowledge map with connected nodes,
              focused side paths, and a clear main thread.
            </p>
            <div className="mx-auto mt-6 max-w-2xl md:mt-9">
              <ProjectLauncher variant="composer" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
