"use client";

import {
  type MouseEvent,
  type PointerEvent,
  useRef,
} from "react";

export type ResizeStartEvent =
  | PointerEvent<HTMLButtonElement>
  | MouseEvent<HTMLButtonElement>;

type WorkspaceResizeHandleProps = {
  orientation: "vertical" | "horizontal";
  desktopBreakpoint?: "lg" | "xl";
  variant?: "full" | "compact";
  ariaLabel: string;
  testId: string;
  onResizeStart: (event: ResizeStartEvent) => void;
};

export function getResizeInputMode(event: ResizeStartEvent) {
  if (!("pointerId" in event)) return "mouse";

  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Programmatic pointer events can be non-captureable.
  }

  return "pointer";
}

export function WorkspaceResizeHandle({
  orientation,
  desktopBreakpoint = "lg",
  variant = "full",
  ariaLabel,
  testId,
  onResizeStart,
}: WorkspaceResizeHandleProps) {
  const isVertical = orientation === "vertical";
  const isCompact = variant === "compact";
  const lastPointerStartAtRef = useRef(-Infinity);
  const verticalClassName =
    desktopBreakpoint === "xl"
      ? "hidden cursor-col-resize xl:block"
      : "hidden cursor-col-resize lg:block";
  const verticalWrapperClassName = isCompact
    ? `${verticalClassName} h-40 self-start bg-transparent`
    : `${verticalClassName} bg-surface-canvas`;
  const verticalButtonClassName = isCompact
    ? "left-0 top-3 h-32 w-full cursor-col-resize rounded-md"
    : "left-0 top-0 h-full w-full cursor-col-resize";
  const verticalGripClassName = isCompact
    ? "h-12 w-0.5 opacity-50 group-hover:opacity-90"
    : "h-10 w-0.5 opacity-0 group-hover:opacity-80";

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    lastPointerStartAtRef.current = event.timeStamp;
    onResizeStart(event);
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.timeStamp - lastPointerStartAtRef.current < 100) return;
    onResizeStart(event);
  };

  return (
    <div
      className={`relative ${
        isVertical ? verticalWrapperClassName : "h-6 cursor-row-resize lg:hidden"
      }`}
    >
      {!isVertical && (
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-neutral-200" />
      )}
      <button
        type="button"
        role="separator"
        aria-label={ariaLabel}
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        className={`group absolute grid place-items-center border border-transparent bg-transparent transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200/40 ${
          isVertical
            ? verticalButtonClassName
            : "left-1/2 top-1/2 h-8 w-24 -translate-x-1/2 -translate-y-1/2 cursor-row-resize rounded-md"
        }`}
      >
        <span
          className={`rounded-full bg-brand-400 transition ${
            isVertical ? verticalGripClassName : "h-0.5 w-8 opacity-0 group-hover:opacity-80"
          }`}
        />
      </button>
    </div>
  );
}
