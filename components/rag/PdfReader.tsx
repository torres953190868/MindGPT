"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WorkspaceResizeHandle } from "@/components/workspace/WorkspaceResizeHandle";
import { useLanguage } from "@/components/language/LanguageProvider";
import { getRagRequestErrorMessage } from "@/lib/client/rag-errors";
import { PdfDocumentsSidebar } from "@/components/rag/pdf-reader/PdfDocumentsSidebar";
import { PdfToolsSidebar } from "@/components/rag/pdf-reader/PdfToolsSidebar";
import { PdfViewerMain } from "@/components/rag/pdf-reader/PdfViewerMain";
import {
  type DocumentDetails,
  type LocalPdfPreview,
  type RagChunk,
  type RagDocument,
  type RagPage,
  type RagQueryResponse,
} from "@/components/rag/pdf-reader/types";
import { usePdfCanvasViewer } from "@/components/rag/pdf-reader/usePdfCanvasViewer";
import { usePdfDocumentActions } from "@/components/rag/pdf-reader/usePdfDocumentActions";
import { usePdfReaderNavigation } from "@/components/rag/pdf-reader/usePdfReaderNavigation";
import { usePdfReaderSync } from "@/components/rag/pdf-reader/usePdfReaderSync";
import { usePdfSidebarResize } from "@/components/rag/pdf-reader/usePdfSidebarResize";

