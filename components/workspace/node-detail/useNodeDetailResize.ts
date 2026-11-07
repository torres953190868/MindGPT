import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/types";
import {
  getResizeInputMode,
  type ResizeStartEvent,
} from "../WorkspaceResizeHandle";
import {
  clampHeight,
  computeSelectionActionPosition,
  copyTextToClipboard,
  MIN_COMPOSER_HEIGHT,
  MIN_HEADER_HEIGHT,
  normalizeSelectedText,
  readStoredResize,
  RESIZE_STORAGE_KEY,
  type SelectionAction,
} from "./node-detail-helpers";

export function useNodeDetailResize(panelRef: RefObject<HTMLElement | null>) {
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  const headerResizePointerStartedAtRef = useRef(-Infinity);
  const composerResizePointerStartedAtRef = useRef(-Infinity);

  useEffect(() => {
    const stored = readStoredResize();
    setComposerHeight(stored.composerHeight);
    setHeaderHeight(stored.headerHeight);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(
        RESIZE_STORAGE_KEY,
        JSON.stringify({ composerHeight, headerHeight }),
      );
    } catch {
      // Storage may be unavailable in private mode or due to quota.
    }
  }, [composerHeight, headerHeight]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;

    function clampHeights() {
      const panelHeight = panel?.clientHeight ?? 0;
      if (!panelHeight) return;
      const maxHeight = Math.floor(panelHeight * 0.5);
      setComposerHeight((current) =>
        current === null ? null : clampHeight(current, MIN_COMPOSER_HEIGHT, maxHeight),
      );
    }

    clampHeights();
    window.addEventListener("resize", clampHeights);
    return () => window.removeEventListener("resize", clampHeights);
  }, [panelRef]);

  const handleComposerResizeStart = useCallback(
    (event: ResizeStartEvent) => {
      event.preventDefault();
      const isPointerResize = getResizeInputMode(event) === "pointer";
      const startY = event.clientY;
      const composerElement = panelRef.current?.querySelector(
        ".node-detail-composer",
      ) as HTMLElement | null;
      const currentComposerHeight =
        composerElement?.clientHeight ?? MIN_COMPOSER_HEIGHT;
      const startHeight = composerHeight ?? currentComposerHeight;
      const panelHeight = panelRef.current?.clientHeight ?? 0;
      const maxHeight =
        panelHeight > 0 ? Math.floor(panelHeight * 0.5) : Number.MAX_SAFE_INTEGER;

      function resizeTo(clientY: number) {
        const deltaY = startY - clientY;
        const nextHeight = clampHeight(
          startHeight + deltaY,
          MIN_COMPOSER_HEIGHT,
          maxHeight,
        );
        setComposerHeight(nextHeight);
      }

      function handlePointerMove(moveEvent: globalThis.PointerEvent) {
        resizeTo(moveEvent.clientY);
      }

      function handleMouseMove(moveEvent: globalThis.MouseEvent) {
        resizeTo(moveEvent.clientY);
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
    [composerHeight, panelRef],
  );

  const handleComposerResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      composerResizePointerStartedAtRef.current = event.timeStamp;
      handleComposerResizeStart(event);
    },
    [handleComposerResizeStart],
  );

  const handleComposerResizeMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.timeStamp - composerResizePointerStartedAtRef.current < 100) return;
      handleComposerResizeStart(event);
    },
    [handleComposerResizeStart],
  );

  const handleHeaderResizeStart = useCallback(
    (event: ResizeStartEvent) => {
      event.preventDefault();
      const isPointerResize = getResizeInputMode(event) === "pointer";
      const startY = event.clientY;
      const headerElement = panelRef.current?.querySelector(
        ".node-detail-header-region",
      ) as HTMLElement | null;
      const currentHeaderHeight = headerElement?.clientHeight ?? MIN_HEADER_HEIGHT;
      const startHeight = headerHeight ?? currentHeaderHeight;
      const panelHeight = panelRef.current?.clientHeight ?? 0;
      const maxHeight =
        panelHeight > 0 ? Math.floor(panelHeight * 0.5) : Number.MAX_SAFE_INTEGER;

      function resizeTo(clientY: number) {
        const deltaY = clientY - startY;
        const nextHeight = clampHeight(
          startHeight + deltaY,
          MIN_HEADER_HEIGHT,
          maxHeight,
        );
        setHeaderHeight(nextHeight);
      }

      function handlePointerMove(moveEvent: globalThis.PointerEvent) {
        resizeTo(moveEvent.clientY);
      }

      function handleMouseMove(moveEvent: globalThis.MouseEvent) {
        resizeTo(moveEvent.clientY);
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
    [headerHeight, panelRef],
  );

  const handleHeaderResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      headerResizePointerStartedAtRef.current = event.timeStamp;
      handleHeaderResizeStart(event);
    },
    [handleHeaderResizeStart],
  );

  const handleHeaderResizeMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.timeStamp - headerResizePointerStartedAtRef.current < 100) return;
      handleHeaderResizeStart(event);
    },
    [handleHeaderResizeStart],
  );

  const panelStyle = {
    "--node-detail-composer-height":
      composerHeight === null ? undefined : `${composerHeight}px`,
    "--node-detail-header-height":
      headerHeight === null ? undefined : `${headerHeight}px`,
  } as CSSProperties;

  return {
    panelStyle,
    handleHeaderResizePointerDown,
    handleHeaderResizeMouseDown,
    handleComposerResizePointerDown,
    handleComposerResizeMouseDown,
  };
}

