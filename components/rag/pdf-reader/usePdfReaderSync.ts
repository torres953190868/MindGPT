import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { getRagRequestErrorMessage } from "@/lib/client/rag-errors";
import {
  clampPageNumber,
  hasExtractedPages,
  isDocumentProcessing,
  parsePageNumber,
} from "./helpers";
import {
  type DocumentDetails,
  type LocalPdfPreview,
  PDF_PROCESSING_POLL_INTERVAL_MS,
  type RagChunk,
  type RagDocument,
  type RagPage,
  type ReaderActionOptions,
} from "./types";

type ReaderCopy = ReturnType<typeof useLanguage>["copy"]["reader"];

export type UsePdfReaderSyncOptions = {
  readerCopy: ReaderCopy;
  documentParam: string | null;
  pageParam: string | null;
  chunkParam: string | null;
  documents: RagDocument[];
  documentsReady: boolean;
  selectedId: string | null;
  details: DocumentDetails | null;
  selectedDocument: RagDocument | null;
  pageCount: number;
  pageNumber: number | null;
  sourceChunk: RagChunk | null;
  localPreview: LocalPdfPreview | null;
  selectedIdRef: MutableRefObject<string | null>;
  pageNumberRef: MutableRefObject<number | null>;
  sourceChunkIdRef: MutableRefObject<string | null>;
  nextReaderActionId: () => number;
  isCurrentReaderAction: (actionId: number, documentId: string) => boolean;
  loadDocuments: () => Promise<RagDocument[]>;
  loadPage: (
    documentId: string,
    nextPage: number,
    options?: ReaderActionOptions,
  ) => Promise<boolean>;
  loadSourceChunk: (
    documentId: string,
    chunkId: string,
    options?: ReaderActionOptions,
  ) => Promise<RagChunk | null>;
  selectDocument: (
    documentId: string,
    options?: {
      pageNumber?: number | null;
      chunkId?: string | null;
      updateUrl?: boolean;
    },
  ) => Promise<void>;
  setDocumentsReady: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setDetails: Dispatch<SetStateAction<DocumentDetails | null>>;
  setPage: Dispatch<SetStateAction<RagPage | null>>;
  setSourceChunk: Dispatch<SetStateAction<RagChunk | null>>;
  setPageNumber: Dispatch<SetStateAction<number | null>>;
  setPageInput: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function usePdfReaderSync({
  readerCopy,
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
}: UsePdfReaderSyncOptions): void {
  const pageParamRef = useRef<string | null>(pageParam);
  const chunkParamRef = useRef<string | null>(chunkParam);

  useEffect(() => {
    let cancelled = false;
    loadDocuments()
      .then(() => {
        if (!cancelled) setDocumentsReady(true);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            getRagRequestErrorMessage(loadError, "Load failed.", readerCopy),
          );
          setDocumentsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadDocuments, readerCopy, setDocumentsReady, setError]);

  useEffect(() => {
    pageParamRef.current = pageParam;
    chunkParamRef.current = chunkParam;
  }, [chunkParam, pageParam]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber, pageNumberRef]);

  useEffect(() => {
    sourceChunkIdRef.current = sourceChunk?.id ?? null;
  }, [sourceChunk?.id, sourceChunkIdRef]);

  useEffect(() => {
    const previewUrl = localPreview?.url;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [localPreview?.url]);

  useEffect(() => {
    if (!documentsReady) return;

    if (documents.length === 0) {
      nextReaderActionId();
      setSelectedId(null);
      setDetails(null);
      setPage(null);
      setSourceChunk(null);
      setPageNumber(null);
      setPageInput("");
      selectedIdRef.current = null;
      return;
    }

    const requestedDocument =
      documentParam &&
      documents.some((document) => document.id === documentParam)
        ? documentParam
        : documents[0]?.id;
    if (!requestedDocument) return;
    // Only sync selection FROM external sources (URL param / document list).
    // selectedIdRef tracks the user's intended document synchronously, so once
    // it already matches the requested document there is nothing to do. We must
    // NOT key this effect off our own `details` output: doing so re-runs it
    // mid-click (after details load) while the URL param still lags behind, and
    // it would then revert the user's click back to the first PDF.
    if (selectedIdRef.current === requestedDocument) {
      return;
    }

    selectDocument(requestedDocument, {
      pageNumber: parsePageNumber(pageParamRef.current),
      chunkId: chunkParamRef.current,
      updateUrl: requestedDocument !== documentParam,
    }).catch((loadError: unknown) => {
      setError(
        getRagRequestErrorMessage(loadError, "Load failed.", readerCopy),
      );
    });
  }, [
    documentParam,
    documents,
    documentsReady,
    nextReaderActionId,
    readerCopy,
    selectDocument,
    selectedIdRef,
    setDetails,
    setError,
    setPage,
    setPageInput,
    setPageNumber,
    setSelectedId,
    setSourceChunk,
  ]);

  useEffect(() => {
    if (!documentsReady || !selectedId || documentParam !== selectedId) return;
    if (!details || details.document.id !== selectedId) return;

    const chunkId = chunkParam?.trim() || null;
    const requestedPage = parsePageNumber(pageParam);
    if (!requestedPage && !chunkId) return;

    const effectivePageCount = pageCount || details.document.pageCount;
    const clampedPage = requestedPage
      ? clampPageNumber(requestedPage, effectivePageCount)
      : null;

    if (chunkId) {
      if (
        sourceChunkIdRef.current === chunkId &&
        (!clampedPage || pageNumberRef.current === clampedPage)
      ) {
        return;
      }

      const actionId = nextReaderActionId();
      setError(null);
      loadSourceChunk(selectedId, chunkId, { actionId })
        .then((chunk) => {
          if (!chunk || !isCurrentReaderAction(actionId, selectedId)) {
            return null;
          }
          const nextPage = clampPageNumber(
            clampedPage ?? chunk.pageStart,
            effectivePageCount,
          );
          if (pageNumberRef.current === nextPage) return null;
          return loadPage(selectedId, nextPage, {
            actionId,
            loadExtractedText: hasExtractedPages(details),
          });
        })
        .catch((loadError: unknown) => {
          if (isCurrentReaderAction(actionId, selectedId)) {
            setError(
              getRagRequestErrorMessage(loadError, "Load failed.", readerCopy),
            );
          }
        });
      return;
    }

    if (sourceChunkIdRef.current) {
      setSourceChunk(null);
    }

    if (clampedPage && pageNumberRef.current !== clampedPage) {
      const actionId = nextReaderActionId();
      setError(null);
      loadPage(selectedId, clampedPage, {
        actionId,
        loadExtractedText: hasExtractedPages(details),
      }).catch((loadError: unknown) => {
        if (isCurrentReaderAction(actionId, selectedId)) {
          setError(
            getRagRequestErrorMessage(
              loadError,
              "Page failed to load.",
              readerCopy,
            ),
          );
        }
      });
    }
  }, [
    chunkParam,
    details,
    documentParam,
    documentsReady,
    isCurrentReaderAction,
    loadPage,
    loadSourceChunk,
    nextReaderActionId,
    pageCount,
    pageNumberRef,
    pageParam,
    readerCopy,
    selectedId,
    setError,
    setSourceChunk,
    sourceChunkIdRef,
  ]);

  useEffect(() => {
    if (
      !selectedId ||
      !selectedDocument ||
      selectedDocument.id !== selectedId ||
      !isDocumentProcessing(selectedDocument.status)
    ) {
      return undefined;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      loadDocuments()
        .then(() => {
          if (cancelled || selectedIdRef.current !== selectedId) return;
          return selectDocument(selectedId, {
            pageNumber: pageNumberRef.current,
          });
        })
        .catch((pollError: unknown) => {
          if (!cancelled && selectedIdRef.current === selectedId) {
            setError(
              getRagRequestErrorMessage(
                pollError,
                "PDF status failed to refresh.",
                readerCopy,
              ),
            );
          }
        });
    }, PDF_PROCESSING_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    loadDocuments,
    pageNumberRef,
    readerCopy,
    selectDocument,
    selectedDocument,
    selectedDocument?.status,
    selectedId,
    selectedIdRef,
    setError,
  ]);
}
