import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/components/language/LanguageProvider";
import { readJsonApi } from "@/lib/client/api";
import { getRagRequestErrorMessage } from "@/lib/client/rag-errors";
import { clampPageNumber, hasExtractedPages } from "./helpers";
import type {
  DocumentDetails,
  LocalPdfPreview,
  RagChunk,
  RagDocument,
  RagPage,
  RagQueryResponse,
  ReaderActionOptions,
} from "./types";

type ReaderCopy = ReturnType<typeof useLanguage>["copy"]["reader"];

export type UsePdfReaderNavigationOptions = {
  readerCopy: ReaderCopy;
  selectedId: string | null;
  details: DocumentDetails | null;
  localPreview: LocalPdfPreview | null;
  pageCount: number;
  selectedIdRef: MutableRefObject<string | null>;
  setDocuments: Dispatch<SetStateAction<RagDocument[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setDetails: Dispatch<SetStateAction<DocumentDetails | null>>;
  setPage: Dispatch<SetStateAction<RagPage | null>>;
  setSourceChunk: Dispatch<SetStateAction<RagChunk | null>>;
  setSourceLoading: Dispatch<SetStateAction<boolean>>;
  setLocalPreview: Dispatch<SetStateAction<LocalPdfPreview | null>>;
  setPageNumber: Dispatch<SetStateAction<number | null>>;
  setPageInput: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setAskResult: Dispatch<SetStateAction<RagQueryResponse | null>>;
  setAskError: Dispatch<SetStateAction<string | null>>;
};

export type UsePdfReaderNavigationResult = {
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
  clearSelectedDocument: () => void;
  goToPage: (nextPage: number) => Promise<void>;
  goToSourcePage: (nextPage: number, chunkId?: string | null) => Promise<void>;
};

export function usePdfReaderNavigation({
  readerCopy,
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
}: UsePdfReaderNavigationOptions): UsePdfReaderNavigationResult {
  const router = useRouter();
  const pathname = usePathname();
  const readerActionIdRef = useRef(0);
  const pageRequestIdRef = useRef(0);
  const sourceChunkRequestIdRef = useRef(0);

  const updateReaderUrl = useCallback(
    (documentId: string, nextPage: number | null, chunkId?: string | null) => {
      const params = new URLSearchParams();
      params.set("document", documentId);
      if (nextPage) params.set("page", String(nextPage));
      if (chunkId) params.set("chunk", chunkId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  const nextReaderActionId = useCallback(() => {
    readerActionIdRef.current += 1;
    return readerActionIdRef.current;
  }, []);

  const isCurrentReaderAction = useCallback(
    (actionId: number, documentId: string) =>
      readerActionIdRef.current === actionId &&
      selectedIdRef.current === documentId,
    [selectedIdRef],
  );

  const loadDocuments = useCallback(async () => {
    const data = await readJsonApi<{ documents: RagDocument[] }>(
      "/api/documents",
    );
    setDocuments(data.documents);
    return data.documents;
  }, [setDocuments]);

  const loadPage = useCallback(
    async (
      documentId: string,
      nextPage: number,
      options: ReaderActionOptions = {},
    ) => {
      const actionId = options.actionId ?? nextReaderActionId();
      const pageRequestId = pageRequestIdRef.current + 1;
      pageRequestIdRef.current = pageRequestId;
      setPageNumber(nextPage);
      setPageInput(String(nextPage));

      if (options.loadExtractedText === false) {
        if (!isCurrentReaderAction(actionId, documentId)) return false;
        setPage(null);
        return true;
      }

      try {
        const data = await readJsonApi<{ page: RagPage }>(
          `/api/documents/${documentId}/pages/${nextPage}`,
        );
        if (
          !isCurrentReaderAction(actionId, documentId) ||
          pageRequestIdRef.current !== pageRequestId
        ) {
          return false;
        }

        setPage(data.page);
        return true;
      } catch (pageError) {
        if (
          isCurrentReaderAction(actionId, documentId) &&
          pageRequestIdRef.current === pageRequestId
        ) {
          throw pageError;
        }
        return false;
      }
    },
    [isCurrentReaderAction, nextReaderActionId, setPage, setPageInput, setPageNumber],
  );

  const loadSourceChunk = useCallback(
    async (
      documentId: string,
      chunkId: string,
      options: ReaderActionOptions = {},
    ) => {
      const actionId = options.actionId ?? nextReaderActionId();
      const sourceChunkRequestId = sourceChunkRequestIdRef.current + 1;
      sourceChunkRequestIdRef.current = sourceChunkRequestId;
      setSourceLoading(true);

      try {
        const data = await readJsonApi<{ chunks: RagChunk[] }>(
          `/api/documents/${documentId}/chunks`,
        );
        if (
          !isCurrentReaderAction(actionId, documentId) ||
          sourceChunkRequestIdRef.current !== sourceChunkRequestId
        ) {
          return null;
        }

        const chunk = data.chunks.find((item) => item.id === chunkId) ?? null;
        if (!chunk) throw new Error("Source chunk was not found.");
        setSourceChunk(chunk);
        return chunk;
      } catch (chunkError) {
        if (
          isCurrentReaderAction(actionId, documentId) &&
          sourceChunkRequestIdRef.current === sourceChunkRequestId
        ) {
          throw chunkError;
        }
        return null;
      } finally {
        if (sourceChunkRequestIdRef.current === sourceChunkRequestId) {
          setSourceLoading(false);
        }
      }
    },
    [isCurrentReaderAction, nextReaderActionId, setSourceChunk, setSourceLoading],
  );

  const selectDocument = useCallback(
    async (
      documentId: string,
      options: {
        pageNumber?: number | null;
        chunkId?: string | null;
        updateUrl?: boolean;
      } = {},
    ) => {
      const actionId = nextReaderActionId();
      const isDifferentDocument = selectedIdRef.current !== documentId;
      selectedIdRef.current = documentId;
      setLocalPreview(null);
      setSelectedId(documentId);
      setError(null);
      setSourceChunk(null);
      if (isDifferentDocument) {
        setAskResult(null);
        setAskError(null);
      }

      try {
        const nextDetails = await readJsonApi<DocumentDetails>(
          `/api/documents/${documentId}`,
        );
        if (!isCurrentReaderAction(actionId, documentId)) return;
        setDetails(nextDetails);

        const fallbackPage =
          nextDetails.sections[0]?.pageStart ??
          (nextDetails.document.pageCount > 0 ? 1 : null);
        let sourceChunkForPage: RagChunk | null = null;
        if (options.chunkId) {
          sourceChunkForPage = await loadSourceChunk(
            documentId,
            options.chunkId,
            { actionId },
          );
          if (!isCurrentReaderAction(actionId, documentId)) return;
        }

        const nextPage =
          options.pageNumber ?? sourceChunkForPage?.pageStart ?? fallbackPage;
        const clampedPage = nextPage
          ? clampPageNumber(nextPage, nextDetails.document.pageCount)
          : null;

        if (clampedPage) {
          const loadedPage = await loadPage(documentId, clampedPage, {
            actionId,
            loadExtractedText: hasExtractedPages(nextDetails),
          });
          if (!loadedPage || !isCurrentReaderAction(actionId, documentId)) {
            return;
          }
        } else if (isCurrentReaderAction(actionId, documentId)) {
          setPage(null);
          setPageNumber(null);
          setPageInput("");
        }

        if (
          options.updateUrl &&
          clampedPage &&
          isCurrentReaderAction(actionId, documentId)
        ) {
          updateReaderUrl(documentId, clampedPage, options.chunkId ?? null);
        }
      } catch (loadError) {
        if (isCurrentReaderAction(actionId, documentId)) throw loadError;
      }
    },
    [
      isCurrentReaderAction,
      loadPage,
      loadSourceChunk,
      nextReaderActionId,
      selectedIdRef,
      setAskError,
      setAskResult,
      setDetails,
      setError,
      setLocalPreview,
      setPage,
      setPageInput,
      setPageNumber,
      setSelectedId,
      setSourceChunk,
      updateReaderUrl,
    ],
  );

  const clearSelectedDocument = useCallback(() => {
    nextReaderActionId();
    selectedIdRef.current = null;
    setLocalPreview(null);
    setSelectedId(null);
    setDetails(null);
    setPage(null);
    setSourceChunk(null);
    setPageNumber(null);
    setPageInput("");
    setAskResult(null);
    setAskError(null);
    router.replace(pathname, { scroll: false });
  }, [
    nextReaderActionId,
    pathname,
    router,
    selectedIdRef,
    setAskError,
    setAskResult,
    setDetails,
    setLocalPreview,
    setPage,
    setPageInput,
    setPageNumber,
    setSelectedId,
    setSourceChunk,
  ]);

  async function goToPage(nextPage: number) {
    if (!pageCount) return;
    const clampedPage = clampPageNumber(nextPage, pageCount);
    if (localPreview && !selectedId) {
      setPageNumber(clampedPage);
      setPageInput(String(clampedPage));
      return;
    }
    if (!selectedId) return;
    const actionId = nextReaderActionId();

    try {
      setError(null);
      setSourceChunk(null);
      const loadedPage = await loadPage(selectedId, clampedPage, {
        actionId,
        loadExtractedText: hasExtractedPages(details),
      });
      if (loadedPage && isCurrentReaderAction(actionId, selectedId)) {
        updateReaderUrl(selectedId, clampedPage, null);
      }
    } catch (pageError) {
      if (isCurrentReaderAction(actionId, selectedId)) {
        setError(
          getRagRequestErrorMessage(
            pageError,
            "Page failed to load.",
            readerCopy,
          ),
        );
      }
    }
  }

  async function goToSourcePage(
    nextPage: number,
    chunkId: string | null = null,
  ) {
    if (!selectedId || !pageCount) return;
    const clampedPage = clampPageNumber(nextPage, pageCount);
    const actionId = nextReaderActionId();

    try {
      setError(null);
      if (chunkId) {
        const chunk = await loadSourceChunk(selectedId, chunkId, { actionId });
        if (!chunk || !isCurrentReaderAction(actionId, selectedId)) return;
      } else {
        setSourceChunk(null);
      }
      const loadedPage = await loadPage(selectedId, clampedPage, {
        actionId,
        loadExtractedText: hasExtractedPages(details),
      });
      if (loadedPage && isCurrentReaderAction(actionId, selectedId)) {
        updateReaderUrl(selectedId, clampedPage, chunkId);
      }
    } catch (pageError) {
      if (isCurrentReaderAction(actionId, selectedId)) {
        setError(
          getRagRequestErrorMessage(
            pageError,
            "Page failed to load.",
            readerCopy,
          ),
        );
      }
    }
  }

  return {
    nextReaderActionId,
    isCurrentReaderAction,
    loadDocuments,
    loadPage,
    loadSourceChunk,
    selectDocument,
    clearSelectedDocument,
    goToPage,
    goToSourcePage,
  };
}