export function useConversationScrollAndSelection({
  selectedNodeId,
  isCreating,
  streamingContent,
  conversationFocusRequest,
}: {
  selectedNodeId: string | undefined;
  isCreating: boolean;
  streamingContent: string;
  conversationFocusRequest: number;
}) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const [selectedSourceText, setSelectedSourceText] = useState("");
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);

  const clearSelectedSourceText = useCallback(() => {
    setSelectedSourceText("");
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const clearSelectionAction = useCallback(() => {
    setSelectionAction(null);
  }, []);

  const dismissBrowserSelection = useCallback(() => {
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const captureSelectionAction = useCallback(() => {
    const container = messagesRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelectionAction(null);
      return;
    }

    const text = normalizeSelectedText(selection.toString());
    if (!text) {
      setSelectionAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const fallbackRect = Array.from(range.getClientRects()).find(
      (item) => item.width > 0 || item.height > 0,
    );
    const selectionRect = rect.width > 0 || rect.height > 0 ? rect : fallbackRect;
    if (!selectionRect) {
      setSelectionAction(null);
      return;
    }

    const { x, y } = computeSelectionActionPosition(selectionRect, {
      width: window.innerWidth,
      height: window.innerHeight,
    });

    setSelectionAction({ text, x, y });
  }, []);

  const handleCopyMessage = useCallback(async (message: ChatMessage, messageKey: string) => {
    if (!message.content) return;

    try {
      await copyTextToClipboard(message.content);
      setCopiedMessageKey(messageKey);
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageKey((currentKey) =>
          currentKey === messageKey ? null : currentKey,
        );
      }, 1800);
    } catch {
      setCopiedMessageKey(null);
    }
  }, []);

  useEffect(() => {
    if (!selectionAction) return undefined;

    window.addEventListener("resize", clearSelectionAction);
    window.addEventListener("scroll", clearSelectionAction, true);

    return () => {
      window.removeEventListener("resize", clearSelectionAction);
      window.removeEventListener("scroll", clearSelectionAction, true);
    };
  }, [clearSelectionAction, selectionAction]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isCreating) return;
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight });
  }, [isCreating, selectedNodeId, streamingContent]);

  useEffect(() => {
    if (!conversationFocusRequest || !selectedNodeId) return;

    const frame = window.requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container) return;

      const nodeMessages = Array.from(
        container.querySelectorAll<HTMLElement>('[data-testid="conversation-message"]'),
      ).filter((message) => message.dataset.sourceNodeId === selectedNodeId);
      const target =
        nodeMessages.find((message) => message.querySelector('[data-role="user"]')) ??
        nodeMessages[0];

      if (!target) {
        container.scrollTo({ top: 0 });
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      container.scrollTo({ top: container.scrollTop + targetTop - containerTop });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [conversationFocusRequest, selectedNodeId]);

  return {
    messagesRef,
    selectedSourceText,
    setSelectedSourceText,
    selectionAction,
    copiedMessageKey,
    clearSelectedSourceText,
    dismissBrowserSelection,
    captureSelectionAction,
    handleCopyMessage,
  };
}
