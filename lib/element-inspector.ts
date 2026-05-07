export type ElementInspectorInfo = {
  tag: string;
  id: string;
  classes: string[];
  selector: string;
  rect: DOMRect;
  text: string;
};

export type ElementInspectorOptions = {
  hotkey?: string;
  hotkeyModifier?: "alt" | "ctrl" | "meta";
  onSelect?: (info: ElementInspectorInfo) => void;
  onHover?: (info: ElementInspectorInfo) => void;
  onToggle?: (active: boolean) => void;
};

export type ElementInspector = {
  start: () => void;
  stop: () => void;
  toggle: () => void;
  isActive: () => boolean;
  getHoveredInfo: () => ElementInspectorInfo | null;
  getHoveredElement: () => HTMLElement | null;
  destroy: () => void;
};

declare global {
  interface Window {
    createElementInspector?: (options?: ElementInspectorOptions) => ElementInspector;
  }
}

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.reject(new Error("Clipboard API is unavailable"));
}

function getClassList(element: HTMLElement) {
  const className = element.className;

  if (typeof className !== "string") {
    return [];
  }

  return className.trim().split(/\s+/).filter(Boolean);
}

const selectorAttributes = ["data-testid", "data-test", "data-id", "data-node-id", "aria-label", "name", "role"];

const utilityClassNames = new Set([
  "absolute",
  "block",
  "flex",
  "grid",
  "group",
  "hidden",
  "inline-flex",
  "relative",
  "sr-only",
  "sticky",
]);

const utilityClassPrefixes = [
  "bg",
  "border",
  "bottom",
  "cursor",
  "duration",
  "ease",
  "flex",
  "font",
  "gap",
  "h",
  "inset",
  "items",
  "justify",
  "leading",
  "left",
  "line-clamp",
  "m",
  "max",
  "min",
  "object",
  "opacity",
  "outline",
  "overflow",
  "p",
  "place",
  "pointer",
  "pr",
  "px",
  "py",
  "resize",
  "right",
  "rounded",
  "shadow",
  "shrink",
  "space",
  "text",
  "top",
  "tracking",
  "transition",
  "translate",
  "truncate",
  "w",
  "whitespace",
  "z",
];

function escapeIdentifier(value: string) {
  return CSS.escape(value);
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isUtilityClass(className: string) {
  if (className.includes(":") || className.includes("/") || className.includes("[") || className.includes("]")) {
    return true;
  }

  if (utilityClassNames.has(className)) {
    return true;
  }

  return utilityClassPrefixes.some((prefix) => className === prefix || className.startsWith(`${prefix}-`));
}

function getStableClasses(element: HTMLElement) {
  return getClassList(element)
    .filter((className) => /^[A-Za-z_-][\w-]*$/.test(className))
    .filter((className) => !isUtilityClass(className))
    .slice(0, 2);
}

function getNthOfType(element: HTMLElement) {
  const parent = element.parentElement;
  if (!parent) return "";

  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child instanceof HTMLElement && child.tagName === element.tagName,
  );

  if (sameTagSiblings.length <= 1) {
    return "";
  }

  return `:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
}

function getSelectorPart(element: HTMLElement) {
  const tag = element.tagName.toLowerCase();

  if (element.id) {
    return `${tag}#${escapeIdentifier(element.id)}`;
  }

  for (const attribute of selectorAttributes) {
    const value = element.getAttribute(attribute);
    if (value) {
      return `${tag}[${attribute}="${escapeAttributeValue(value)}"]`;
    }
  }

  const classes = getStableClasses(element);
  const classSelector = classes.length ? `.${classes.map(escapeIdentifier).join(".")}` : "";

  return `${tag}${classSelector}${getNthOfType(element)}`;
}

function getElementSelector(element: HTMLElement) {
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body && current !== document.documentElement) {
    parts.unshift(getSelectorPart(current));

    const selector = parts.join(" > ");
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }

    if (current.id) {
      return selector;
    }

    current = current.parentElement;
  }

  return parts.join(" > ") || element.tagName.toLowerCase();
}

function getElementInfo(element: HTMLElement): ElementInspectorInfo {
  const tag = element.tagName.toLowerCase();
  const id = element.id || "";
  const classes = getClassList(element);
  const selector = getElementSelector(element);

  return {
    tag,
    id,
    classes,
    selector,
    rect: element.getBoundingClientRect(),
    text: (element.textContent || "").trim().slice(0, 80),
  };
}

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-inspector", "overlay");
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid #ff5a36";
  overlay.style.background = "rgba(255, 90, 54, 0.12)";
  overlay.style.boxSizing = "border-box";
  overlay.style.zIndex = "9998";
  overlay.style.display = "none";
  return overlay;
}

