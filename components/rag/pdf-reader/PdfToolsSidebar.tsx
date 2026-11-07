import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCcw,
  Send,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import {
  buildTocTree,
  findActiveSectionId,
  findTocRootId,
  isDocumentProcessing,
  pagesLabel,
  sortSectionsForToc,
} from "./helpers";
import type {
  RagChunk,
  RagDocument,
  RagQueryResponse,
  RagSection,
  TocNode,
} from "./types";

export type PdfToolsSidebarProps = {
  sections: RagSection[];
  pageNumber: number | null;
  selectedDocument: RagDocument | null;
  indexing: boolean;
  sourceLoading: boolean;
  askQuestion: string;
  askLoading: boolean;
  askError: string | null;
  askResult: RagQueryResponse | null;
  sourceChunk: RagChunk | null;
  onGoToPage: (nextPage: number) => void;
  onGoToSourcePage: (nextPage: number, chunkId: string | null) => void;
  onReindex: () => void;
  onAskQuestionChange: (value: string) => void;
  onAskPdf: (event: FormEvent<HTMLFormElement>) => void;
};

export function PdfToolsSidebar({
  sections,
  pageNumber,
  selectedDocument,
  indexing,
  sourceLoading,
  askQuestion,
  askLoading,
  askError,
  askResult,
  sourceChunk,
  onGoToPage,
  onGoToSourcePage,
  onReindex,
  onAskQuestionChange,
  onAskPdf,
}: PdfToolsSidebarProps) {
  const { copy, language } = useLanguage();
  const [expandedTocRootIds, setExpandedTocRootIds] = useState<Set<string>>(
    () => new Set(),
  );

  const canAskPdf = selectedDocument?.status === "indexed";
  const askDisabled =
    !selectedDocument || !canAskPdf || askLoading || !askQuestion.trim();

  const toggleTocRoot = useCallback((sectionId: string) => {
    setExpandedTocRootIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const sortedSections = useMemo(
    () => sortSectionsForToc(sections),
    [sections],
  );
  const tocTree = useMemo(() => buildTocTree(sortedSections), [sortedSections]);

  const activeSectionId = useMemo(
    () => findActiveSectionId(sortedSections, pageNumber),
    [pageNumber, sortedSections],
  );

  const activeChapterId = useMemo(
    () => findTocRootId(tocTree, activeSectionId),
    [activeSectionId, tocTree],
  );
  const tocRootIdsKey = useMemo(
    () => tocTree.map((node) => node.section.id).join("|"),
    [tocTree],
  );
  const defaultExpandedTocRootId =
    activeChapterId ?? tocTree[0]?.section.id ?? null;

  useEffect(() => {
    setExpandedTocRootIds(
      defaultExpandedTocRootId ? new Set([defaultExpandedTocRootId]) : new Set(),
    );
  }, [defaultExpandedTocRootId, tocRootIdsKey]);

  function renderTocChildNode(node: TocNode, depth = 0) {
    const section = node.section;
    const isActive = activeSectionId === section.id;

    return (
      <div key={section.id} className="space-y-1">
        <button
          type="button"
          data-testid="toc-section-button"
          data-section-id={section.id}
          aria-current={isActive ? "location" : undefined}
          onClick={() => onGoToPage(section.pageStart)}
          className={`w-full min-w-0 rounded-md py-1.5 pr-2 text-left text-xs font-bold leading-5 transition ${
            isActive
              ? "bg-success-50 text-success-800"
              : "text-neutral-700 hover:bg-white"
          }`}
          style={{ paddingLeft: `${Math.min(depth, 4) * 10 + 8}px` }}
        >
          <span className="block truncate">{section.title}</span>
          <span className="text-[10px] font-black text-neutral-500">
            {pagesLabel(section.pageStart, section.pageEnd)}
          </span>
        </button>

        {node.children.length > 0 && (
          <div className="ml-3 border-l border-neutral-200 pl-2">
            {node.children.map((child) => renderTocChildNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      data-testid="pdf-tools-sidebar"
      className="order-3 flex min-w-0 flex-col border-t border-neutral-200 bg-neutral-50 lg:order-1 lg:max-h-[calc(100svh-92px)] lg:overflow-hidden lg:border-r lg:border-t-0"
    >
      <div
        data-testid="pdf-toc-section"
        className="flex min-h-0 flex-1 flex-col p-3 sm:p-4"
      >
        <h2 className="text-[11px] font-black uppercase tracking-wider text-neutral-800">
          {copy.reader.toc}
        </h2>
        <div
          data-testid="pdf-toc-list"
          className="mt-3 min-h-0 flex-1 space-y-1 overflow-auto px-1"
        >
          {tocTree.map((node) => {
            const section = node.section;
            const isActive = activeSectionId === section.id;
            const isActiveChapter = activeChapterId === section.id;
            const isExpanded = expandedTocRootIds.has(section.id);
            const hasChildren = node.children.length > 0;

            return (
              <div key={section.id} className="min-w-0">
                <div className="flex min-w-0 items-start gap-1">
                  {hasChildren ? (
                    <button
                      type="button"
                      data-testid="toc-section-toggle"
                      data-section-id={section.id}
                      aria-label={`${
                        isExpanded
                          ? copy.common.close
                          : language === "zh"
                            ? "展开"
                            : "Expand"
                      } ${section.title}`}
                      aria-expanded={isExpanded}
                      aria-controls={`toc-children-${section.id}`}
                      onClick={() => toggleTocRoot(section.id)}
                      className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-success-600 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-success-200"
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </button>
                  ) : (
                    <span className="mt-1 h-6 w-6 shrink-0" />
                  )}

                  <button
                    type="button"
                    data-testid="toc-section-button"
                    data-section-id={section.id}
                    aria-current={isActive ? "location" : undefined}
                    onClick={() => onGoToPage(section.pageStart)}
                    className={`relative min-h-9 min-w-0 flex-1 rounded-md px-2 py-2 text-left text-xs font-black leading-5 transition ${
                      isActive
                        ? "bg-success-50 text-success-800"
                        : isActiveChapter
                          ? "bg-success-50/50 text-success-700"
                          : "text-neutral-800 hover:bg-white"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-success-500" />
                    )}
                    <span className="block truncate">{section.title}</span>
                    <span className="text-[10px] font-black text-neutral-500">
                      {pagesLabel(section.pageStart, section.pageEnd)}
                    </span>
                  </button>
                </div>

                {hasChildren && isExpanded && (
                  <div
                    id={`toc-children-${section.id}`}
                    className="ml-9 mt-1 space-y-1 border-l border-neutral-200 pl-3"
                  >
                    {node.children.map((child) => renderTocChildNode(child))}
                  </div>
                )}
              </div>
            );
          })}
          {tocTree.length === 0 && (
            <div className="flex flex-col items-center rounded-lg bg-white px-3 py-6 text-center">
              <FileText size={24} className="text-neutral-300" />
              <p className="mt-2 text-sm font-bold text-neutral-600">
                {copy.reader.noSections}
              </p>
            </div>
          )}
        </div>
      </div>

      <div
        data-testid="pdf-ask-section"
        className="flex min-h-0 flex-col border-t border-neutral-200 p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-black uppercase tracking-wider text-neutral-800">
            Ask PDF
          </h2>
          {sourceLoading && (
            <Loader2
              size={14}
              className="shrink-0 animate-spin text-neutral-500"
            />
          )}
        </div>

        {selectedDocument && !canAskPdf && (
          <button
            type="button"
            onClick={onReindex}
            disabled={indexing || isDocumentProcessing(selectedDocument.status)}
            data-testid="enable-ask-pdf-button"
            className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-success-200 bg-success-50 px-3 text-xs font-black text-success-700 transition hover:bg-success-100 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {indexing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCcw size={14} />
            )}
            {isDocumentProcessing(selectedDocument.status)
              ? copy.reader.preparingPdf
              : copy.reader.enableAskPdf}
          </button>
        )}

        <form
          onSubmit={onAskPdf}
          data-testid="ask-pdf-form"
          className="mt-3 space-y-2"
        >
          <textarea
            value={askQuestion}
            onChange={(event) => onAskQuestionChange(event.target.value)}
            disabled={!selectedDocument || !canAskPdf || askLoading}
            data-testid="ask-pdf-input"
            placeholder={copy.reader.askAnything}
            rows={3}
            className="min-h-20 w-full resize-none rounded-md border border-neutral-200 bg-white p-3 text-xs font-bold leading-5 text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={askDisabled}
            data-testid="ask-pdf-button"
            className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {askLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            {language === "zh" ? "提问" : "Ask"}
          </button>
        </form>

        {askError && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-3 text-xs font-bold leading-5 text-danger-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {askError}
          </p>
        )}

        <div className="mt-3 max-h-80 min-h-0 overflow-auto pr-1">
          {askResult && (
            <div data-testid="ask-pdf-answer" className="space-y-3">
              <p className="whitespace-pre-wrap rounded-md bg-white p-3 text-xs font-bold leading-6 text-neutral-700">
                {askResult.answer}
              </p>
              {askResult.citations.length > 0 && (
                <div className="space-y-2">
                  {askResult.citations.map((citation, index) => (
                    <button
                      key={`${citation.chunkId}-${citation.pageStart}`}
                      type="button"
                      data-testid="ask-pdf-citation"
                      onClick={() =>
                        onGoToSourcePage(citation.pageStart, citation.chunkId)
                      }
                      className="flex w-full min-w-0 gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-left transition hover:border-brand-200 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    >
                      <span className="mt-0.5 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-black leading-none text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-black text-brand-700">
                          {pagesLabel(citation.pageStart, citation.pageEnd)}
                        </span>
                        {citation.headingPath.length > 0 && (
                          <span className="mt-1 block truncate text-[11px] font-bold text-neutral-500">
                            {citation.headingPath.join(" / ")}
                          </span>
                        )}
                        <span className="mt-1 block line-clamp-3 text-xs font-bold leading-5 text-neutral-700">
                          {citation.quote}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {sourceChunk && (
            <div
              data-testid="source-evidence"
              className="mt-3 rounded-md border border-success-200 bg-success-50 p-3"
            >
              <p className="text-[11px] font-black text-success-700">
                {pagesLabel(sourceChunk.pageStart, sourceChunk.pageEnd)}
              </p>
              {sourceChunk.headingPath.length > 0 && (
                <p className="mt-1 truncate text-[11px] font-bold text-success-700/80">
                  {sourceChunk.headingPath.join(" / ")}
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-xs font-bold leading-6 text-neutral-700">
                {sourceChunk.content}
              </p>
            </div>
          )}

          {!askResult && !sourceChunk && !sourceLoading && (
            <p className="rounded-md bg-white px-3 py-4 text-xs font-bold leading-5 text-neutral-600">
              {selectedDocument?.status === "indexed"
                ? copy.reader.ready
                : selectedDocument
                  ? copy.reader.indexToAsk
                  : copy.reader.selectPdfAsk}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
