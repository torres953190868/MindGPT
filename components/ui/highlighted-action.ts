"use client";

import { useCallback, useState } from "react";

type HighlightedActionOptions<Action extends string> = {
  defaultAction?: Action | null;
};

type HighlightedActionStateOptions = {
  active?: boolean;
  enabled?: boolean;
};

type HighlightedActionHandlerOptions = {
  clearOnMouseLeave?: boolean;
};

const HIGHLIGHTED_ACTION_CLASS = "bg-neutral-900 text-white shadow-lg duration-1000 ease-out";
const NORMAL_ACTION_TRANSITION_CLASS = "duration-100 ease-in";

export function getHighlightedActionClass(highlighted: boolean, normalClass: string) {
  return highlighted
    ? HIGHLIGHTED_ACTION_CLASS
    : `${normalClass} ${NORMAL_ACTION_TRANSITION_CLASS}`;
}

export function useHighlightedAction<Action extends string>({
  defaultAction = null,
}: HighlightedActionOptions<Action> = {}) {
  const [hoveredAction, setHoveredAction] = useState<Action | null>(null);

  const clearHighlightedAction = useCallback(() => {
    setHoveredAction(null);
  }, []);

  const isHighlighted = useCallback(
    (action: Action, options: HighlightedActionStateOptions = {}) => {
      const { active = defaultAction === action, enabled = true } = options;
      return enabled && (hoveredAction === action || (active && hoveredAction === null));
    },
    [defaultAction, hoveredAction],
  );

  const getDataHighlighted = useCallback(
    (action: Action, options: HighlightedActionStateOptions = {}) =>
      isHighlighted(action, options) ? "true" : undefined,
    [isHighlighted],
  );

  const getHoverHandlers = useCallback(
    (action: Action, options: HighlightedActionHandlerOptions = {}) => ({
      onMouseEnter: () => setHoveredAction(action),
      ...(options.clearOnMouseLeave ? { onMouseLeave: clearHighlightedAction } : {}),
    }),
    [clearHighlightedAction],
  );

  const getPointerHoverHandlers = useCallback(
    (action: Action, options: HighlightedActionHandlerOptions = {}) => ({
      onPointerEnter: () => setHoveredAction(action),
      onMouseEnter: () => setHoveredAction(action),
      ...(options.clearOnMouseLeave ? { onMouseLeave: clearHighlightedAction } : {}),
    }),
    [clearHighlightedAction],
  );

  return {
    hoveredAction,
    setHoveredAction,
    clearHighlightedAction,
    isHighlighted,
    getDataHighlighted,
    getHoverHandlers,
    getPointerHoverHandlers,
  };
}