function createBadge() {
  const badge = document.createElement("div");
  badge.setAttribute("data-inspector", "badge");
  badge.style.position = "fixed";
  badge.style.pointerEvents = "none";
  badge.style.maxWidth = "320px";
  badge.style.padding = "8px 10px";
  badge.style.borderRadius = "8px";
  badge.style.background = "rgba(20, 22, 24, 0.92)";
  badge.style.color = "#f5f5f5";
  badge.style.font = "12px/1.4 Consolas, Monaco, monospace";
  badge.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.18)";
  badge.style.zIndex = "9999";
  badge.style.display = "none";
  badge.style.whiteSpace = "nowrap";
  badge.style.textOverflow = "ellipsis";
  badge.style.overflow = "hidden";
  return badge;
}

export function createElementInspector(options: ElementInspectorOptions = {}): ElementInspector {
  const hotkey = (options.hotkey || "i").toLowerCase();
  const hotkeyModifier = options.hotkeyModifier || "alt";
  const overlay = createOverlay();
  const badge = createBadge();

  let active = false;
  let hoveredInfo: ElementInspectorInfo | null = null;
  let hoveredElement: HTMLElement | null = null;
  let previousCursor = "";

  function ensureUi() {
    if (!document.body.contains(overlay)) {
      document.body.appendChild(overlay);
    }

    if (!document.body.contains(badge)) {
      document.body.appendChild(badge);
    }
  }

  function updateOverlay(info: ElementInspectorInfo) {
    overlay.style.display = "block";
    overlay.style.left = `${info.rect.left}px`;
    overlay.style.top = `${info.rect.top}px`;
    overlay.style.width = `${Math.max(info.rect.width, 0)}px`;
    overlay.style.height = `${Math.max(info.rect.height, 0)}px`;
  }

  function updateBadge(info: ElementInspectorInfo, mouseEvent: MouseEvent) {
    const label = `${info.selector}${info.text ? ` | ${info.text}` : ""}`;
    badge.textContent = label;
    badge.title = label;
    badge.style.display = "block";

    const offset = 14;
    const maxLeft = Math.max(window.innerWidth - badge.offsetWidth - 8, 8);
    const maxTop = Math.max(window.innerHeight - badge.offsetHeight - 8, 8);
    badge.style.left = `${Math.min(mouseEvent.clientX + offset, maxLeft)}px`;
    badge.style.top = `${Math.min(mouseEvent.clientY + offset, maxTop)}px`;
  }

  function clearUi() {
    overlay.style.display = "none";
    badge.style.display = "none";
  }

  function stop() {
    if (!active) return;

    active = false;
    hoveredInfo = null;
    hoveredElement = null;
    clearUi();
    document.body.style.cursor = previousCursor;
    options.onToggle?.(false);
  }

  function start() {
    if (active) return;

    ensureUi();
    active = true;
    previousCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    options.onToggle?.(true);
  }

  function toggle() {
    if (active) {
      stop();
    } else {
      start();
    }
  }

  function handleMove(event: MouseEvent) {
    if (!active) return;

    const element = event.target instanceof HTMLElement ? event.target : null;
    if (!element || element.closest("[data-inspector]")) return;

    hoveredElement = element;
    hoveredInfo = getElementInfo(element);
    updateOverlay(hoveredInfo);
    updateBadge(hoveredInfo, event);
    options.onHover?.(hoveredInfo);
  }

  function handleClick(event: MouseEvent) {
    if (!active) return;

    const element = event.target instanceof HTMLElement ? event.target : null;
    if (!element || element.closest("[data-inspector]")) return;

    event.preventDefault();
    event.stopPropagation();

    hoveredElement = element;
    hoveredInfo = getElementInfo(element);
    copyToClipboard(hoveredInfo.selector).catch((error: unknown) => {
      console.warn("Failed to copy selector:", error);
    });
    options.onSelect?.(hoveredInfo);
    stop();
  }

  function handleKeyDown(event: KeyboardEvent) {
    const modifierPressed =
      hotkeyModifier === "alt" ? event.altKey : hotkeyModifier === "ctrl" ? event.ctrlKey : event.metaKey;

    if (modifierPressed && event.key.toLowerCase() === hotkey) {
      event.preventDefault();
      toggle();
      return;
    }

    if (event.key === "Escape" && active) {
      event.preventDefault();
      stop();
    }
  }

  document.addEventListener("mousemove", handleMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown);

  return {
    start,
    stop,
    toggle,
    isActive: () => active,
    getHoveredInfo: () => hoveredInfo,
    getHoveredElement: () => hoveredElement,
    destroy: () => {
      stop();
      document.removeEventListener("mousemove", handleMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
      overlay.remove();
      badge.remove();
    },
  };
}

export function installElementInspectorGlobal() {
  window.createElementInspector = createElementInspector;
}
