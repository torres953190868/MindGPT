import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CurriculumListPage } from "@/components/curriculum/CurriculumListPage";
import { isCurriculumAgentEnabled } from "@/lib/server/feature-flags";

export const metadata: Metadata = {
  title: "Curricula",
  description: "Create and manage BranchMind curricula.",
};

export default function CurriculaPage() {
  if (!isCurriculumAgentEnabled()) notFound();
  return <CurriculumListPage />;
}
