import { ProjectCardList } from "@/components/ProjectCardList";

export default function ProjectsPage() {
  return (
    <main
      aria-labelledby="projects-title"
      data-testid="projects-page"
      className="branchmind-projects-surface min-h-screen p-3 text-[#241d30] md:p-4"
    >
      <ProjectCardList />
    </main>
  );
}
