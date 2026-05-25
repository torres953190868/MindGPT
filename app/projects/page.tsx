import { ProjectCardList } from "@/components/ProjectCardList";

export default function ProjectsPage() {
  return (
    <main
      aria-labelledby="projects-title"
      data-testid="projects-page"
      className="branchmind-projects-surface min-h-[100svh] p-2 text-neutral-900 sm:p-3 lg:p-4"
    >
      <ProjectCardList />
    </main>
  );
}
