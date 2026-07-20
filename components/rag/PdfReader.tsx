"use client";

import {
  type CSSProperties,
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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  getResizeInputMode,
  type ResizeStartEvent,
  WorkspaceResizeHandle,
} from "@/components/workspace/WorkspaceResizeHandle";
import { useLanguage } from "@/components/language/LanguageProvider";
import { formatRequestReference, readJsonApi } from "@/lib/client/api";

type DocumentStatus =
  | "queued"
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

type TocNode = {
  section: RagSection;
  children: TocNode[];
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

type LocalPdfPreview = {
  fileName: string;
  url: string;
};

type PdfJsModule = {
  getDocument: (options: {
    url: string;
    disableAutoFetch?: boolean;
    disableStream?: boolean;
    rangeChunkSize?: number;
    withCredentials?: boolean;
  }) => PdfLoadingTask;
  GlobalWorkerOptions: {
    workerSrc: string;
  };
};

const MIN_SCALE = 0.65;
const MAX_SCALE = 2.25;
const SCALE_STEP = 0.15;
const PDF_RANGE_CHUNK_SIZE = 256 * 1024;
const PDF_PROCESSING_POLL_INTERVAL_MS = 2_500;
const PDF_DOCUMENTS_SIDEBAR_DEFAULT_WIDTH = 280;
const PDF_TOOLS_SIDEBAR_DEFAULT_WIDTH = 260;
const PDF_SIDEBAR_MIN_WIDTH = 210;
const PDF_VIEWER_MIN_WIDTH = 360;
const PDF_RESIZE_HANDLE_WIDTH = 8;
const PDF_MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

type PdfSidebarSide = "documents" | "tools";

type PdfSidebarResizeBoundsOptions = {
  side: PdfSidebarSide;
  gridWidth: number;
  documentsSidebarWidth: number;
  toolsSidebarWidth: number;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function statusLabel(status: DocumentStatus, language: "zh" | "en") {
  const labels: Record<"zh" | "en", Record<DocumentStatus, string>> = {
    zh: {
      queued: "等待处理",
      uploaded: "已上传",
      parsing: "解析中",
      parsed: "已解析",
      indexing: "索引中",
      indexed: "已完成",
      failed: "处理失败",
    },
    en: {
      queued: "Queued",
      uploaded: "Uploaded",
      parsing: "Parsing",
      parsed: "Parsed",
      indexing: "Indexing",
      indexed: "Ready",
      failed: "Failed",
    },
  };
  return labels[language][status];
}

function documentStatusDotClass(status: DocumentStatus) {
  if (status === "failed") return "bg-danger-500";
  if (status === "indexed") return "bg-success-500";
  return "bg-brand-400";
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPdfSidebarResizeBounds({
  side,
  gridWidth,
  documentsSidebarWidth,
  toolsSidebarWidth,
}: PdfSidebarResizeBoundsOptions) {
  const otherSidebarWidth =
    side === "documents" ? toolsSidebarWidth : documentsSidebarWidth;
  const maxWidthForViewport =
    gridWidth - otherSidebarWidth - PDF_RESIZE_HANDLE_WIDTH * 2 - PDF_VIEWER_MIN_WIDTH;

  return {
    minWidth: PDF_SIDEBAR_MIN_WIDTH,
    maxWidth: Math.max(PDF_SIDEBAR_MIN_WIDTH, Math.floor(maxWidthForViewport)),
  };
}

function isRenderCancellation(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      /cancelled|canceled/i.test(error.message))
  );
}

function getPdfViewerContentWidth(viewer: HTMLElement) {
  const style = window.getComputedStyle(viewer);
  const paddingX =
    Number.parseFloat(style.paddingLeft || "0") +
    Number.parseFloat(style.paddingRight || "0");
  return Math.max(0, Math.floor(viewer.clientWidth - paddingX));
}

function getMobileFitWidthScale(pageWidth: number, viewerWidth: number) {
  if (pageWidth <= 0 || viewerWidth <= 0) return null;
  const fitScale = Math.max(viewerWidth - 2, 0) / pageWidth;
  const autoFitMinScale = Math.min(MIN_SCALE, fitScale);
  const clampedScale = clampNumber(fitScale, autoFitMinScale, MAX_SCALE);
  return Math.floor(clampedScale * 100) / 100;
}

function hasExtractedPages(details: DocumentDetails | null) {
  return Boolean(
      details &&
      details.document.pageCount > 0 &&
      (details.document.status === "parsed" ||
        details.document.status === "indexing" ||
        details.document.status === "indexed"),
  );
}

function isDocumentProcessing(status: DocumentStatus | undefined) {
  return status === "queued" || status === "parsing" || status === "indexing";
}

function sortSectionsForToc(sections: RagSection[]) {
  return sections
    .map((section, index) => ({ index, section }))
    .sort(
      (left, right) =>
        left.section.pageStart - right.section.pageStart ||
        left.section.level - right.section.level ||
        left.index - right.index,
    )
    .map(({ section }) => section);
}

function buildTocTree(sections: RagSection[]) {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const section of sections) {
    const node: TocNode = { section, children: [] };

    while (
      stack.length > 0 &&
      stack[stack.length - 1].section.level >= section.level
    ) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push(node);
  }

  return roots;
}

