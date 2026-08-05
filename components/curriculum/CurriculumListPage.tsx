"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Loader2, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  createCurriculum,
  listCurricula,
  type CurriculumDto,
} from "@/lib/client/curriculum-api";

export function CurriculumListPage() {
  const { copy } = useLanguage();
  const router = useRouter();
  const copySection = copy.curriculumList;
  const [curricula, setCurricula] = useState<CurriculumDto[]>([]);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [learningGoal, setLearningGoal] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
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

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedGoal = learningGoal.trim();
    if (!trimmedTitle || !trimmedGoal || isCreating) return;

    setIsCreating(true);
    try {
      const result = await createCurriculum({
        title: trimmedTitle,
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        learningGoal: trimmedGoal,
      });
      setCurricula((current) => [result.curriculum, ...current]);
      setTitle("");
      setSubject("");
      setLearningGoal("");
      setError(null);
      router.push(`/curricula/${result.curriculum.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : copySection.createError);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main
      aria-labelledby="curriculum-list-title"
      data-testid="curriculum-list-page"
      className="branchmind-curriculum-surface min-h-[100svh] bg-surface-bg p-3 text-neutral-900 sm:p-4 lg:p-6"
    >
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/projects" className="text-xs font-bold text-brand-700 hover:underline">{copy.common.back}</Link>
            <h1 id="curriculum-list-title" className="mt-2 text-2xl font-black text-neutral-900">{copySection.title}</h1>
            <p className="mt-1 text-sm text-neutral-600">{copySection.description}</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700"><BookOpen size={19} /></div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <form onSubmit={(event) => void handleCreate(event)} data-testid="curriculum-create-form" className="space-y-3 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-black text-neutral-900">{copySection.createTitle}</h2>
              <p className="mt-1 text-xs text-neutral-500">{copySection.createDescription}</p>
            </div>
            <label className="block text-xs font-bold text-neutral-700">
              {copySection.titleLabel}
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copySection.titlePlaceholder} disabled={isCreating} className="mt-1 h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm font-normal text-neutral-900 outline-none focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:opacity-60" />
            </label>
            <label className="block text-xs font-bold text-neutral-700">
              {copySection.subjectLabel}
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={copySection.subjectPlaceholder} disabled={isCreating} className="mt-1 h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm font-normal text-neutral-900 outline-none focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:opacity-60" />
            </label>
            <label className="block text-xs font-bold text-neutral-700">
              {copySection.goalLabel}
              <textarea value={learningGoal} onChange={(event) => setLearningGoal(event.target.value)} placeholder={copySection.goalPlaceholder} rows={3} disabled={isCreating} className="mt-1 w-full resize-none rounded-lg border border-neutral-200 bg-surface-soft px-3 py-2 text-sm font-normal text-neutral-900 outline-none focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:opacity-60" />
            </label>
            <button type="submit" disabled={isCreating || !title.trim() || !learningGoal.trim()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isCreating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {isCreating ? copySection.creating : copySection.createButton}
            </button>
          </form>

          <section className="rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm" aria-labelledby="curriculum-list-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="curriculum-list-heading" className="text-sm font-black text-neutral-900">{copySection.listTitle}</h2>
              {isLoading && <Loader2 size={15} className="animate-spin text-brand-600" />}
            </div>
            {error && <p role="alert" className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}
            {!isLoading && !error && curricula.length === 0 && <p className="mt-5 rounded-lg bg-surface-soft p-4 text-sm text-neutral-500">{copySection.empty}</p>}
            <div className="mt-3 space-y-2">
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
        </section>
      </div>
    </main>
  );
}
