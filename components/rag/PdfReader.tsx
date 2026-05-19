"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Minus,
  Plus,
  RefreshCcw,
  Send,
  Upload,
} from "lucide-react";
import { formatRequestReference, readJsonApi } from "@/lib/client/api";

type DocumentStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "indexing"
  | "indexed"
  | "failed";

type RagDocument = {
  id: string;
  fileName: string;
  mimeType?: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
  errorCode: string | null;
  errorStage: string | null;
  errorRequestId: string | null;
  updatedAt: string;
};

type RagSection = {
  id: string;
  title: string;
  headingPath: string[];
  level: number;
  pageStart: number;
  pageEnd: number;
  source: string;
};

type RagPage = {
  pageNumber: number;
  cleanText: string;
  tokenCount: number;
};

type RagChunk = {
  id: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  headingPath: string[];
  tokenCount: number;
  content: string;
  metadata: unknown;
};

type RagCitation = {
  pageStart: number;
  pageEnd: number;
  chunkId: string;
  headingPath: string[];
  quote: string;
};

type RagQueryResponse = {
  answer: string;
  citations: RagCitation[];
  retrievedChunks: Array<{
    chunkId: string;
    score: number;
    pageStart: number;
    pageEnd: number;
    headingPath: string[];
    preview: string;
  }>;
};

type DocumentDetails = {
  document: RagDocument;
  sections: RagSection[];
  chunkCount: number;
};

type PdfViewport = {
  width: number;
  height: number;
};

type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

type PdfPageProxy = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (params: {
    canvas: HTMLCanvasElement;
    viewport: PdfViewport;
  }) => PdfRenderTask;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void> | void;
};

type PdfLoadingTask = {
  promise: Promise<PdfDocumentProxy>;
  destroy?: () => Promise<void> | void;
};

type ReaderActionOptions = {
  actionId?: number;
  loadExtractedText?: boolean;
};

type PdfJsModule = {
  getDocument: (options: {
    url: string;
    withCredentials?: boolean;
  }) => PdfLoadingTask;
  GlobalWorkerOptions: {
    workerSrc: string;
  };
};

const MIN_SCALE = 0.65;
const MAX_SCALE = 2.25;
const SCALE_STEP = 0.15;

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function statusLabel(status: DocumentStatus) {
  const labels: Record<DocumentStatus, string> = {
    uploaded: "Uploaded",
    parsing: "Parsing",
    parsed: "Parsed",
    indexing: "Indexing",
    indexed: "Indexed",
    failed: "Failed",
  };
  return labels[status];
}

function pagesLabel(start: number, end: number) {
  return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
}

function parsePageNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clampPageNumber(pageNumber: number, pageCount: number) {
  if (pageCount <= 0) return pageNumber;
  return Math.min(Math.max(pageNumber, 1), pageCount);
}

function isRenderCancellation(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      /cancelled|canceled/i.test(error.message))
  );
}

function hasExtractedPages(details: DocumentDetails | null) {
  return Boolean(
    details &&
      details.document.pageCount > 0 &&
      (details.sections.length > 0 || details.document.status === "indexed"),
  );
}

async function loadPdfJs() {
  pdfJsModulePromise ??= (async () => {
    const pdfjs = (await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )) as unknown as PdfJsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  })();

  return pdfJsModulePromise;
}

