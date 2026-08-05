"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitCompare, Loader2, Save, Send, Split, X } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  deriveCurriculumVersion,
  getCurriculumVersion,
  getCurriculumVersionDiff,
  listCurriculumVersions,
  patchCurriculumVersion,
  publishCurriculumVersion,
  type CurriculumVersionContentResponse,
  type CurriculumVersionDiffEntry,
  type CurriculumVersionSummary,
} from "@/lib/client/curriculum-api";
import {
  flattenCurriculumDiff,
  getBlockingWarningCount,
  resolveCurriculumSourceReferences,
  type CurriculumDiffDisplayEntry,
} from "./curriculum-preview-helpers";
import { useCurriculumGenerationStore } from "@/store/useCurriculumGenerationStore";

type ValidationWarning = {
  code?: string;
  severity?: "blocking" | "advisory";
  message?: string;
};

function getWarnings(content: CurriculumVersionContentResponse | null): ValidationWarning[] {
  const validation = content?.validation;
  if (!validation || typeof validation !== "object") return [];
  const warnings = (validation as { warnings?: unknown }).warnings;
  return Array.isArray(warnings) ? (warnings as ValidationWarning[]) : [];
}

function statusLabel(
  status: CurriculumVersionSummary["status"],
  copy: { draft: string; published: string; superseded: string },
) {
  return status === "published" ? copy.published : status === "superseded" ? copy.superseded : copy.draft;
}

function diffSectionLabel(
  section: CurriculumDiffDisplayEntry["section"],
  copy: {
    diffModules: string;
    diffNodes: string;
    diffEdges: string;
    diffSources: string;
  },
) {
  return copy[`diff${section[0].toUpperCase()}${section.slice(1)}` as keyof typeof copy];
}

function diffKindLabel(
  kind: CurriculumVersionDiffEntry["kind"],
  copy: { diffAdded: string; diffRemoved: string; diffChanged: string },
) {
  if (kind === "added") return copy.diffAdded;
  if (kind === "removed") return copy.diffRemoved;
  return copy.diffChanged;
}

