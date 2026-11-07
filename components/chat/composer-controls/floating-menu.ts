import {
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useLayoutEffect,
  useState,
} from "react";
import type { FloatingMenuAlignment, FloatingMenuPlacement } from "./types";

export const FLOATING_SUBMENU_GAP_PX = 8;
export const FLOATING_SUBMENU_MARGIN_PX = 8;
export const FLOATING_SUBMENU_MAX_WIDTH_PX = 224;
export const FLOATING_SUBMENU_MAX_HEIGHT_PX = 256;

export function getMenuPlacementClass(
  placement: FloatingMenuPlacement,
  alignment: FloatingMenuAlignment,
) {
  const horizontalPosition = alignment === "end" ? "right-0" : "left-0";
  return placement === "below"
    ? `absolute ${horizontalPosition} top-full z-50 mt-2`
    : `absolute bottom-full ${horizontalPosition} z-50 mb-2`;
}

export function stopFloatingMenuWheelPropagation(
  event: ReactWheelEvent<HTMLDivElement>,
) {
  event.stopPropagation();
}

export function computeFloatingSubmenuPosition(
  rect: Pick<DOMRect, "top" | "left" | "right">,
  viewportWidth: number,
  viewportHeight: number,
) {
  const submenuWidth = Math.min(
    FLOATING_SUBMENU_MAX_WIDTH_PX,
    Math.max(0, viewportWidth - FLOATING_SUBMENU_MARGIN_PX * 2),
  );
  const canPlaceOnLeft =
    rect.left >=
    submenuWidth + FLOATING_SUBMENU_GAP_PX + FLOATING_SUBMENU_MARGIN_PX;
  const left = canPlaceOnLeft
    ? rect.left - submenuWidth - FLOATING_SUBMENU_GAP_PX
    : Math.min(
        rect.right + FLOATING_SUBMENU_GAP_PX,
        viewportWidth - submenuWidth - FLOATING_SUBMENU_MARGIN_PX,
      );
  const top = Math.max(
    FLOATING_SUBMENU_MARGIN_PX,
    Math.min(
      rect.top,
      viewportHeight - FLOATING_SUBMENU_MAX_HEIGHT_PX - FLOATING_SUBMENU_MARGIN_PX,
    ),
  );

  return {
    top,
    left: Math.max(FLOATING_SUBMENU_MARGIN_PX, left),
  };
}

export function useFloatingSubmenuPosition({
  isKnowledgeMenuOpen,
  isSkillMenuOpen,
  knowledgeMenuButtonRef,
  skillMenuButtonRef,
}: {
  isKnowledgeMenuOpen: boolean;
  isSkillMenuOpen: boolean;
  knowledgeMenuButtonRef: RefObject<HTMLButtonElement | null>;
  skillMenuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const [submenuPosition, setSubmenuPosition] = useState({ top: -320, left: 0 });

  useLayoutEffect(() => {
    const button = isKnowledgeMenuOpen
      ? knowledgeMenuButtonRef.current
      : isSkillMenuOpen
        ? skillMenuButtonRef.current
        : null;
    if (!button) return undefined;

    const updatePosition = () => {
      const rect = button.getBoundingClientRect();
      setSubmenuPosition(
        computeFloatingSubmenuPosition(rect, window.innerWidth, window.innerHeight),
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isKnowledgeMenuOpen, isSkillMenuOpen, knowledgeMenuButtonRef, skillMenuButtonRef]);

  return submenuPosition;
}