export function PdfReader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const documentParam = searchParams.get("document");
  const pageParam = searchParams.get("page");
  const chunkParam = searchParams.get("chunk");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const readerActionIdRef = useRef(0);
  const pageRequestIdRef = useRef(0);
  const sourceChunkRequestIdRef = useRef(0);
  const pageParamRef = useRef<string | null>(pageParam);
  const chunkParamRef = useRef<string | null>(chunkParam);
  const pageNumberRef = useRef<number | null>(null);
  const sourceChunkIdRef = useRef<string | null>(null);

  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [documentsReady, setDocumentsReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [page, setPage] = useState<RagPage | null>(null);
  const [sourceChunk, setSourceChunk] = useState<RagChunk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);

  const [pdfDocument, setPdfDocument] = useState<PdfDocumentProxy | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [scale, setScale] = useState(1.05);
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<RagQueryResponse | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const selectedDocument = details?.document ?? null;
  const selectedDocumentErrorReference = formatRequestReference(
    selectedDocument?.errorRequestId,
  );
  const pageCount = pdfPageCount || selectedDocument?.pageCount || 0;
  const selectedDocumentTitle =
    selectedDocument?.title || selectedDocument?.fileName || "Select a PDF";
  const busy = uploading || parsing || indexing;
  const indexButtonLabel =
    selectedDocument?.status === "indexed" ? "Re-index PDF" : "Enable Ask PDF";
  const canAskPdf = selectedDocument?.status === "indexed";

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
    [],
  );

  const loadDocuments = useCallback(async () => {
    const data = await readJsonApi<{ documents: RagDocument[] }>("/api/documents");
    setDocuments(data.documents);
    return data.documents;
  }, []);

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
    [isCurrentReaderAction, nextReaderActionId],
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
    [isCurrentReaderAction, nextReaderActionId],
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

        let chunk: RagChunk | null = null;
        const chunkId = options.chunkId?.trim() || null;
        if (chunkId) {
          try {
            chunk = await loadSourceChunk(documentId, chunkId, { actionId });
            if (!isCurrentReaderAction(actionId, documentId)) return;
          } catch (chunkError) {
            if (!isCurrentReaderAction(actionId, documentId)) return;
            setError(
              chunkError instanceof Error
                ? chunkError.message
                : "Source chunk failed to load.",
            );
          }
        }

        const fallbackPage =
          nextDetails.sections[0]?.pageStart ??
          (nextDetails.document.pageCount > 0 ? 1 : null);
        const nextPage = options.pageNumber ?? chunk?.pageStart ?? fallbackPage;
        const clampedPage = nextPage
          ? clampPageNumber(nextPage, nextDetails.document.pageCount)
          : null;

        if (clampedPage) {
          const loadedPage = await loadPage(documentId, clampedPage, {
            actionId,
            loadExtractedText: hasExtractedPages(nextDetails),
          });
          if (!loadedPage || !isCurrentReaderAction(actionId, documentId)) return;
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
          updateReaderUrl(documentId, clampedPage, chunk?.id ?? null);
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
      updateReaderUrl,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    loadDocuments()
      .then(() => {
        if (!cancelled) setDocumentsReady(true);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Load failed.");
          setDocumentsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadDocuments]);

  useEffect(() => {
    pageParamRef.current = pageParam;
    chunkParamRef.current = chunkParam;
  }, [chunkParam, pageParam]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  useEffect(() => {
    sourceChunkIdRef.current = sourceChunk?.id ?? null;
  }, [sourceChunk?.id]);

  useEffect(() => {
    if (!documentsReady) return;

    if (documents.length === 0) {
      nextReaderActionId();
      setSelectedId(null);
      setDetails(null);
      setPage(null);
      setPageNumber(null);
      setPageInput("");
      setSourceChunk(null);
      selectedIdRef.current = null;
      setAskResult(null);
      setAskError(null);
      return;
    }

    const requestedDocument =
      documentParam && documents.some((document) => document.id === documentParam)
        ? documentParam
        : documents[0]?.id;
    if (!requestedDocument) return;
    if (
      selectedIdRef.current === requestedDocument &&
      details?.document.id === requestedDocument
    ) {
      return;
    }

    selectDocument(requestedDocument, {
      pageNumber: parsePageNumber(pageParamRef.current),
      chunkId: chunkParamRef.current,
      updateUrl: requestedDocument !== documentParam,
    }).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Load failed.");
    });
  }, [
    details?.document.id,
    documentParam,
    documents,
    documentsReady,
    nextReaderActionId,
    selectDocument,
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
          if (!chunk || !isCurrentReaderAction(actionId, selectedId)) return null;
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
            setError(loadError instanceof Error ? loadError.message : "Load failed.");
          }
        });
      return;
    }

    let actionId: number | null = null;
    if (sourceChunkIdRef.current) {
      actionId = nextReaderActionId();
      setSourceChunk(null);
    }

    if (clampedPage && pageNumberRef.current !== clampedPage) {
      actionId ??= nextReaderActionId();
      setError(null);
      loadPage(selectedId, clampedPage, {
        actionId,
        loadExtractedText: hasExtractedPages(details),
      }).catch((loadError: unknown) => {
        if (actionId && isCurrentReaderAction(actionId, selectedId)) {
          setError(loadError instanceof Error ? loadError.message : "Page failed to load.");
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
    pageParam,
    selectedId,
  ]);

  useEffect(() => {
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    pdfDocumentRef.current?.destroy();
    pdfDocumentRef.current = null;
    setPdfDocument(null);
    setPdfPageCount(0);
    setPdfError(null);

    if (!selectedId) {
      setPdfLoading(false);
      return undefined;
    }

    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;
    let loadedDocument: PdfDocumentProxy | null = null;
    setPdfLoading(true);

    loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return null;
        loadingTask = pdfjs.getDocument({
          url: `/api/documents/${selectedId}/file`,
          withCredentials: true,
        });
        return loadingTask.promise;
      })
      .then((document) => {
        if (!document) return;
        loadedDocument = document;
        if (cancelled) {
          document.destroy();
          return;
        }
        pdfDocumentRef.current = document;
        setPdfDocument(document);
        setPdfPageCount(document.numPages);
        setPageNumber((currentPageNumber) => currentPageNumber ?? 1);
        setPageInput((currentPageInput) => currentPageInput || "1");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setPdfError(
            loadError instanceof Error ? loadError.message : "PDF failed to load.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
      if (pdfDocumentRef.current === loadedDocument) {
        pdfDocumentRef.current = null;
      }
      loadedDocument?.destroy();
    };
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDocument || !pageNumber) return undefined;

    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    renderTaskRef.current?.cancel();
    setPdfRendering(true);
    setPdfError(null);

    pdfDocument
      .getPage(pageNumber)
      .then((pdfPage) => {
        if (cancelled) return;
        const outputScale = Math.max(window.devicePixelRatio || 1, 1);
        const cssViewport = pdfPage.getViewport({ scale });
        const renderViewport = pdfPage.getViewport({ scale: scale * outputScale });

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        renderTask = pdfPage.render({
          canvas,
          viewport: renderViewport,
        });
        renderTaskRef.current = renderTask;
        return renderTask.promise;
      })
      .catch((renderError: unknown) => {
        if (!cancelled && !isRenderCancellation(renderError)) {
          setPdfError(
            renderError instanceof Error
              ? renderError.message
              : "PDF page failed to render.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPdfRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, scale]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || busy) return;

    const formData = new FormData();
    formData.set("file", file);
    let uploadedId: string | null = null;

    try {
      setError(null);
      setUploading(true);
      const upload = await readJsonApi<{ document: RagDocument }>(
        "/api/documents/upload",
        {
          method: "POST",
          body: formData,
        },
      );
      uploadedId = upload.document.id;
      setUploading(false);
      await loadDocuments();
      await selectDocument(uploadedId, { updateUrl: true });

      setParsing(true);
      await readJsonApi(`/api/documents/${uploadedId}/parse`, { method: "POST" });
      await loadDocuments();
      await selectDocument(uploadedId, { pageNumber: pageNumber ?? 1, updateUrl: true });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
      if (uploadedId) {
        await selectDocument(uploadedId, { pageNumber }).catch(() => undefined);
      }
    } finally {
      setUploading(false);
      setParsing(false);
    }
  }

  async function handleReindex() {
    if (!selectedId || indexing || parsing) return;

    try {
      setError(null);
      setAskError(null);
      setIndexing(true);
      await readJsonApi(`/api/documents/${selectedId}/index`, { method: "POST" });
      await loadDocuments();
      await selectDocument(selectedId, {
        pageNumber: pageNumber ?? page?.pageNumber,
        chunkId: sourceChunk?.id ?? null,
      });
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : "Index failed.");
      await selectDocument(selectedId, { pageNumber }).catch(() => undefined);
    } finally {
      setIndexing(false);
    }
  }

  async function goToPage(nextPage: number) {
    if (!selectedId || !pageCount) return;
    const clampedPage = clampPageNumber(nextPage, pageCount);
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
        setError(pageError instanceof Error ? pageError.message : "Page failed to load.");
      }
    }
  }

  async function goToSourcePage(nextPage: number, chunkId: string | null = null) {
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
        setError(pageError instanceof Error ? pageError.message : "Page failed to load.");
      }
    }
  }

  async function handleAskPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = askQuestion.trim();
    if (!selectedId || !selectedDocument || selectedDocument.status !== "indexed") return;
    if (!question || askLoading) return;

    try {
      setAskError(null);
      setAskLoading(true);
      const result = await readJsonApi<RagQueryResponse>(
        `/api/documents/${selectedId}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
      );
      setAskResult(result);
    } catch (askRequestError) {
      setAskError(
        askRequestError instanceof Error
          ? askRequestError.message
          : "Ask PDF failed.",
      );
    } finally {
      setAskLoading(false);
    }
  }

  function handlePageInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const nextPage = parsePageNumber(pageInput);
    if (nextPage) goToPage(nextPage).catch(() => undefined);
  }

  const sortedSections = useMemo(
    () =>
      [...(details?.sections ?? [])].sort(
        (left, right) => left.pageStart - right.pageStart || left.level - right.level,
      ),
    [details],
  );

  const activeSectionId = useMemo(() => {
    if (!pageNumber) return null;
    const activeSections = sortedSections.filter(
      (section) => pageNumber >= section.pageStart && pageNumber <= section.pageEnd,
    );
    return activeSections.sort((left, right) => right.level - left.level)[0]?.id ?? null;
  }, [pageNumber, sortedSections]);

  const askDisabled =
    !selectedDocument ||
    !canAskPdf ||
    !askQuestion.trim() ||
    askLoading;

  return (
    <section
      data-testid="pdf-reader"
      className="grid min-h-[calc(100vh-92px)] w-full min-w-0 overflow-hidden rounded-lg border border-[#e2ddea] bg-white shadow-[0_18px_50px_rgba(55,47,68,0.12)] lg:grid-cols-[280px_minmax(0,1fr)_260px]"
    >
      <aside className="min-w-0 border-b border-[#e7e2ee] bg-[#fcfbfe] p-4 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-[#211a2e]">Documents</h2>
        </div>

        <form onSubmit={handleUpload} className="space-y-3">
          <label
            htmlFor="pdf-upload"
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#a885dc] bg-white px-4 text-center text-xs font-extrabold text-[#5d4186] transition hover:bg-[#fbf8ff]"
          >
            <Upload size={18} />
            <span>Upload PDF</span>
            <span className="text-[11px] font-bold text-[#71677d]">or drag and drop</span>
            <input
              ref={fileInputRef}
              id="pdf-upload"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#7e61bd] px-3 text-xs font-black text-white shadow-sm transition hover:bg-[#6f53ae] disabled:cursor-not-allowed disabled:opacity-65"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Upload size={15} />
            )}
            {uploading ? "Uploading" : parsing ? "Parsing" : indexing ? "Indexing" : "Upload PDF"}
          </button>
        </form>

        <div className="mt-5 space-y-2">
          {documents.map((document) => {
            const isSelected = selectedId === document.id;
            return (
              <button
                key={document.id}
                type="button"
                onClick={() =>
                  selectDocument(document.id, { updateUrl: true }).catch(
                    (loadError: unknown) => {
                      setError(
                        loadError instanceof Error
                          ? loadError.message
                          : "Load failed.",
                      );
                    },
                  )
                }
                className={`group w-full min-w-0 rounded-md border px-3 py-3 text-left transition ${
                  isSelected
                    ? "border-[#d8f0e4] bg-[#effaf4]"
                    : "border-transparent bg-transparent hover:bg-white"
                }`}
              >
                <span className="flex items-start gap-2">
                  <FileText
                    size={16}
                    className={`mt-0.5 shrink-0 ${isSelected ? "text-[#338962]" : "text-[#8a8293]"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black text-[#272131]">
                      {document.title || document.fileName}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-[#7a7183]">
                      {document.pageCount || "-"} pages
                    </span>
                  </span>
                  {isSelected && (
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#30a66d]" />
                  )}
                </span>
              </button>
            );
          })}
          {documents.length === 0 && (
            <p className="rounded-md bg-white px-3 py-4 text-sm font-bold text-[#76667f]">
              No PDFs yet.
            </p>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-col bg-white">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-[#ebe6f2] px-4 py-3">
          <div className="min-w-[180px] flex-1">
            <h2 className="truncate text-sm font-black text-[#211a2e]">
              {selectedDocumentTitle}
            </h2>
            <p className="mt-1 truncate text-[11px] font-bold text-[#786f82]">
              {selectedDocument ? statusLabel(selectedDocument.status) : "No PDF selected"}
              {pageCount ? ` - ${pageCount} pages` : ""}
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="inline-flex h-9 items-center rounded-md border border-[#e8e3ee] bg-[#fbfafc]">
              <button
                type="button"
                disabled={!selectedDocument || !pageNumber || pageNumber <= 1}
                onClick={() =>
                  pageNumber ? goToPage(pageNumber - 1).catch(() => undefined) : undefined
                }
                className="grid h-9 w-9 place-items-center text-[#52475f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <input
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={() => {
                  const nextPage = parsePageNumber(pageInput);
                  if (nextPage) goToPage(nextPage).catch(() => undefined);
                  else setPageInput(pageNumber ? String(pageNumber) : "");
                }}
                onKeyDown={handlePageInputKeyDown}
                disabled={!selectedDocument || !pageCount}
                aria-label="Page number"
                className="h-7 w-10 rounded-md border border-transparent bg-white text-center text-xs font-black text-[#292334] outline-none focus:border-[#9b7bd2] focus:ring-2 focus:ring-[#e4d9f5]"
              />
              <span className="px-1 text-xs font-black text-[#786f82]">
                / {pageCount || "-"}
              </span>
              <button
                type="button"
                disabled={!selectedDocument || !pageNumber || pageNumber >= pageCount}
                onClick={() =>
                  pageNumber ? goToPage(pageNumber + 1).catch(() => undefined) : undefined
                }
                className="grid h-9 w-9 place-items-center text-[#52475f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="inline-flex h-9 items-center rounded-md border border-[#e8e3ee] bg-[#fbfafc]">
              <button
                type="button"
                disabled={scale <= MIN_SCALE}
                onClick={() =>
                  setScale((value) =>
                    Number(Math.max(MIN_SCALE, value - SCALE_STEP).toFixed(2)),
                  )
                }
                className="grid h-9 w-9 place-items-center text-[#52475f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Zoom out"
              >
                <Minus size={15} />
              </button>
              <span className="w-11 text-center text-xs font-black text-[#52475f]">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                disabled={scale >= MAX_SCALE}
                onClick={() =>
                  setScale((value) =>
                    Number(Math.min(MAX_SCALE, value + SCALE_STEP).toFixed(2)),
                  )
                }
                className="grid h-9 w-9 place-items-center text-[#52475f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Zoom in"
              >
                <Plus size={15} />
              </button>
            </div>

            {selectedDocument && selectedId ? (
              <a
                href={`/api/documents/${selectedId}/file`}
                download={selectedDocument.fileName}
                className="grid h-9 w-9 place-items-center rounded-md border border-[#e8e3ee] bg-white text-[#52475f] transition hover:bg-[#fbfafc] focus:outline-none focus:ring-2 focus:ring-[#d9caef]"
                aria-label="Download PDF"
              >
                <Download size={15} />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="grid h-9 w-9 place-items-center rounded-md border border-[#e8e3ee] bg-white text-[#52475f] opacity-40"
                aria-label="Download PDF"
              >
                <Download size={15} />
              </button>
            )}

            {selectedDocument && (
              <button
                type="button"
                onClick={handleReindex}
                disabled={indexing || parsing}
                className="grid h-9 w-9 place-items-center rounded-md border border-[#e8e3ee] bg-white text-[#45805d] transition hover:bg-[#f1fbf6] disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={indexButtonLabel}
                title={indexButtonLabel}
              >
                {indexing ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCcw size={15} />
                )}
              </button>
            )}
          </div>
        </div>

        {selectedDocument?.status === "failed" && selectedDocument.errorMessage && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-md bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p>{selectedDocument.errorMessage}</p>
              {selectedDocumentErrorReference && (
                <p className="mt-1 font-mono text-xs text-[#9c5752]">
                  {selectedDocumentErrorReference}
                </p>
              )}
            </div>
          </div>
        )}

        <div
          data-testid="pdf-viewer"
          className="relative flex-1 overflow-auto bg-[#f5f3f7] px-4 py-5"
        >
          {!selectedDocument && (
            <div className="grid min-h-[520px] place-items-center rounded-md border border-dashed border-[#cec3d9] bg-white/70 text-sm font-bold text-[#76667f]">
              Select a PDF
            </div>
          )}

          {selectedDocument && (
            <div className="flex min-w-max justify-center">
              <canvas
                ref={canvasRef}
                data-testid="pdf-page-canvas"
                className={`bg-white shadow-xl shadow-[#c9c0d3]/35 ${
                  pdfLoading || pdfError ? "invisible" : "visible"
                }`}
              />
            </div>
          )}

          {(pdfLoading || pdfRendering) && selectedDocument && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#f5f3f7]/70">
              <p className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-black text-[#554665] shadow-sm">
                <Loader2 size={16} className="animate-spin" />
                {pdfLoading ? "Loading PDF" : "Rendering page"}
              </p>
            </div>
          )}

          {pdfError && selectedDocument && (
            <div className="absolute inset-4 grid place-items-center rounded-md border border-[#f3c6c2] bg-[#ffeceb] p-5 text-center text-sm font-bold text-[#8f3f3a]">
              <span className="inline-flex items-start gap-2">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                {pdfError}
              </span>
            </div>
          )}
        </div>
      </main>

      <aside className="flex min-w-0 flex-col border-t border-[#e7e2ee] bg-[#fcfbfe] lg:border-l lg:border-t-0">
        <div className="min-h-0 border-b border-[#e7e2ee] p-4 lg:flex-[0_1_48%]">
          <h2 className="text-xs font-black text-[#211a2e]">TOC (Extracted)</h2>
          <div className="mt-3 max-h-72 space-y-1 overflow-auto pr-1 lg:max-h-full">
            {sortedSections.map((section) => {
              const isActive = activeSectionId === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  data-testid="toc-section-button"
                  aria-current={isActive ? "location" : undefined}
                  onClick={() => goToPage(section.pageStart).catch(() => undefined)}
                  className={`w-full min-w-0 rounded-md py-2 pr-2 text-left text-xs font-bold leading-5 transition ${
                    isActive
                      ? "bg-[#e9f7f0] text-[#285d45]"
                      : "text-[#4f4659] hover:bg-white"
                  }`}
                  style={{ paddingLeft: `${Math.min(section.level, 4) * 10 + 8}px` }}
                >
                  <span className="block truncate">{section.title}</span>
                  <span className="text-[10px] font-black text-[#82758b]">
                    {pagesLabel(section.pageStart, section.pageEnd)}
                  </span>
                </button>
              );
            })}
            {sortedSections.length === 0 && (
              <p className="rounded-md bg-white px-3 py-4 text-sm font-bold text-[#76667f]">
                No sections detected yet.
              </p>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-black text-[#211a2e]">Ask PDF</h2>
            {sourceLoading && (
              <Loader2 size={14} className="shrink-0 animate-spin text-[#76667f]" />
            )}
          </div>

          {selectedDocument && !canAskPdf && (
            <button
              type="button"
              onClick={handleReindex}
              disabled={indexing || parsing}
              data-testid="enable-ask-pdf-button"
              className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-[#d8f0e4] bg-[#effaf4] px-3 text-xs font-black text-[#2f7654] transition hover:bg-[#e4f6ed] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {indexing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )}
              Enable Ask PDF
            </button>
          )}

          <form
            onSubmit={handleAskPdf}
            data-testid="ask-pdf-form"
            className="mt-3 space-y-2"
          >
            <textarea
              value={askQuestion}
              onChange={(event) => setAskQuestion(event.target.value)}
              disabled={!selectedDocument || !canAskPdf || askLoading}
              data-testid="ask-pdf-input"
              placeholder="Ask anything about this PDF..."
              rows={3}
              className="min-h-20 w-full resize-none rounded-md border border-[#e5dfec] bg-white p-3 text-xs font-bold leading-5 text-[#292334] outline-none placeholder:text-[#a29aaa] focus:border-[#9b7bd2] focus:ring-2 focus:ring-[#e4d9f5] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={askDisabled}
              data-testid="ask-pdf-button"
              className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-[#8c6fca] px-3 text-xs font-black text-white shadow-sm transition hover:bg-[#7a5ebb] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {askLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Ask
            </button>
          </form>

          {(error || askError) && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-[#ffeceb] px-3 py-3 text-xs font-bold leading-5 text-[#8f3f3a]">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {askError || error}
            </p>
          )}

          <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
            {askResult && (
              <div data-testid="ask-pdf-answer" className="space-y-3">
                <p className="whitespace-pre-wrap rounded-md bg-white p-3 text-xs font-bold leading-6 text-[#342d3d]">
                  {askResult.answer}
                </p>
                {askResult.citations.length > 0 && (
                  <div className="space-y-2">
                    {askResult.citations.map((citation) => (
                      <button
                        key={`${citation.chunkId}-${citation.pageStart}`}
                        type="button"
                        data-testid="ask-pdf-citation"
                        onClick={() =>
                          goToSourcePage(citation.pageStart, citation.chunkId).catch(
                            () => undefined,
                          )
                        }
                        className="w-full rounded-md border border-[#e7e1ee] bg-white px-3 py-2 text-left transition hover:border-[#cdbce9] hover:bg-[#fbf8ff]"
                      >
                        <span className="block text-[11px] font-black text-[#5d4186]">
                          {pagesLabel(citation.pageStart, citation.pageEnd)}
                        </span>
                        {citation.headingPath.length > 0 && (
                          <span className="mt-1 block truncate text-[11px] font-bold text-[#72687c]">
                            {citation.headingPath.join(" / ")}
                          </span>
                        )}
                        <span className="mt-1 block line-clamp-3 text-xs font-bold leading-5 text-[#3d3547]">
                          {citation.quote}
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
                className="mt-3 rounded-md border border-[#dbeee4] bg-[#f3fbf7] p-3"
              >
                <p className="text-[11px] font-black text-[#2e6f50]">
                  {pagesLabel(sourceChunk.pageStart, sourceChunk.pageEnd)}
                </p>
                {sourceChunk.headingPath.length > 0 && (
                  <p className="mt-1 truncate text-[11px] font-bold text-[#4f775f]">
                    {sourceChunk.headingPath.join(" / ")}
                  </p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-xs font-bold leading-6 text-[#314338]">
                  {sourceChunk.content}
                </p>
              </div>
            )}

            {!askResult && !sourceChunk && !sourceLoading && (
              <p className="rounded-md bg-white px-3 py-4 text-xs font-bold leading-5 text-[#76667f]">
                {selectedDocument?.status === "indexed"
                  ? "Ready"
                  : selectedDocument
                    ? parsing
                      ? "Extracting text and outline for reading."
                      : indexing
                        ? "Enabling Ask PDF."
                        : "Enable Ask PDF before asking."
                    : "Select a PDF"}
              </p>
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}
