"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { CurriculumGenerationPanel } from "./CurriculumGenerationPanel";
import { CurriculumGenerationTrigger } from "./CurriculumGenerationTrigger";

export function NewCurriculumPage() {
  const { copy } = useLanguage();
  const router = useRouter();

  return (
    <main
      data-testid="new-curriculum-page"
      className="branchmind-curriculum-surface min-h-[100svh] bg-surface-bg p-3 text-neutral-900 sm:p-4 lg:p-6"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/curricula" className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline">
          <ArrowLeft size={14} aria-hidden="true" />
          {copy.common.back}
        </Link>
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-neutral-900">{copy.curriculumList.createTitle}</h1>
            <p className="mt-1 text-sm text-neutral-600">{copy.curriculumList.createDescription}</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700">
            <BookOpen size={19} />
          </div>
        </header>
        <CurriculumGenerationTrigger
          onCurriculumCreated={(curriculumId) => router.replace(`/curricula/${curriculumId}`)}
        />
        <CurriculumGenerationPanel />
      </div>
    </main>
  );
}
