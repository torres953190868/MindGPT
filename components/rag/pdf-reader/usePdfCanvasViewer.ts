import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getMobileFitWidthScale,
  getPdfViewerContentWidth,
  isRenderCancellation,
  loadPdfJs,
} from "./helpers";
import {
  MAX_SCALE,
  MIN_SCALE,
  PDF_MOBILE_MEDIA_QUERY,
  PDF_RANGE_CHUNK_SIZE,
  type PdfDocumentProxy,
  type PdfLoadingTask,
  type PdfRenderTask,
  SCALE_STEP,
} from "./types";

export type UsePdfCanvasViewerOptions = {
  pdfSourceUrl: string | null;
  isSavedPdfSource: boolean;
  pageNumber: number | null;
  setPageNumber: Dispatch<SetStateAction<number | null>>;
  setPageInput: Dispatch<SetStateAction<string>>;
};

export type UsePdfCanvasViewerResult = {
  pdfViewerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  pdfPageCount: number;
  pdfLoading: boolean;
  pdfRendering: boolean;
  pdfError: string | null;
  scale: number;
  zoomOut: () => void;
  zoomIn: () => void;
};

export function usePdfCanvasViewer({
  pdfSourceUrl,
  isSavedPdfSource,
  pageNumber,
  setPageNumber,
  setPageInput,
}: UsePdfCanvasViewerOptions): UsePdfCanvasViewerResult {
  const pdfViewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);

  const [pdfDocument, setPdfDocument] = useState<PdfDocumentProxy | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfRendering, setPdfRendering] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.05);
  const [pdfViewerWidth, setPdfViewerWidth] = useState(0);
  const [hasManualScale, setHasManualScale] = useState(false);

  const zoomOut = useCallback(() => {
    setHasManualScale(true);
    setScale((value) =>
      Number(Math.max(MIN_SCALE, value - SCALE_STEP).toFixed(2)),
    );
  }, []);

  const zoomIn = useCallback(() => {
    setHasManualScale(true);
    setScale((value) =>
      Number(Math.min(MAX_SCALE, value + SCALE_STEP).toFixed(2)),
    );
  }, []);

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
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);

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
            loadError instanceof Error
              ? loadError.message
              : "PDF failed to load.",
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
  }, [isSavedPdfSource, pdfSourceUrl, setPageInput, setPageNumber]);

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
        const renderViewport = pdfPage.getViewport({
          scale: scale * outputScale,
        });

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

  return {
    pdfViewerRef,
    canvasRef,
    pdfPageCount,
    pdfLoading,
    pdfRendering,
    pdfError,
    scale,
    zoomOut,
    zoomIn,
  };
}
