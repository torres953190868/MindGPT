import { ArrowLeft, Brain, FileText, ScrollText, ShieldCheck } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectCardList } from "@/components/ProjectCardList";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import { ResponsiveHeader } from "@/components/ResponsiveHeader";

export default function ProjectsPage() {
  return (
    <main
      aria-labelledby="projects-title"
      data-testid="projects-page"
      className="min-h-screen px-5 py-6"
    >
      <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
        <ResponsiveHeader
          title="BranchMind Projects"
          titleId="projects-title"
          titleAs="h1"
          icon={<Brain size={22} />}
          navLabel="Projects navigation"
          navTestId="projects-navigation"
          actions={<AuthPanel />}
          links={[
            {
              href: "/",
              label: "Home",
              icon: <ArrowLeft size={18} />,
              testId: "projects-home-link",
            },
            {
              href: "/privacy",
              label: "Privacy",
              icon: <ShieldCheck size={17} />,
              testId: "projects-privacy-link",
            },
            { href: "/reader", label: "PDF Reader", icon: <FileText size={17} /> },
            {
              href: "/terms",
              label: "Terms",
              icon: <ScrollText size={17} />,
              testId: "projects-terms-link",
            },
          ]}
        />

        <section
          aria-label="Create project"
          data-testid="create-project-section"
          className="rounded-[24px] border border-white/80 bg-white/64 p-4 shadow-lg shadow-[#e8dcef]/35 md:rounded-[28px] md:p-5"
        >
          <ProjectLauncher compact />
        </section>

        <ProjectCardList />
      </div>
    </main>
  );
}