function tocNodeContainsSection(node: TocNode, sectionId: string): boolean {
  return (
    node.section.id === sectionId ||
    node.children.some((child) => tocNodeContainsSection(child, sectionId))
  );
}

function findTocRootId(tocTree: TocNode[], sectionId: string | null) {
  if (!sectionId) return null;
  return tocTree.find((node) => tocNodeContainsSection(node, sectionId))?.section.id ?? null;
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
  const { copy, language } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const documentParam = searchParams.get("document");
  const pageParam = searchParams.get("page");
  const chunkParam = searchParams.get("chunk");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const readerGridRef = useRef<HTMLElement | null>(null);
  const pdfViewerRef = useRef<HTMLDivElement | null>(null);
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
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [, setPage] = useState<RagPage | null>(null);
  const [sourceChunk, setSourceChunk] = useState<RagChunk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [localPreview, setLocalPreview] = useState<LocalPdfPreview | null>(null);

  const [pdfDocument, setPdfDocument] = useState<PdfDocumentProxy | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [scale, setScale] = useState(1.05);
  const [pdfViewerWidth, setPdfViewerWidth] = useState(0);
  const [hasManualScale, setHasManualScale] = useState(false);
  const [documentsSidebarWidth, setDocumentsSidebarWidth] = useState(
    PDF_DOCUMENTS_SIDEBAR_DEFAULT_WIDTH,
  );
  const [toolsSidebarWidth, setToolsSidebarWidth] = useState(
    PDF_TOOLS_SIDEBAR_DEFAULT_WIDTH,
  );
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<RagQueryResponse | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [expandedTocRootIds, setExpandedTocRootIds] = useState<Set<string>>(
    () => new Set(),
  );

  const selectedDocument = details?.document ?? null;
  const selectedDocumentErrorReference = formatRequestReference(
    selectedDocument?.errorRequestId,
  );
  const hasActivePdf = Boolean(localPreview || selectedDocument);
  const pdfSourceUrl = localPreview?.url ?? (selectedId ? `/api/documents/${selectedId}/file` : null);
  const isSavedPdfSource = Boolean(!localPreview && selectedId);
  const pageCount = pdfPageCount || selectedDocument?.pageCount || 0;
  const selectedDocumentTitle =
    localPreview?.fileName ||
    selectedDocument?.title ||
    selectedDocument?.fileName ||
    "Select a PDF";
  const busy = uploading || indexing;
  const canAskPdf = selectedDocument?.status === "indexed";
  const askDisabled =
    !selectedDocument || !canAskPdf || askLoading || !askQuestion.trim();
  const pdfReaderGridStyle = {
    "--pdf-reader-grid-columns": `${toolsSidebarWidth}px ${PDF_RESIZE_HANDLE_WIDTH}px minmax(${PDF_VIEWER_MIN_WIDTH}px,1fr) ${PDF_RESIZE_HANDLE_WIDTH}px ${documentsSidebarWidth}px`,
  } as CSSProperties;

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

  const getReaderGridWidth = useCallback(() => {
    return readerGridRef.current?.clientWidth ?? 0;
  }, []);

  const clampPdfSidebars = useCallback(
    (gridWidth = getReaderGridWidth()) => {
      if (!gridWidth || window.matchMedia(PDF_MOBILE_MEDIA_QUERY).matches) return;

      let nextDocumentsSidebarWidth = documentsSidebarWidth;
      let nextToolsSidebarWidth = toolsSidebarWidth;

      const documentsBounds = getPdfSidebarResizeBounds({
        side: "documents",
        gridWidth,
        documentsSidebarWidth: nextDocumentsSidebarWidth,
        toolsSidebarWidth: nextToolsSidebarWidth,
      });
      nextDocumentsSidebarWidth = clampNumber(
        nextDocumentsSidebarWidth,
        documentsBounds.minWidth,
        documentsBounds.maxWidth,
      );

      const toolsBounds = getPdfSidebarResizeBounds({
        side: "tools",
        gridWidth,
        documentsSidebarWidth: nextDocumentsSidebarWidth,
        toolsSidebarWidth: nextToolsSidebarWidth,
      });
      nextToolsSidebarWidth = clampNumber(
        nextToolsSidebarWidth,
        toolsBounds.minWidth,
        toolsBounds.maxWidth,
      );

      if (nextDocumentsSidebarWidth !== documentsSidebarWidth) {
        setDocumentsSidebarWidth(nextDocumentsSidebarWidth);
      }
      if (nextToolsSidebarWidth !== toolsSidebarWidth) {
        setToolsSidebarWidth(nextToolsSidebarWidth);
      }
    },
    [documentsSidebarWidth, getReaderGridWidth, toolsSidebarWidth],
  );

  const handlePdfSidebarResizeStart = useCallback(
    (side: PdfSidebarSide, event: ResizeStartEvent) => {
      event.preventDefault();
      const isPointerResize = getResizeInputMode(event) === "pointer";

      const startX = event.clientX;
      const startWidth =
        side === "documents" ? documentsSidebarWidth : toolsSidebarWidth;
      const gridWidth =
        event.currentTarget.parentElement?.parentElement?.clientWidth ??
        getReaderGridWidth();
      const bounds = getPdfSidebarResizeBounds({
        side,
        gridWidth,
        documentsSidebarWidth,
        toolsSidebarWidth,
      });

      function resizeTo(clientX: number) {
        const deltaX = side === "tools" ? clientX - startX : startX - clientX;
        const nextWidth = clampNumber(
          startWidth + deltaX,
          bounds.minWidth,
          bounds.maxWidth,
        );

        if (side === "documents") setDocumentsSidebarWidth(nextWidth);
        else setToolsSidebarWidth(nextWidth);
      }

      function handlePointerMove(moveEvent: globalThis.PointerEvent) {
        resizeTo(moveEvent.clientX);
      }

      function handleMouseMove(moveEvent: globalThis.MouseEvent) {
        resizeTo(moveEvent.clientX);
      }

      function handlePointerUp() {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      }

      function handleMouseUp() {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      }

      if (isPointerResize) {
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp, { once: true });
      } else {
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp, { once: true });
      }
    },
    [documentsSidebarWidth, getReaderGridWidth, toolsSidebarWidth],
  );

  const handleDocumentsSidebarResizeStart = useCallback(
    (event: ResizeStartEvent) => handlePdfSidebarResizeStart("documents", event),
    [handlePdfSidebarResizeStart],
  );

  const handleToolsSidebarResizeStart = useCallback(
    (event: ResizeStartEvent) => handlePdfSidebarResizeStart("tools", event),
    [handlePdfSidebarResizeStart],
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
          sourceChunkForPage = await loadSourceChunk(documentId, options.chunkId, {
            actionId,
          });
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
    if (!renamingDocumentId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingDocumentId]);

  useEffect(() => {
    const grid = readerGridRef.current;
    if (!grid) return undefined;

    let animationFrame = 0;
    const scheduleClamp = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        clampPdfSidebars(grid.clientWidth);
      });
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleClamp);

    scheduleClamp();
    observer?.observe(grid);
    window.addEventListener("resize", scheduleClamp);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleClamp);
    };
  }, [clampPdfSidebars]);

  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer) return undefined;

    let animationFrame = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const nextWidth = getPdfViewerContentWidth(viewer);
        setPdfViewerWidth((currentWidth) =>
          currentWidth === nextWidth ? currentWidth : nextWidth,
        );
      });
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);

    scheduleMeasure();
    observer?.observe(viewer);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, []);

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
      documentParam && documents.some((document) => document.id === documentParam)
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
      setError(loadError instanceof Error ? loadError.message : "Load failed.");
    });
  }, [
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
    setHasManualScale(false);

    if (!pdfSourceUrl) {
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
          url: pdfSourceUrl,
          ...(isSavedPdfSource
            ? {
                rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
              }
            : {}),
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
  }, [isSavedPdfSource, pdfSourceUrl]);

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
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const shouldFitMobileWidth =
          !hasManualScale &&
          pdfViewerWidth > 0 &&
          window.matchMedia(PDF_MOBILE_MEDIA_QUERY).matches;
        const fitWidthScale = shouldFitMobileWidth
          ? getMobileFitWidthScale(baseViewport.width, pdfViewerWidth)
          : null;

        if (fitWidthScale && Math.abs(fitWidthScale - scale) > 0.01) {
          setScale(fitWidthScale);
          return;
        }

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
  }, [hasManualScale, pageNumber, pdfDocument, pdfViewerWidth, scale]);

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
              pollError instanceof Error
                ? pollError.message
                : "PDF status failed to refresh.",
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
    selectedDocument,
    selectedDocument?.status,
    selectedId,
    selectDocument,
  ]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || busy) return;

    const previewUrl = URL.createObjectURL(file);
    const formData = new FormData();
    formData.set("file", file);
    let uploadedId: string | null = null;

    try {
      nextReaderActionId();
      selectedIdRef.current = null;
      setSelectedId(null);
      setDetails(null);
      setPage(null);
      setSourceChunk(null);
      setPageNumber(1);
      setPageInput("1");
      setAskResult(null);
      setAskError(null);
      setLocalPreview({ fileName: file.name, url: previewUrl });
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
      setLocalPreview(null);
      await selectDocument(uploadedId, { updateUrl: true });
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
    }
  }

  function clearSelectedDocument() {
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
  }

  function startRenameDocument(document: RagDocument) {
    if (busy || renameSaving || deletingDocumentId) return;
    setError(null);
    setRenamingDocumentId(document.id);
    setRenameValue(document.title || document.fileName);
  }

  function cancelRenameDocument() {
    setRenamingDocumentId(null);
    setRenameValue("");
  }

  async function handleRenameDocument(
    event: FormEvent<HTMLFormElement>,
    document: RagDocument,
  ) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || renameSaving) return;

    try {
      setError(null);
      setRenameSaving(true);
      const data = await readJsonApi<{ document: RagDocument }>(
        `/api/documents/${document.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      await loadDocuments();
      if (selectedIdRef.current === document.id) {
        setDetails((current) =>
          current && current.document.id === document.id
            ? { ...current, document: data.document }
            : current,
        );
      }
      setRenamingDocumentId(null);
      setRenameValue("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Rename failed.");
    } finally {
      setRenameSaving(false);
    }
  }

  async function handleDeleteDocument(document: RagDocument) {
    if (busy || deletingDocumentId) return;
    const label = document.title || document.fileName;
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;

    try {
      setError(null);
      setDeletingDocumentId(document.id);
      const data = await readJsonApi<{ documents: RagDocument[] }>(
        `/api/documents/${document.id}`,
        { method: "DELETE" },
      );
      setDocuments(data.documents);
      setRenamingDocumentId(null);
      setRenameValue("");

      if (selectedIdRef.current === document.id) {
        const nextDocument = data.documents[0] ?? null;
        if (nextDocument) {
          await selectDocument(nextDocument.id, { updateUrl: true });
        } else {
          clearSelectedDocument();
        }
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleReindex() {
    if (!selectedId || indexing) return;

    try {
      setError(null);
      setAskError(null);
      setIndexing(true);
      await readJsonApi(`/api/documents/${selectedId}/index`, { method: "POST" });
      await loadDocuments();
      await selectDocument(selectedId, {
        pageNumber: pageNumberRef.current,
        chunkId: sourceChunkIdRef.current,
      });
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : "Index failed.");
      await selectDocument(selectedId, { pageNumber }).catch(() => undefined);
    } finally {
      setIndexing(false);
    }
  }

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

  const toggleTocRoot = useCallback((sectionId: string) => {
    setExpandedTocRootIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const sortedSections = useMemo(
    () => sortSectionsForToc(details?.sections ?? []),
    [details?.sections],
  );
  const tocTree = useMemo(() => buildTocTree(sortedSections), [sortedSections]);

  const activeSectionId = useMemo(() => {
    if (!pageNumber) return null;
    const activeSections = sortedSections.filter(
      (section) => pageNumber >= section.pageStart && pageNumber <= section.pageEnd,
    );
    return activeSections.sort((left, right) => right.level - left.level)[0]?.id ?? null;
  }, [pageNumber, sortedSections]);

  const activeChapterId = useMemo(
    () => findTocRootId(tocTree, activeSectionId),
    [activeSectionId, tocTree],
  );
  const tocRootIdsKey = useMemo(
    () => tocTree.map((node) => node.section.id).join("|"),
    [tocTree],
  );
  const defaultExpandedTocRootId = activeChapterId ?? tocTree[0]?.section.id ?? null;

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
          onClick={() => goToPage(section.pageStart).catch(() => undefined)}
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
    <section
      ref={readerGridRef}
      data-testid="pdf-reader"
      style={pdfReaderGridStyle}
      className="grid min-h-0 w-full min-w-0 overflow-visible rounded-xl border border-neutral-200 bg-white shadow-xl shadow-[rgba(44,35,62,0.08)] lg:h-[calc(100svh-92px)] lg:min-h-[calc(100svh-92px)] lg:grid-cols-[var(--pdf-reader-grid-columns)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:overflow-hidden"
    >
      <aside
        data-testid="pdf-documents-sidebar"
        className="order-2 min-w-0 border-t border-neutral-200 bg-neutral-50 p-3 sm:p-4 lg:order-5 lg:max-h-[calc(100svh-92px)] lg:overflow-hidden lg:border-b-0 lg:border-l lg:border-t-0"
      >
        <div className="mb-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-neutral-800">
            {copy.reader.documents}
          </h2>
        </div>

        <form onSubmit={handleUpload} className="space-y-3">
          <label
            htmlFor="pdf-upload"
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-white px-4 text-center text-xs font-extrabold text-neutral-600 transition hover:border-brand-300 hover:bg-brand-50"
          >
            <Upload size={20} className="text-neutral-400" />
            <span>{copy.reader.uploadPdf}</span>
            <span className="text-[11px] font-bold text-neutral-500">
              {language === "zh" ? "或拖拽到这里" : "or drag and drop"}
            </span>
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
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-black text-white shadow-md shadow-brand-200/50 transition hover:bg-brand-700 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-65"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Upload size={15} />
            )}
            {uploading ? copy.reader.uploading : copy.reader.uploadPdf}
          </button>
        </form>

        <div className="mt-5 max-h-64 space-y-2 overflow-auto pr-1 sm:max-h-80 lg:max-h-[calc(100svh-370px)]">
          {documents.map((document) => {
            const isSelected = selectedId === document.id;
            const isRenaming = renamingDocumentId === document.id;
            return (
              <div
                key={document.id}
                data-testid="pdf-document-row"
                data-document-id={document.id}
                className={`group w-full min-w-0 rounded-lg border px-3 py-3 text-left transition ${
                  isSelected
                    ? "border-success-200 bg-success-50 shadow-sm"
                    : "border-transparent bg-transparent hover:bg-white hover:shadow-sm"
                }`}
              >
                {isRenaming ? (
                  <form
                    onSubmit={(event) =>
                      handleRenameDocument(event, document).catch(() => undefined)
                    }
                    className="flex min-w-0 items-start gap-2"
                  >
                    <FileText
                      size={16}
                      className="mt-2 shrink-0 text-success-600"
                    />
                    <span className="min-w-0 flex-1">
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        disabled={renameSaving}
                        aria-label={copy.reader.title}
                        className="h-8 w-full rounded-md border border-brand-300 bg-white px-2 text-xs font-black text-text-primary outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <span className="mt-1 block text-[11px] font-bold text-text-muted">
                        {language === "zh" ? `${document.pageCount || "-"} 页` : `${document.pageCount || "-"} pages`}
                      </span>
                    </span>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1">
                      <button
                        type="submit"
                        disabled={!renameValue.trim() || renameSaving}
                        aria-label={copy.reader.savePdfName}
                        className="grid h-7 w-7 place-items-center rounded-md bg-success-500 text-white transition hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {renameSaving ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelRenameDocument}
                        disabled={renameSaving}
                        aria-label={copy.common.cancel}
                        className="grid h-7 w-7 place-items-center rounded-md border border-border-default bg-white text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  </form>
                ) : (
                  <div className="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        selectDocument(document.id, { updateUrl: true }).catch(
                          (loadError: unknown) => {
                            setError(
                              loadError instanceof Error
                                ? loadError.message
                                : copy.settings.failedUpdate,
                            );
                          },
                        )
                      }
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      <FileText
                        size={16}
                        className={`mt-0.5 shrink-0 ${isSelected ? "text-success-600" : "text-neutral-500"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-black text-neutral-900">
                          {document.title || document.fileName}
                        </span>
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-neutral-600">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${documentStatusDotClass(document.status)}`}
                          />
                          <span className={document.status === "failed" ? "text-danger-600" : undefined}>
                            {statusLabel(document.status, language)}
                            {document.pageCount > 0
                              ? language === "zh"
                                ? ` · ${document.pageCount} 页`
                                : ` · ${document.pageCount} pages`
                              : ""}
                          </span>
                        </span>
                      </span>
                      {isSelected && (
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success-500" />
                      )}
                    </button>
                    <span
                      role="group"
                      aria-label={`${document.title || document.fileName} actions`}
                      className={`mt-0.5 flex shrink-0 items-center gap-1 opacity-100 transition ${
                        isSelected
                          ? "sm:opacity-100"
                          : "sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => startRenameDocument(document)}
                        disabled={busy || renameSaving || Boolean(deletingDocumentId)}
                        aria-label={`Rename ${document.title || document.fileName}`}
                        title={copy.reader.renamePdf}
                        data-testid="rename-pdf-button"
                        className="grid h-7 w-7 place-items-center rounded-md border border-border-default bg-white text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(document).catch(() => undefined)}
                        disabled={busy || Boolean(deletingDocumentId)}
                        aria-label={`Delete ${document.title || document.fileName}`}
                        title={copy.reader.deletePdf}
                        data-testid="delete-pdf-button"
                        className="grid h-7 w-7 place-items-center rounded-md border border-danger-200 bg-white text-danger-600 transition hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {deletingDocumentId === document.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {documents.length === 0 && (
            <div className="flex flex-col items-center rounded-lg bg-white px-3 py-6 text-center">
              <FileText size={24} className="text-neutral-300" />
              <p className="mt-2 text-sm font-bold text-neutral-600">{copy.reader.noPdfs}</p>
            </div>
          )}
        </div>
      </aside>

      <WorkspaceResizeHandle
        orientation="vertical"
        className="lg:order-4"
        ariaLabel={copy.reader.resizeDocuments}
        testId="resize-pdf-documents-sidebar"
        onResizeStart={handleDocumentsSidebarResizeStart}
      />

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
              {pageCount ? (language === "zh" ? ` - ${pageCount} 页` : ` - ${pageCount} pages`) : ""}
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
              <button
                type="button"
                disabled={!hasActivePdf || !pageNumber || pageNumber <= 1}
                onClick={() =>
                  pageNumber ? goToPage(pageNumber - 1).catch(() => undefined) : undefined
                }
                className="grid h-9 w-9 place-items-center text-neutral-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={copy.reader.previousPage}
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
                  pageNumber ? goToPage(pageNumber + 1).catch(() => undefined) : undefined
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
                onClick={() => {
                  setHasManualScale(true);
                  setScale((value) =>
                    Number(Math.max(MIN_SCALE, value - SCALE_STEP).toFixed(2)),
                  );
                }}
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
                onClick={() => {
                  setHasManualScale(true);
                  setScale((value) =>
                    Number(Math.min(MAX_SCALE, value + SCALE_STEP).toFixed(2)),
                  );
                }}
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
              <p>{selectedDocument.errorMessage}</p>
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
                className={`rounded-sm bg-white shadow-lg shadow-[rgba(44,35,62,0.1)] ${
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

      <WorkspaceResizeHandle
        orientation="vertical"
        className="lg:order-2"
        ariaLabel={copy.reader.resizeTools}
        testId="resize-pdf-tools-sidebar"
        onResizeStart={handleToolsSidebarResizeStart}
      />

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
                        aria-label={`${isExpanded ? copy.common.close : language === "zh" ? "展开" : "Expand"} ${
                          section.title
                        }`}
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
                      onClick={() => goToPage(section.pageStart).catch(() => undefined)}
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
              <Loader2 size={14} className="shrink-0 animate-spin text-neutral-500" />
            )}
          </div>

          {selectedDocument && !canAskPdf && (
            <button
              type="button"
              onClick={() => handleReindex().catch(() => undefined)}
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
            onSubmit={(event) => handleAskPdf(event).catch(() => undefined)}
            data-testid="ask-pdf-form"
            className="mt-3 space-y-2"
          >
            <textarea
              value={askQuestion}
              onChange={(event) => setAskQuestion(event.target.value)}
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
                          goToSourcePage(citation.pageStart, citation.chunkId).catch(
                            () => undefined,
                          )
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
    </section>
  );
}
