import { type KeyboardEvent, type RefObject } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { formatRequestReference } from "@/lib/client/api";
import { getRagServiceErrorMessage } from "@/lib/client/rag-errors";
import { parsePageNumber, statusLabel } from "./helpers";
import {
  type LocalPdfPreview,
  MAX_SCALE,
  MIN_SCALE,
  type RagDocument,
} from "./types";

export type PdfViewerMainProps = {
  pdfViewerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  selectedId: string | null;
  selectedDocument: RagDocument | null;
  localPreview: LocalPdfPreview | null;
  uploading: boolean;
  hasActivePdf: boolean;
  pageCount: number;
  pageNumber: number | null;
  pageInput: string;
  scale: number;
  pdfLoading: boolean;
  pdfRendering: boolean;
  pdfError: string | null;
  error: string | null;
  onPageInputChange: (value: string) => void;
  onGoToPage: (nextPage: number) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
};

export function PdfViewerMain({
  pdfViewerRef,
  canvasRef,
  selectedId,
  selectedDocument,
  localPreview,
  uploading,
  hasActivePdf,
  pageCount,
  pageNumber,
  pageInput,
  scale,
  pdfLoading,
  pdfRendering,
  pdfError,
  error,
  onPageInputChange,
  onGoToPage,
  onZoomOut,
  onZoomIn,
}: PdfViewerMainProps) {
  const { copy, language } = useLanguage();
  const selectedDocumentTitle =
    localPreview?.fileName ||
    selectedDocument?.title ||
    selectedDocument?.fileName ||
    "Select a PDF";
  const selectedDocumentErrorReference = formatRequestReference(
    selectedDocument?.errorRequestId,
  );

  function handlePageInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const nextPage = parsePageNumber(pageInput);
    if (nextPage) onGoToPage(nextPage);
  }

  return (
    <main className="order-1 flex min-w-0 flex-col bg-white lg:order-3 lg:min-h-[calc(100svh-92px)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-3 py-3 sm:px-4">
        <div className="min-w-[180px] flex-1">
          <h2 className="truncate text-sm font-black text-neutral-900">
            {selectedDocumentTitle}
          </h2>
          <p className="mt-1 truncate text-[11px] font-bold text-neutral-600">
            {localPreview
              ? uploading
                ? copy.reader.localPreviewUploading
                : copy.reader.localPreview
              : selectedDocument
                ? statusLabel(selectedDocument.status, language)
                : copy.reader.noPdfSelected}
            {pageCount
              ? language === "zh"
                ? ` - ${pageCount} 页`
                : ` - ${pageCount} pages`
              : ""}
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
            <button
              type="button"
              disabled={!hasActivePdf || !pageNumber || pageNumber <= 1}
              onClick={() =>
                pageNumber ? onGoToPage(pageNumber - 1) : undefined
              }
              className="grid h-9 w-9 place-items-center text-neutral-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.reader.previousPage}
            >
              <ChevronLeft size={15} />
            </button>
            <input
              value={pageInput}
              onChange={(event) => onPageInputChange(event.target.value)}
              onBlur={() => {
                const nextPage = parsePageNumber(pageInput);
                if (nextPage) onGoToPage(nextPage);
                else onPageInputChange(pageNumber ? String(pageNumber) : "");
              }}
              onKeyDown={handlePageInputKeyDown}
              disabled={!hasActivePdf || !pageCount}
              aria-label={copy.reader.pageNumber}
              data-testid="pdf-page-input"
              className="h-7 w-10 rounded-md border border-transparent bg-white text-center text-xs font-black text-neutral-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
            />
            <span className="px-1 text-xs font-black text-neutral-600">
              / {pageCount || "-"}
            </span>
            <button
              type="button"
              disabled={!hasActivePdf || !pageNumber || pageNumber >= pageCount}
              onClick={() =>
                pageNumber ? onGoToPage(pageNumber + 1) : undefined
              }
              className="grid h-9 w-9 place-items-center text-neutral-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.reader.nextPage}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
            <button
              type="button"
              disabled={scale <= MIN_SCALE}
              onClick={onZoomOut}
              className="grid h-9 w-9 place-items-center text-neutral-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.reader.zoomOut}
            >
              <Minus size={15} />
            </button>
            <span className="w-11 text-center text-xs font-black text-neutral-700">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              disabled={scale >= MAX_SCALE}
              onClick={onZoomIn}
              className="grid h-9 w-9 place-items-center text-neutral-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={copy.reader.zoomIn}
            >
              <Plus size={15} />
            </button>
          </div>

          {selectedDocument && selectedId ? (
            <a
              href={`/api/documents/${selectedId}/file`}
              download={selectedDocument.fileName}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
              aria-label={copy.reader.downloadPdf}
            >
              <Download size={15} />
              <span className="hidden sm:inline">{copy.reader.download}</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 opacity-40"
              aria-label={copy.reader.downloadPdf}
            >
              <Download size={15} />
              <span className="hidden sm:inline">{copy.reader.download}</span>
            </button>
          )}
        </div>
      </div>

      {selectedDocument?.status === "failed" && selectedDocument.errorMessage && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-700">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>
              {getRagServiceErrorMessage(
                selectedDocument.errorCode,
                copy.reader,
              ) ?? selectedDocument.errorMessage}
            </p>
            {selectedDocumentErrorReference && (
              <p className="mt-1 font-mono text-xs text-danger-600">
                {selectedDocumentErrorReference}
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          data-testid="pdf-reader-error"
          className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-700"
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div
        ref={pdfViewerRef}
        data-testid="pdf-viewer"
        className="relative min-h-[380px] flex-1 overflow-auto bg-surface-muted px-3 py-4 sm:min-h-[520px] sm:px-4 sm:py-5 lg:min-h-0"
      >
        {!hasActivePdf && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-white/60 text-sm font-bold text-neutral-600 sm:min-h-[520px]">
            <FileText size={32} className="text-neutral-300" />
            <span>{copy.reader.selectPdfReading}</span>
          </div>
        )}

        {hasActivePdf && (
          <div className="flex min-w-max justify-center">
            <canvas
              ref={canvasRef}
              data-testid="pdf-page-canvas"
              className={`rounded-sm bg-white shadow-lg shadow-[rgba(60,45,30,0.1)] ${
                pdfLoading || pdfError ? "invisible" : "visible"
              }`}
            />
          </div>
        )}

        {(pdfLoading || pdfRendering) && hasActivePdf && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface-muted/70">
            <p className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-neutral-700 shadow-md">
              <Loader2 size={16} className="animate-spin" />
              {pdfLoading ? copy.reader.loadingPdf : copy.reader.renderingPage}
            </p>
          </div>
        )}

        {pdfError && hasActivePdf && (
          <div className="absolute inset-4 grid place-items-center rounded-xl border border-danger-200 bg-danger-50 p-5 text-center text-sm font-bold text-danger-700">
            <span className="inline-flex items-start gap-2">
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              {pdfError}
            </span>
          </div>
        )}
      </div>
    </main>
  );
}
