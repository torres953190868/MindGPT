"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { listCurricula, type CurriculumDto } from "@/lib/client/curriculum-api";

export function CurriculumListPage() {
  const { copy } = useLanguage();
  const copySection = copy.curriculumList;
  const [curricula, setCurricula] = useState<CurriculumDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listCurricula()
      .then((result) => {
        if (!active) return;
        setCurricula(result.curricula);
        setError(null);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : copySection.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [copySection.loadError]);

  return (
    <main
      aria-labelledby="curriculum-list-title"
      data-testid="curriculum-list-page"
      className="branchmind-curriculum-surface min-h-[100svh] bg-surface-bg p-3 text-neutral-900 sm:p-4 lg:p-6"
    >
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/projects" className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline">
              <ArrowLeft size={14} aria-hidden="true" />
              {copy.common.back}
            </Link>
            <h1 id="curriculum-list-title" className="mt-2 text-2xl font-black text-neutral-900">{copySection.title}</h1>
            <p className="mt-1 text-sm text-neutral-600">{copySection.description}</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700"><BookOpen size={19} /></div>
        </header>

        <section className="rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm" aria-labelledby="curriculum-list-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="curriculum-list-heading" className="text-sm font-black text-neutral-900">{copySection.listTitle}</h2>
                <p className="mt-1 text-xs text-neutral-500">{copySection.description}</p>
              </div>
              <Link href="/curricula/new" data-testid="open-curriculum-create-button" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-brand-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-100/60">
                <Plus size={15} />
                {copySection.newButton}
              </Link>
            </div>
            {isLoading && <Loader2 size={15} className="mt-5 animate-spin text-brand-600" />}
            {error && <p role="alert" className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}
            {!isLoading && !error && curricula.length === 0 && <p className="mt-5 rounded-lg bg-surface-soft p-4 text-sm text-neutral-500">{copySection.empty}</p>}
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {curricula.map((curriculum) => (
                <Link key={curriculum.id} href={`/curricula/${curriculum.id}`} data-testid={`curriculum-list-item-${curriculum.id}`} className="group block rounded-lg border border-neutral-200 bg-surface-soft p-3 transition hover:border-brand-200 hover:bg-brand-50/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black text-neutral-900">{curriculum.title}</h3>
                      <p className="mt-1 truncate text-xs text-neutral-500">{curriculum.subject || curriculum.learningGoal}</p>
                    </div>
                    <ArrowRight size={15} className="shrink-0 text-brand-600 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
        </section>
      </div>
    </main>
  );
}
