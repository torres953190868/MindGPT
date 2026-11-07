import { describe, expect, it, vi } from "vitest";
import {
  clampHeight,
  clampSelectionActionPosition,
  computeSelectionActionPosition,
  MIN_COMPOSER_HEIGHT,
  MIN_HEADER_HEIGHT,
  normalizeSelectedText,
  readStoredResize,
  RESIZE_STORAGE_KEY,
  resolveDisplayMessages,
  resolveLatestMessageActionIds,
  SELECTION_ACTION_MARGIN,
} from "@/components/workspace/node-detail/node-detail-helpers";
import type { MindNode } from "@/lib/types";

function createTestNode(overrides: Partial<MindNode> = {}): MindNode {
  return {
    id: "node-1",
    projectId: "proj-1",
    parentId: null,
    branchType: "root",
    title: "Test Node",
    titleManuallyEdited: false,
    summary: "Node summary",
    messages: [],
    position: { x: 0, y: 0 },
    collapsed: false,
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("node-detail-helpers", () => {
  it("clamps heights and selection action coordinates within bounds", () => {
    expect(clampHeight(80, MIN_COMPOSER_HEIGHT, 360)).toBe(MIN_COMPOSER_HEIGHT);
    expect(clampHeight(200, MIN_HEADER_HEIGHT, 360)).toBe(200);
    expect(clampHeight(500, MIN_HEADER_HEIGHT, 360)).toBe(360);

    expect(clampSelectionActionPosition(-10, 400)).toBe(SELECTION_ACTION_MARGIN);
    expect(clampSelectionActionPosition(120, 400)).toBe(120);
    expect(clampSelectionActionPosition(500, 400)).toBe(400);
  });

  it("reads stored resize values safely and handles malformed JSON", () => {
    expect(readStoredResize(null)).toEqual({
      composerHeight: null,
      headerHeight: null,
    });

    const validStorage = {
      getItem: (key: string) =>
        key === RESIZE_STORAGE_KEY
          ? JSON.stringify({ composerHeight: 180, headerHeight: 140 })
          : null,
    };
    expect(readStoredResize(validStorage)).toEqual({
      composerHeight: 180,
      headerHeight: 140,
    });

    const malformedStorage = {
      getItem: () => "{broken-json",
    };
    expect(readStoredResize(malformedStorage)).toEqual({
      composerHeight: null,
      headerHeight: null,
    });
  });

  it("returns default sizes when browser storage access is blocked", () => {
    // Safari with cookies disabled or a sandboxed iframe throws on property access.
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    vi.stubGlobal("window", blockedWindow);

    try {
      expect(readStoredResize()).toEqual({ composerHeight: null, headerHeight: null });
    } finally {
      vi.unstubAllGlobals();
    }

    const throwingStorage = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(readStoredResize(throwingStorage)).toEqual({ composerHeight: null, headerHeight: null });
  });

  it("normalizes selected text and computes floating button coordinates", () => {
    expect(normalizeSelectedText("  hello \n\t  world  ")).toBe("hello world");

    const abovePosition = computeSelectionActionPosition(
      { left: 200, top: 100, bottom: 120, width: 100, height: 20 },
      { width: 800, height: 600 },
    );
    expect(abovePosition).toEqual({ x: 162, y: 48 });

    const belowWhenNearTop = computeSelectionActionPosition(
      { left: 5, top: 20, bottom: 40, width: 20, height: 20 },
      { width: 800, height: 600 },
    );
    expect(belowWhenNearTop).toEqual({ x: SELECTION_ACTION_MARGIN, y: 48 });
  });

  it("resolves display messages from explicit conversationMessages or node messages", () => {
    expect(resolveDisplayMessages(null)).toEqual([]);

    const node = createTestNode({
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          attachments: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(resolveDisplayMessages(node)).toEqual([
      {
        sourceNodeId: "node-1",
        message: node.messages[0],
        inherited: false,
      },
    ]);

    const customItems = [
      {
        sourceNodeId: "node-0",
        message: node.messages[0],
        inherited: true,
      },
    ];
    expect(resolveDisplayMessages(node, customItems)).toBe(customItems);
  });

  it("resolves latest editable user message and retryable assistant message IDs", () => {
    expect(resolveLatestMessageActionIds(null)).toEqual({
      latestEditableUserMessageId: null,
      latestRetryableAssistantMessageId: null,
    });

    const node = createTestNode({
      messages: [
        {
          id: "u-1",
          role: "user",
          content: "First prompt",
          attachments: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a-1",
          role: "assistant",
          content: "First answer",
          attachments: [],
          createdAt: "2026-01-01T00:00:01.000Z",
        },
        {
          id: "u-2",
          role: "user",
          content: "Second prompt",
          attachments: [],
          createdAt: "2026-01-01T00:00:02.000Z",
        },
        {
          id: "a-2",
          role: "assistant",
          content: "Second answer",
          attachments: [],
          createdAt: "2026-01-01T00:00:03.000Z",
        },
      ],
    });

    expect(resolveLatestMessageActionIds(node)).toEqual({
      latestEditableUserMessageId: "u-2",
      latestRetryableAssistantMessageId: "a-2",
    });
  });
});
