import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewCurriculumPage } from "@/components/curriculum/NewCurriculumPage";
import { isCurriculumAgentEnabled } from "@/lib/server/feature-flags";

export const metadata: Metadata = {
  title: "New Curriculum",
  description: "Create a curriculum and generate its first draft.",
};

export default function NewCurriculumRoute() {
  if (!isCurriculumAgentEnabled()) notFound();
  return <NewCurriculumPage />;
}
