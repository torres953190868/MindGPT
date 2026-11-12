import type { ConversationMessageItem } from "@/lib/graph";
import { resolveRegenerateTargets } from "@/lib/message-regeneration";
import type {
  ChatAttachment,
  ChatMessage,
  ChatModelSelection,
  ChatSkill,
  MindNode,
} from "@/lib/types";

export const RESIZE_STORAGE_KEY = "branchmind:node-detail-resize";
export const MIN_COMPOSER_HEIGHT = 120;
export const MIN_HEADER_HEIGHT = 96;

export const SELECTION_ACTION_WIDTH = 176;
export const SELECTION_ACTION_MARGIN = 12;
export const SELECTION_ACTION_VERTICAL_OFFSET = 52;

export type HeaderActionItem = "edit" | "delete" | "notes";
export type ModeActionItem = "reply" | "continue" | "branch";

export type SelectionAction = {
  text: string;
  x: number;
  y: number;
};

export type StoredNodeDetailResize = {
  composerHeight: number | null;
  headerHeight: number | null;
};

export type NodeDetailPanelProps = {
  node: MindNode | null;
  conversationMessages?: ConversationMessageItem[];
  conversationFocusRequest?: number;
  onCreateNode: (
    nodeId: string,
    mode: "continue" | "branch",
    instruction: string,
    sourceText?: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  onAppendNodeMessage: (
    nodeId: string,
    instruction: string,
    sourceText?: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onPopulateNode: (
    nodeId: string,
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onEditUserMessage: (
    nodeId: string,
    userMessageId: string,
    instruction: string,
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onRetryAssistantMessage: (
    nodeId: string,
    assistantMessageId: string,
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  onUpdateNodeTitle: (nodeId: string, title: string) => Promise<boolean>;
  onToggleNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  deleteDescendantCount?: number;
  isCreating: boolean;
  streamingMessageId?: string | null;
  isNotesOpen: boolean;
  error: string | null;
  onToggleNotes: () => void;
  onCollapse: () => void;
  initialSubmit?: boolean;
  autoPreparePdfAttachments?: boolean;
  onBeforeInitialSubmit?: (resumeSubmit: () => void) => boolean | Promise<boolean>;
  onStartProject?: (
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  showNotesAction?: boolean;
  showCollapseButton?: boolean;
  showComposer?: boolean;
  composerPlaceholder?: string;
  submitLabel?: string;
};

/**
 * Reads persisted panel sizes. `storage` defaults to `window.localStorage`,
 * resolved inside the `try`: merely accessing it throws a `SecurityError` when
 * storage is blocked (Safari with cookies disabled, sandboxed iframes). Pass
 * `null` to skip storage entirely.
 */
export function readStoredResize(
  storage?: Pick<Storage, "getItem"> | null,
): StoredNodeDetailResize {
  try {
    const resolvedStorage =
      storage === undefined
        ? typeof window !== "undefined"
          ? window.localStorage
          : null
        : storage;
    if (!resolvedStorage) return { composerHeight: null, headerHeight: null };

    const raw = resolvedStorage.getItem(RESIZE_STORAGE_KEY);
    if (!raw) return { composerHeight: null, headerHeight: null };
    const parsed = JSON.parse(raw) as {
      composerHeight?: number;
      headerHeight?: number;
    };
    return {
      composerHeight:
        typeof parsed.composerHeight === "number" ? parsed.composerHeight : null,
      headerHeight:
        typeof parsed.headerHeight === "number" ? parsed.headerHeight : null,
    };
  } catch {
    return { composerHeight: null, headerHeight: null };
  }
}

export function clampHeight(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampSelectionActionPosition(value: number, max: number): number {
  return Math.min(Math.max(value, SELECTION_ACTION_MARGIN), max);
}

export function normalizeSelectedText(rawText: string): string {
  return rawText.replace(/\s+/g, " ").trim();
}

export function computeSelectionActionPosition(
  selectionRect: {
    left: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const maxLeft = Math.max(
    SELECTION_ACTION_MARGIN,
    viewport.width - SELECTION_ACTION_WIDTH - SELECTION_ACTION_MARGIN,
  );
  const x = clampSelectionActionPosition(
    selectionRect.left + selectionRect.width / 2 - SELECTION_ACTION_WIDTH / 2,
    maxLeft,
  );
  const topAbove = selectionRect.top - SELECTION_ACTION_VERTICAL_OFFSET;
  const topBelow = selectionRect.bottom + 8;
  const maxTop = Math.max(SELECTION_ACTION_MARGIN, viewport.height - 48);
  const y = clampSelectionActionPosition(
    topAbove >= SELECTION_ACTION_MARGIN ? topAbove : topBelow,
    maxTop,
  );
  return { x, y };
}

export function resolveDisplayMessages(
  node: MindNode | null,
  conversationMessages?: ConversationMessageItem[],
): ConversationMessageItem[] {
  if (!node) return [];
  if (conversationMessages) return conversationMessages;
  return node.messages.map((message) => ({
    sourceNodeId: node.id,
    message,
    inherited: false,
  }));
}

export function resolveLatestMessageActionIds(node: MindNode | null): {
  latestEditableUserMessageId: string | null;
  latestRetryableAssistantMessageId: string | null;
} {
  let lastNodeUserMessage: ChatMessage | null = null;
  let lastNodeAssistantMessage: ChatMessage | null = null;
  if (node) {
    for (let index = node.messages.length - 1; index >= 0; index -= 1) {
      const message = node.messages[index];
      if (!lastNodeAssistantMessage && message.role === "assistant") {
        lastNodeAssistantMessage = message;
      }
      if (!lastNodeUserMessage && message.role === "user") {
        lastNodeUserMessage = message;
      }
      if (lastNodeUserMessage && lastNodeAssistantMessage) break;
    }
  }

  const latestEditableUserMessageId =
    node &&
    lastNodeUserMessage &&
    resolveRegenerateTargets(node.messages, {
      userMessageId: lastNodeUserMessage.id,
    })?.isLatestAssistant
      ? lastNodeUserMessage.id
      : null;

  const latestRetryableAssistantMessageId =
    node &&
    lastNodeAssistantMessage &&
    resolveRegenerateTargets(node.messages, {
      assistantMessageId: lastNodeAssistantMessage.id,
    })?.isLatestAssistant
      ? lastNodeAssistantMessage.id
      : null;

  return {
    latestEditableUserMessageId,
    latestRetryableAssistantMessageId,
  };
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed.");
  } finally {
    textarea.remove();
  }
}
