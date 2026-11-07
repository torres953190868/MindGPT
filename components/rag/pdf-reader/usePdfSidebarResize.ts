import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getResizeInputMode,
  type ResizeStartEvent,
} from "@/components/workspace/WorkspaceResizeHandle";
import { clampNumber, getPdfSidebarResizeBounds } from "./helpers";
import {
  PDF_DOCUMENTS_SIDEBAR_DEFAULT_WIDTH,
  PDF_MOBILE_MEDIA_QUERY,
  PDF_RESIZE_HANDLE_WIDTH,
  PDF_TOOLS_SIDEBAR_DEFAULT_WIDTH,
  PDF_VIEWER_MIN_WIDTH,
  type PdfSidebarSide,
} from "./types";

export type UsePdfSidebarResizeResult = {
  readerGridRef: RefObject<HTMLElement | null>;
  pdfReaderGridStyle: CSSProperties;
  handleDocumentsSidebarResizeStart: (event: ResizeStartEvent) => void;
  handleToolsSidebarResizeStart: (event: ResizeStartEvent) => void;
};

export function usePdfSidebarResize(): UsePdfSidebarResizeResult {
  const readerGridRef = useRef<HTMLElement | null>(null);
  const [documentsSidebarWidth, setDocumentsSidebarWidth] = useState(
    PDF_DOCUMENTS_SIDEBAR_DEFAULT_WIDTH,
  );
  const [toolsSidebarWidth, setToolsSidebarWidth] = useState(
    PDF_TOOLS_SIDEBAR_DEFAULT_WIDTH,
  );

  const pdfReaderGridStyle = {
    "--pdf-reader-grid-columns": `${toolsSidebarWidth}px ${PDF_RESIZE_HANDLE_WIDTH}px minmax(${PDF_VIEWER_MIN_WIDTH}px,1fr) ${PDF_RESIZE_HANDLE_WIDTH}px ${documentsSidebarWidth}px`,
  } as CSSProperties;

  const getReaderGridWidth = useCallback(() => {
    return readerGridRef.current?.clientWidth ?? 0;
  }, []);

  const clampPdfSidebars = useCallback(
    (gridWidth = getReaderGridWidth()) => {
      if (!gridWidth || window.matchMedia(PDF_MOBILE_MEDIA_QUERY).matches) {
        return;
      }

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
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleClamp);

    scheduleClamp();
    observer?.observe(grid);
    window.addEventListener("resize", scheduleClamp);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleClamp);
    };
  }, [clampPdfSidebars]);

  return {
    readerGridRef,
    pdfReaderGridStyle,
    handleDocumentsSidebarResizeStart,
    handleToolsSidebarResizeStart,
  };
}
