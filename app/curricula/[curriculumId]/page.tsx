import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CurriculumGenerationPanel } from "@/components/curriculum/CurriculumGenerationPanel";
import { CurriculumGenerationTrigger } from "@/components/curriculum/CurriculumGenerationTrigger";
import { CurriculumVersionPreview } from "@/components/curriculum/CurriculumVersionPreview";
import { isCurriculumAgentEnabled } from "@/lib/server/feature-flags";

type CurriculumPageProps = {
  params: Promise<{ curriculumId: string }>;
};

export const metadata: Metadata = {
  title: "Curriculum",
  description: "Generate and view curriculum drafts.",
};

export default async function CurriculumPage({ params }: CurriculumPageProps) {
  if (!isCurriculumAgentEnabled()) {
    notFound();
  }

  const { curriculumId } = await params;

  return (
    <main
      data-testid="curriculum-page"
      className="branchmind-curriculum-surface min-h-[100svh] bg-surface-bg p-3 text-neutral-900 sm:p-4 lg:p-6"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/curricula" className="text-xs font-bold text-brand-700 hover:underline">All curricula</Link>
        <h1 className="text-xl font-black text-neutral-900">Curriculum</h1>
        <CurriculumGenerationTrigger curriculumId={curriculumId} />
        <CurriculumGenerationPanel />
        <CurriculumVersionPreview curriculumId={curriculumId} />
      </div>
    </main>
  );
}