export function CurriculumVersionPreview({ curriculumId }: { curriculumId: string }) {
  const { copy } = useLanguage();
  const copySection = copy.curriculumVersion;
  const generationDraftVersionId = useCurriculumGenerationStore((state) =>
    state.curriculumId === curriculumId ? state.draftVersionId : null,
  );
  const [versions, setVersions] = useState<CurriculumVersionSummary[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [content, setContent] = useState<CurriculumVersionContentResponse | null>(null);
  const [againstVersionId, setAgainstVersionId] = useState<string | null>(null);
  const [diffEntries, setDiffEntries] = useState<CurriculumDiffDisplayEntry[]>([]);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "derive" | "publish" | "diff" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCurriculumVersions(curriculumId);
      setVersions(result.versions);
      setSelectedVersionId((current) =>
        current && result.versions.some((version) => version.id === current)
          ? current
          : result.versions[0]?.id ?? null,
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copySection.errors.load);
    } finally {
      setLoading(false);
    }
  }, [copySection.errors.load, curriculumId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (!generationDraftVersionId) return;
    void loadVersions();
  }, [generationDraftVersionId, loadVersions]);

  useEffect(() => {
    if (!selectedVersionId) {
      setContent(null);
      return;
    }
    let active = true;
    setLoading(true);
    void getCurriculumVersion(curriculumId, selectedVersionId)
      .then((result) => {
        if (!active) return;
        setContent(result);
        setVersionLabel(result.version.versionLabel);
        setError(null);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : copySection.errors.load);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copySection.errors.load, curriculumId, selectedVersionId]);

  const otherVersions = useMemo(
    () => versions.filter((version) => version.id !== selectedVersionId),
    [selectedVersionId, versions],
  );

  async function saveLabel() {
    if (!content || content.version.status !== "draft" || !versionLabel.trim()) return;
    setBusy("save");
    try {
      const result = await patchCurriculumVersion(curriculumId, content.version.id, {
        versionLabel: versionLabel.trim(),
      });
      setContent(result);
      setVersions((current) => current.map((version) => version.id === result.version.id ? result.version : version));
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copySection.errors.save);
    } finally {
      setBusy(null);
    }
  }

  async function deriveVersion() {
    if (!content) return;
    setBusy("derive");
    try {
      const result = await deriveCurriculumVersion(curriculumId, content.version.id);
      await loadVersions();
      setSelectedVersionId(result.version.id);
      setContent(result);
      setVersionLabel(result.version.versionLabel);
      setError(null);
    } catch (deriveError) {
      setError(deriveError instanceof Error ? deriveError.message : copySection.errors.save);
    } finally {
      setBusy(null);
    }
  }

  async function confirmPublishVersion() {
    if (!content || content.version.status !== "draft") return;
    setBusy("publish");
    try {
      await publishCurriculumVersion(curriculumId, content.version.id);
      await loadVersions();
      const refreshed = await getCurriculumVersion(curriculumId, content.version.id);
      setContent(refreshed);
      setIsPublishDialogOpen(false);
      setError(null);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : copySection.errors.save);
    } finally {
      setBusy(null);
    }
  }

  async function loadDiff() {
    if (!selectedVersionId || !againstVersionId) return;
    setBusy("diff");
    try {
      const result = await getCurriculumVersionDiff(curriculumId, selectedVersionId, againstVersionId);
      setDiffEntries(flattenCurriculumDiff(result.diff));
      setError(null);
    } catch (diffError) {
      setError(diffError instanceof Error ? diffError.message : copySection.errors.load);
    } finally {
      setBusy(null);
    }
  }

  if (loading && versions.length === 0) {
    return (
      <div data-testid="curriculum-version-preview" className="rounded-xl border border-neutral-200 bg-white/95 p-4 text-sm text-neutral-500 shadow-sm">
        <Loader2 size={16} className="mr-2 inline animate-spin" /> {copySection.preview}
      </div>
    );
  }

  return (
    <section data-testid="curriculum-version-preview" className="space-y-4 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-black text-neutral-900">
          <Split size={16} className="text-brand-600" /> {copySection.title}
        </h2>
        {versions.length > 0 && (
          <select
            data-testid="curriculum-version-select"
            value={selectedVersionId ?? ""}
            onChange={(event) => setSelectedVersionId(event.target.value)}
            className="h-9 max-w-full rounded-lg border border-neutral-200 bg-surface-soft px-2 text-xs font-bold text-neutral-800"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.versionNumber} · {version.versionLabel} · {statusLabel(version.status, copySection)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{error}</p>}

      {!content ? (
        <p className="text-sm text-neutral-500">{copySection.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 text-xs font-bold text-neutral-700">
              {copySection.editLabel}
              <input
                value={versionLabel}
                disabled={content.version.status !== "draft" || busy !== null}
                onChange={(event) => setVersionLabel(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-neutral-200 bg-surface-soft px-2 text-sm font-normal text-neutral-900"
              />
            </label>
            {content.version.status === "draft" && (
              <button type="button" onClick={() => void saveLabel()} disabled={busy !== null || !versionLabel.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white disabled:opacity-50">
                {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {busy === "save" ? copySection.saving : copySection.save}
              </button>
            )}
            <button type="button" onClick={() => void deriveVersion()} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-bold text-neutral-700 disabled:opacity-50">
              {busy === "derive" ? <Loader2 size={13} className="animate-spin" /> : <GitCompare size={13} />} {busy === "derive" ? copySection.deriving : copySection.derive}
            </button>
            {content.version.status === "draft" && (
              <button type="button" onClick={() => setIsPublishDialogOpen(true)} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success-600 px-3 text-xs font-bold text-white disabled:opacity-50">
                {busy === "publish" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {busy === "publish" ? copySection.publishing : copySection.publish}
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] font-bold text-neutral-500">
            <span>{copySection.modules}: {content.draft.modules.length}</span>
            <span>{copySection.nodes}: {content.draft.modules.reduce((sum, courseModule) => sum + courseModule.nodes.length, 0)}</span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5">{statusLabel(content.version.status, copySection)}</span>
          </div>

          <div data-testid="curriculum-version-scope" className="grid gap-3 rounded-lg border border-neutral-200 bg-surface-soft p-3 sm:grid-cols-3">
            <div>
              <h3 className="text-xs font-black text-neutral-700">{copySection.assumptions}</h3>
              {content.version.assumptions.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-neutral-600">
                  {content.version.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
                </ul>
              ) : <p className="mt-1 text-xs text-neutral-500">{copySection.noItems}</p>}
            </div>
            <div>
              <h3 className="text-xs font-black text-neutral-700">{copySection.exclusions}</h3>
              {content.version.exclusions.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-neutral-600">
                  {content.version.exclusions.map((exclusion) => <li key={exclusion}>{exclusion}</li>)}
                </ul>
              ) : <p className="mt-1 text-xs text-neutral-500">{copySection.noItems}</p>}
            </div>
            <div>
              <h3 className="text-xs font-black text-neutral-700">{copySection.estimatedDuration}</h3>
              <p className="mt-1 text-xs text-neutral-600">
                {content.version.estimatedWeeks ?? "—"} {copySection.weeks} · {content.version.estimatedHours ?? "—"} {copySection.hours}
              </p>
            </div>
          </div>

          <div data-testid="curriculum-version-conflicts" className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-xs font-black text-amber-900">{copySection.conflicts}</h3>
            {content.version.conflicts.length > 0 ? (
              <div className="mt-2 space-y-2">
                {content.version.conflicts.map((conflict, index) => (
                  <div key={`${conflict.topic}-${index}`} className="rounded-md bg-white/70 p-2 text-xs text-amber-950">
                    <p className="font-bold">{conflict.topic}</p>
                    <p className="mt-1">{conflict.summary}</p>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                      {resolveCurriculumSourceReferences(conflict.sourceIds, content.draft.sources).map((source) => source.url ? (
                        <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline-offset-2 hover:underline">{source.title}</a>
                      ) : <span key={source.id}>{source.title}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="mt-1 text-xs text-amber-900">{copySection.noItems}</p>}
          </div>

          {getWarnings(content).length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h3 className="text-xs font-black text-amber-900">{copySection.warnings}</h3>
              {getWarnings(content).map((warning, index) => (
                <p key={`${warning.code ?? "warning"}-${index}`} className="text-xs text-amber-900">
                  <strong>{warning.severity === "blocking" ? copySection.blocking : copySection.advisory}:</strong> {warning.message}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-xs font-black text-neutral-700">{copySection.preview}</h3>
            {content.draft.modules.map((courseModule) => (
              <article key={courseModule.clientId} className="rounded-lg border border-neutral-200 bg-surface-soft p-3">
                <h4 className="text-sm font-black text-neutral-900">{courseModule.title}</h4>
                <p className="mt-1 text-xs text-neutral-500">{courseModule.description}</p>
                <div className="mt-2 space-y-2">
                  {courseModule.nodes.map((node) => (
                    <div key={node.clientId} className="rounded-lg bg-white p-2.5">
                      <p className="text-xs font-bold text-neutral-800">{node.title}</p>
                      <p className="mt-1 text-xs text-neutral-500">{node.summary}</p>
                      {node.prerequisiteClientIds.length > 0 && <p className="mt-1 text-[11px] text-neutral-500">{copySection.prerequisites}: {node.prerequisiteClientIds.join(", ")}</p>}
                      {node.sourceIds.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500">
                          <span>{copySection.sources}:</span>
                          {resolveCurriculumSourceReferences(node.sourceIds, content.draft.sources).map((source) => source.url ? (
                            <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline-offset-2 hover:underline">{source.title}</a>
                          ) : <span key={source.id}>{source.title}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {content.draft.sources.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-black text-neutral-700">{copySection.sources}</h3>
              {content.draft.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-brand-700 underline-offset-2 hover:underline">{source.title}</a>)}
            </div>
          )}

          {otherVersions.length > 0 && (
            <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-black text-neutral-700"><GitCompare size={13} /> {copySection.compare}</h3>
              <div className="flex flex-wrap gap-2">
                <select value={againstVersionId ?? ""} onChange={(event) => setAgainstVersionId(event.target.value)} className="h-8 min-w-44 rounded-lg border border-neutral-200 bg-white px-2 text-xs">
                  <option value="">{copySection.compareAgainst}</option>
                  {otherVersions.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber} · {version.versionLabel}</option>)}
                </select>
                <button type="button" onClick={() => void loadDiff()} disabled={!againstVersionId || busy !== null} className="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-200 px-2.5 text-xs font-bold text-neutral-700 disabled:opacity-50">{busy === "diff" && <Loader2 size={12} className="animate-spin" />} {copySection.compare}</button>
              </div>
              {diffEntries.length === 0 && againstVersionId && busy !== "diff" && <p className="flex items-center gap-1 text-xs text-success-700"><CheckCircle2 size={13} /> {copySection.noChanges}</p>}
              {diffEntries.length > 0 && (
                <div data-testid="curriculum-version-diff-entries" className="space-y-2">
                  <p className="text-xs font-bold text-neutral-700">{copySection.changes(diffEntries.length)}</p>
                  {diffEntries.map((entry) => (
                    <div key={`${entry.section}-${entry.key}`} className="rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs text-neutral-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-bold">{diffSectionLabel(entry.section, copySection)}</span>
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-800">{diffKindLabel(entry.kind, copySection)}</span>
                        <span className="font-semibold">{entry.key}</span>
                      </div>
                      {entry.changedFields && entry.changedFields.length > 0 && <p className="mt-1 text-[11px] text-neutral-500">{copySection.changedFields}: {entry.changedFields.join(", ")}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isPublishDialogOpen && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-900/35 p-4" onClick={() => busy !== "publish" && setIsPublishDialogOpen(false)}>
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="curriculum-publish-dialog-title"
                data-testid="curriculum-publish-dialog"
                className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-5 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="curriculum-publish-dialog-title" className="text-base font-black text-neutral-900">{copySection.publishDialogTitle}</h2>
                    <p className="mt-1 text-xs font-bold text-neutral-600">{copySection.publishDialogVersion(content.version.versionNumber, content.version.versionLabel)}</p>
                  </div>
                  <button type="button" aria-label={copy.common.close} onClick={() => setIsPublishDialogOpen(false)} disabled={busy === "publish"} className="grid h-8 w-8 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"><X size={16} /></button>
                </div>
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{copySection.publishDialogBlockingWarnings(getBlockingWarningCount(content))}</p>
                <p className="mt-3 text-sm leading-6 text-neutral-700">{copySection.publishDialogImmutable}</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setIsPublishDialogOpen(false)} disabled={busy === "publish"} className="h-9 rounded-lg border border-neutral-200 px-3 text-xs font-bold text-neutral-700 disabled:opacity-50">{copySection.publishDialogCancel}</button>
                  <button type="button" onClick={() => void confirmPublishVersion()} disabled={busy === "publish"} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success-600 px-3 text-xs font-bold text-white disabled:opacity-50">{busy === "publish" && <Loader2 size={13} className="animate-spin" />}{copySection.publishDialogConfirm}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