export function PdfReader() {
  const { copy } = useLanguage();
  const searchParams = useSearchParams();
  const documentParam = searchParams.get("document");
  const pageParam = searchParams.get("page");
  const chunkParam = searchParams.get("chunk");

  const selectedIdRef = useRef<string | null>(null);
  const pageNumberRef = useRef<number | null>(null);
  const sourceChunkIdRef = useRef<string | null>(null);

  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [documentsReady, setDocumentsReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [, setPage] = useState<RagPage | null>(null);
  const [sourceChunk, setSourceChunk] = useState<RagChunk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [localPreview, setLocalPreview] = useState<LocalPdfPreview | null>(
    null,
  );
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [askResult, setAskResult] = useState<RagQueryResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const selectedDocument = details?.document ?? null;
  const hasActivePdf = Boolean(localPreview || selectedDocument);
  const pdfSourceUrl =
    localPreview?.url ?? (selectedId ? `/api/documents/${selectedId}/file` : null);
  const isSavedPdfSource = Boolean(!localPreview && selectedId);

  const {
    readerGridRef,
    pdfReaderGridStyle,
    handleDocumentsSidebarResizeStart,
    handleToolsSidebarResizeStart,
  } = usePdfSidebarResize();

  const {
    pdfViewerRef,
    canvasRef,
    pdfPageCount,
    pdfLoading,
    pdfRendering,
    pdfError,
    scale,
    zoomOut,
    zoomIn,
  } = usePdfCanvasViewer({
    pdfSourceUrl,
    isSavedPdfSource,
    pageNumber,
    setPageNumber,
    setPageInput,
  });

  const pageCount = pdfPageCount || selectedDocument?.pageCount || 0;

  const {
    nextReaderActionId,
    isCurrentReaderAction,
    loadDocuments,
    loadPage,
    loadSourceChunk,
    selectDocument,
    clearSelectedDocument,
    goToPage,
    goToSourcePage,
  } = usePdfReaderNavigation({
    readerCopy: copy.reader,
    selectedId,
    details,
    localPreview,
    pageCount,
    selectedIdRef,
    setDocuments,
    setSelectedId,
    setDetails,
    setPage,
    setSourceChunk,
    setSourceLoading,
    setLocalPreview,
    setPageNumber,
    setPageInput,
    setError,
    setAskResult,
    setAskError,
  });

  usePdfReaderSync({
    readerCopy: copy.reader,
    documentParam,
    pageParam,
    chunkParam,
    documents,
    documentsReady,
    selectedId,
    details,
    selectedDocument,
    pageCount,
    pageNumber,
    sourceChunk,
    localPreview,
    selectedIdRef,
    pageNumberRef,
    sourceChunkIdRef,
    nextReaderActionId,
    isCurrentReaderAction,
    loadDocuments,
    loadPage,
    loadSourceChunk,
    selectDocument,
    setDocumentsReady,
    setSelectedId,
    setDetails,
    setPage,
    setSourceChunk,
    setPageNumber,
    setPageInput,
    setError,
  });

  const {
    fileInputRef,
    uploading,
    indexing,
    busy,
    renamingDocumentId,
    renameValue,
    renameSaving,
    deletingDocumentId,
    askQuestion,
    askLoading,
    setRenameValue,
    setAskQuestion,
    handleUpload,
    startRenameDocument,
    cancelRenameDocument,
    handleRenameDocument,
    handleDeleteDocument,
    handleReindex,
    handleAskPdf,
  } = usePdfDocumentActions({
    readerCopy: copy.reader,
    selectedId,
    selectedDocument,
    pageNumber,
    selectedIdRef,
    pageNumberRef,
    sourceChunkIdRef,
    nextReaderActionId,
    loadDocuments,
    selectDocument,
    clearSelectedDocument,
    setDocuments,
    setSelectedId,
    setDetails,
    setPage,
    setSourceChunk,
    setPageNumber,
    setPageInput,
    setLocalPreview,
    setError,
    setAskResult,
    setAskError,
  });

  return (
    <section
      ref={readerGridRef}
      data-testid="pdf-reader"
      style={pdfReaderGridStyle}
      className="grid min-h-0 w-full min-w-0 overflow-visible rounded-xl border border-neutral-200 bg-white shadow-xl shadow-[rgba(60,45,30,0.08)] lg:h-[calc(100svh-92px)] lg:min-h-[calc(100svh-92px)] lg:grid-cols-[var(--pdf-reader-grid-columns)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:overflow-hidden"
    >
      <PdfDocumentsSidebar
        fileInputRef={fileInputRef}
        documents={documents}
        selectedId={selectedId}
        busy={busy}
        uploading={uploading}
        renamingDocumentId={renamingDocumentId}
        renameValue={renameValue}
        renameSaving={renameSaving}
        deletingDocumentId={deletingDocumentId}
        onUpload={handleUpload}
        onSelectDocument={(documentId) => {
          selectDocument(documentId, { updateUrl: true }).catch(
            (loadError: unknown) => {
              setError(
                getRagRequestErrorMessage(
                  loadError,
                  copy.settings.failedUpdate,
                  copy.reader,
                ),
              );
            },
          );
        }}
        onRenameValueChange={setRenameValue}
        onStartRename={startRenameDocument}
        onCancelRename={cancelRenameDocument}
        onSubmitRename={(event, document) => {
          handleRenameDocument(event, document).catch(() => undefined);
        }}
        onDeleteDocument={(document) => {
          handleDeleteDocument(document).catch(() => undefined);
        }}
      />

      <WorkspaceResizeHandle
        orientation="vertical"
        className="lg:order-4"
        ariaLabel={copy.reader.resizeDocuments}
        testId="resize-pdf-documents-sidebar"
        onResizeStart={handleDocumentsSidebarResizeStart}
      />

      <PdfViewerMain
        pdfViewerRef={pdfViewerRef}
        canvasRef={canvasRef}
        selectedId={selectedId}
        selectedDocument={selectedDocument}
        localPreview={localPreview}
        uploading={uploading}
        hasActivePdf={hasActivePdf}
        pageCount={pageCount}
        pageNumber={pageNumber}
        pageInput={pageInput}
        scale={scale}
        pdfLoading={pdfLoading}
        pdfRendering={pdfRendering}
        pdfError={pdfError}
        error={error}
        onPageInputChange={setPageInput}
        onGoToPage={(nextPage) => {
          goToPage(nextPage).catch(() => undefined);
        }}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
      />

      <WorkspaceResizeHandle
        orientation="vertical"
        className="lg:order-2"
        ariaLabel={copy.reader.resizeTools}
        testId="resize-pdf-tools-sidebar"
        onResizeStart={handleToolsSidebarResizeStart}
      />

      <PdfToolsSidebar
        sections={details?.sections ?? []}
        pageNumber={pageNumber}
        selectedDocument={selectedDocument}
        indexing={indexing}
        sourceLoading={sourceLoading}
        askQuestion={askQuestion}
        askLoading={askLoading}
        askError={askError}
        askResult={askResult}
        sourceChunk={sourceChunk}
        onGoToPage={(nextPage) => {
          goToPage(nextPage).catch(() => undefined);
        }}
        onGoToSourcePage={(nextPage, chunkId) => {
          goToSourcePage(nextPage, chunkId).catch(() => undefined);
        }}
        onReindex={() => {
          handleReindex().catch(() => undefined);
        }}
        onAskQuestionChange={setAskQuestion}
        onAskPdf={(event) => {
          handleAskPdf(event).catch(() => undefined);
        }}
      />
    </section>
  );
}
