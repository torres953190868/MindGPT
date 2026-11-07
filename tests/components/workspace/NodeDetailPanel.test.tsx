import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NodeDetailPanel,
  type NodeDetailPanelProps,
} from "@/components/workspace/NodeDetailPanel";
import type { MindNode } from "@/lib/types";
import { makeAnsweredNode, makeMessage, makeNode } from "../fixtures";
import { copy, renderWithProviders } from "../../setup/render";

function createProps(overrides: Partial<NodeDetailPanelProps> = {}): NodeDetailPanelProps {
  return {
    node: makeAnsweredNode({
      id: "node-1",
      parentId: "root",
      title: "Photosynthesis",
      summary: "How plants make food",
      branchType: "continue",
    }),
    onCreateNode: vi.fn(async () => "node-new"),
    onPopulateNode: vi.fn(async () => true),
    onEditUserMessage: vi.fn(async () => true),
    onRetryAssistantMessage: vi.fn(async () => true),
    onUpdateNodeTitle: vi.fn(async () => true),
    onToggleNode: vi.fn(),
    onDeleteNode: vi.fn(),
    isCreating: false,
    streamingMessageId: null,
    isNotesOpen: false,
    error: null,
    onToggleNotes: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides,
  };
}

function renderPanel(overrides: Partial<NodeDetailPanelProps> = {}) {
  const props = createProps(overrides);
  const result = renderWithProviders(<NodeDetailPanel {...props} />);
  return { ...result, props };
}

function getInstructionInput() {
  return screen.getByRole("textbox", { name: copy.workspace.messageInstruction });
}

function getSendButton() {
  return screen.getByRole("button", { name: copy.workspace.send });
}

describe("NodeDetailPanel", () => {
  describe("rendering", () => {
    it("shows an empty state with a working collapse button when no node is selected", async () => {
      const { user, props } = renderPanel({ node: null });

      expect(screen.getByTestId("node-detail-empty-state")).toHaveTextContent(
        copy.workspace.nodeNotSelected,
      );
      expect(screen.queryByTestId("message-composer")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: copy.workspace.collapseNodeDetails }));
      expect(props.onCollapse).toHaveBeenCalledTimes(1);
    });

    it("renders the node title, summary and conversation", () => {
      renderPanel();

      const panel = screen.getByRole("complementary", { name: "Photosynthesis" });
      expect(within(panel).getByRole("heading", { name: "Photosynthesis" })).toBeInTheDocument();
      expect(panel).toHaveTextContent("How plants make food");

      const messages = screen.getAllByTestId("conversation-message");
      expect(messages).toHaveLength(2);
      expect(messages[0]).toHaveTextContent("What is photosynthesis?");
      expect(messages[1]).toHaveTextContent("Plants turn light into chemical energy.");
    });

    it("shows the node brief and hides the Continue/Branch toggle for a blank node", () => {
      renderPanel({
        node: makeNode({ id: "blank", parentId: "root", title: "Empty idea", summary: "Draft" }),
      });

      expect(screen.getByTestId("node-brief-card")).toHaveTextContent("Empty idea");
      expect(screen.queryByTestId("message-branch-mode")).not.toBeInTheDocument();
    });

    it("hides the composer when showComposer is false", () => {
      renderPanel({ showComposer: false });

      expect(screen.queryByTestId("message-composer")).not.toBeInTheDocument();
      expect(screen.getByTestId("node-detail-panel")).toHaveAttribute("data-has-composer", "false");
    });

    it("shows a provided error as an alert", () => {
      renderPanel({ error: "The model is unavailable." });

      expect(screen.getByRole("alert")).toHaveTextContent("The model is unavailable.");
    });

    it("renders with default sizes when browser storage is blocked", () => {
      // Safari with cookies disabled or a sandboxed iframe throws on property access.
      const storageKeys = ["localStorage", "sessionStorage"] as const;
      const originals = storageKeys.map((key) => Object.getOwnPropertyDescriptor(window, key));
      for (const key of storageKeys) {
        Object.defineProperty(window, key, {
          configurable: true,
          get() {
            throw new DOMException("The operation is insecure.", "SecurityError");
          },
        });
      }

      try {
        renderPanel();

        expect(screen.getByRole("heading", { name: "Photosynthesis" })).toBeInTheDocument();
        expect(screen.getByTestId("message-composer")).toBeInTheDocument();
      } finally {
        storageKeys.forEach((key, index) => {
          const original = originals[index];
          if (original) Object.defineProperty(window, key, original);
          else Reflect.deleteProperty(window, key);
        });
      }
      expect(() => window.localStorage.getItem("x")).not.toThrow();
    });
  });

  describe("inline title editing", () => {
    it("saves a changed title with Enter", async () => {
      const { user, props } = renderPanel();

      await user.click(screen.getByRole("button", { name: copy.workspace.editNodeTitle }));
      const input = screen.getByTestId("node-title-edit-input");
      expect(input).toHaveValue("Photosynthesis");
      expect(input).toHaveFocus();

      await user.clear(input);
      await user.type(input, "Light reactions{Enter}");

      expect(props.onUpdateNodeTitle).toHaveBeenCalledWith("node-1", "Light reactions");
      await waitFor(() =>
        expect(screen.queryByTestId("node-title-edit-input")).not.toBeInTheDocument(),
      );
    });

    it("cancels with Escape without saving", async () => {
      const { user, props } = renderPanel();

      await user.click(screen.getByRole("button", { name: copy.workspace.editNodeTitle }));
      await user.type(screen.getByTestId("node-title-edit-input"), " draft{Escape}");

      expect(props.onUpdateNodeTitle).not.toHaveBeenCalled();
      expect(screen.queryByTestId("node-title-edit-input")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Photosynthesis" })).toBeInTheDocument();
    });

    it("disables saving for an unchanged or blank title", async () => {
      const { user, props } = renderPanel();

      await user.click(screen.getByRole("button", { name: copy.workspace.editNodeTitle }));
      const saveButton = screen.getByRole("button", { name: copy.workspace.saveNodeTitle });
      expect(saveButton).toBeDisabled();

      const input = screen.getByTestId("node-title-edit-input");
      await user.clear(input);
      await user.type(input, "   {Enter}");
      expect(saveButton).toBeDisabled();
      expect(props.onUpdateNodeTitle).not.toHaveBeenCalled();
    });

    it("keeps the editor open when saving fails", async () => {
      const { user } = renderPanel({ onUpdateNodeTitle: vi.fn(async () => false) });

      await user.click(screen.getByRole("button", { name: copy.workspace.editNodeTitle }));
      await user.type(screen.getByTestId("node-title-edit-input"), " 2");
      await user.click(screen.getByRole("button", { name: copy.workspace.saveNodeTitle }));

      expect(screen.getByTestId("node-title-edit-input")).toHaveValue("Photosynthesis 2");
    });

    it("disables title editing while a response is streaming", () => {
      renderPanel({ isCreating: true });

      expect(screen.getByRole("button", { name: copy.workspace.editNodeTitle })).toBeDisabled();
    });
  });

  describe("delete confirmation", () => {
    it("does not offer delete for the root node", () => {
      renderPanel({ node: makeAnsweredNode({ id: "root", parentId: null }) });

      expect(screen.queryByTestId("delete-node-button")).not.toBeInTheDocument();
    });

    it("shows the descendant count and deletes only after confirmation", async () => {
      const { user, props } = renderPanel({ deleteDescendantCount: 3 });

      await user.click(screen.getByRole("button", { name: copy.workspace.deleteNode }));

      const dialog = screen.getByRole("dialog", { name: copy.workspace.deleteNodePrompt });
      expect(dialog).toHaveAccessibleDescription(
        copy.workspace.deleteNodeBody("Photosynthesis", 3),
      );
      expect(dialog).toHaveTextContent("3 child nodes");
      expect(props.onDeleteNode).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: copy.common.delete }));

      expect(props.onDeleteNode).toHaveBeenCalledTimes(1);
      expect(props.onDeleteNode).toHaveBeenCalledWith("node-1");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("focuses Cancel and closes without deleting on Cancel, Escape or backdrop click", async () => {
      const { user, props } = renderPanel();
      const openDialog = () =>
        user.click(screen.getByRole("button", { name: copy.workspace.deleteNode }));

      await openDialog();
      const cancelButton = screen.getByTestId("cancel-delete-node-button");
      expect(cancelButton).toHaveFocus();
      await user.click(cancelButton);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await openDialog();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await openDialog();
      await user.click(screen.getByTestId("delete-node-dialog-backdrop"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      expect(props.onDeleteNode).not.toHaveBeenCalled();
    });

    it("describes a leaf node deletion without a child count", async () => {
      const { user } = renderPanel({ deleteDescendantCount: 0 });

      await user.click(screen.getByRole("button", { name: copy.workspace.deleteNode }));

      expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
        'This permanently deletes "Photosynthesis".',
      );
    });
  });

  describe("composer", () => {
    it("keeps Send disabled until there is non-whitespace input", async () => {
      const { user } = renderPanel();

      expect(getSendButton()).toBeDisabled();
      await user.type(getInstructionInput(), "   ");
      expect(getSendButton()).toBeDisabled();
      await user.type(getInstructionInput(), "Explain more");
      expect(getSendButton()).toBeEnabled();
    });

    it("continues down by default and clears the input after success", async () => {
      const { user, props } = renderPanel();

      expect(screen.getByRole("button", { name: copy.workspace.continueDown })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await user.type(getInstructionInput(), "  Explain the Calvin cycle  ");
      await user.click(getSendButton());

      await waitFor(() =>
        expect(props.onCreateNode).toHaveBeenCalledWith(
          "node-1",
          "continue",
          "Explain the Calvin cycle",
          undefined,
          [],
          undefined,
          undefined,
        ),
      );
      await waitFor(() => expect(getInstructionInput()).toHaveValue(""));
      expect(props.onPopulateNode).not.toHaveBeenCalled();
    });

    it("branches right when Branch mode is selected", async () => {
      const { user, props } = renderPanel();

      await user.click(screen.getByRole("button", { name: copy.workspace.branchRight }));
      expect(screen.getByRole("button", { name: copy.workspace.branchRight })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: copy.workspace.continueDown })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      await user.type(getInstructionInput(), "Compare with respiration");
      await user.click(getSendButton());

      await waitFor(() => expect(props.onCreateNode).toHaveBeenCalledTimes(1));
      expect(props.onCreateNode).toHaveBeenCalledWith(
        "node-1",
        "branch",
        "Compare with respiration",
        undefined,
        [],
        undefined,
        undefined,
      );
    });

    it("keeps the draft when node creation fails", async () => {
      const { user, props } = renderPanel({ onCreateNode: vi.fn(async () => null) });

      await user.type(getInstructionInput(), "Keep me");
      await user.click(getSendButton());

      await waitFor(() => expect(props.onCreateNode).toHaveBeenCalledTimes(1));
      expect(getInstructionInput()).toHaveValue("Keep me");
    });

    it("populates a blank node instead of creating a child", async () => {
      const { user, props } = renderPanel({
        node: makeNode({ id: "blank", parentId: "root", title: "Empty idea" }),
      });

      await user.type(getInstructionInput(), "Start here");
      await user.click(getSendButton());

      await waitFor(() =>
        expect(props.onPopulateNode).toHaveBeenCalledWith(
          "blank",
          "Start here",
          [],
          undefined,
          undefined,
        ),
      );
      expect(props.onCreateNode).not.toHaveBeenCalled();
    });

    it("locks the composer and marks the streaming message while a response streams", () => {
      const node = makeAnsweredNode({ id: "node-1", parentId: "root" });
      renderPanel({ node, isCreating: true, streamingMessageId: "node-1-assistant" });

      expect(getInstructionInput()).toBeDisabled();
      expect(getSendButton()).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.workspace.continueDown })).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.workspace.branchRight })).toBeDisabled();
      expect(screen.getByTestId("message-send-status")).toHaveTextContent(
        copy.workspace.streamingAnswer,
      );

      const streamingMessage = screen
        .getAllByTestId("conversation-message")
        .find((message) => message.dataset.messageId === "node-1-assistant");
      expect(streamingMessage).toHaveAttribute("data-streaming", "true");
      expect(screen.getByTestId("message-streaming-status")).toBeInTheDocument();
    });
  });

  describe("message actions", () => {
    function nodeWithTwoExchanges(): MindNode {
      return makeNode({
        id: "node-1",
        parentId: "root",
        messages: [
          makeMessage({ id: "u1", role: "user", content: "First question" }),
          makeMessage({ id: "a1", role: "assistant", content: "First answer" }),
          makeMessage({ id: "u2", role: "user", content: "Second question" }),
          makeMessage({ id: "a2", role: "assistant", content: "Second answer" }),
        ],
      });
    }

    function getMessage(messageId: string) {
      const message = screen
        .getAllByTestId("conversation-message")
        .find((item) => item.dataset.messageId === messageId);
      if (!message) throw new Error(`Message ${messageId} not rendered`);
      return message;
    }

    it("offers copy on every message but edit/retry only on the latest exchange", () => {
      renderPanel({ node: nodeWithTwoExchanges() });

      expect(screen.getAllByTestId("copy-message-button")).toHaveLength(4);

      expect(within(getMessage("u1")).queryByTestId("edit-message-button")).not.toBeInTheDocument();
      expect(within(getMessage("a1")).queryByTestId("retry-message-button")).not.toBeInTheDocument();
      expect(
        within(getMessage("u2")).getByRole("button", { name: copy.workspace.editUserMessage }),
      ).toBeInTheDocument();
      expect(
        within(getMessage("a2")).getByRole("button", { name: copy.workspace.retryAssistant }),
      ).toBeInTheDocument();
    });

    it("does not offer edit/retry on messages inherited from parent nodes", () => {
      const node = makeAnsweredNode({ id: "node-1", parentId: "root" });
      renderPanel({
        node,
        conversationMessages: [
          {
            sourceNodeId: "root",
            inherited: true,
            message: makeMessage({ id: "parent-u", role: "user", content: "Parent question" }),
          },
          {
            sourceNodeId: "root",
            inherited: true,
            message: makeMessage({ id: "parent-a", role: "assistant", content: "Parent answer" }),
          },
          ...node.messages.map((message) => ({
            sourceNodeId: node.id,
            inherited: false,
            message,
          })),
        ],
      });

      const groupLabels = screen.getAllByTestId("conversation-group-label");
      expect(groupLabels.map((label) => label.dataset.group)).toEqual(["inherited", "current"]);
      expect(groupLabels[0]).toHaveTextContent(copy.workspace.conversationInheritedGroup(2));

      expect(getMessage("parent-u")).toHaveAttribute("data-inherited", "true");
      expect(within(getMessage("parent-u")).queryByTestId("edit-message-button")).toBeNull();
      expect(within(getMessage("parent-a")).queryByTestId("retry-message-button")).toBeNull();
      expect(within(getMessage("node-1-user")).getByTestId("edit-message-button")).toBeInTheDocument();
      expect(within(getMessage("node-1-assistant")).getByTestId("retry-message-button")).toBeInTheDocument();
    });

    it("retries the latest assistant message", async () => {
      const { user, props } = renderPanel({ node: nodeWithTwoExchanges() });

      await user.click(within(getMessage("a2")).getByTestId("retry-message-button"));

      expect(props.onRetryAssistantMessage).toHaveBeenCalledWith("node-1", "a2", undefined, undefined);
    });

    it("edits the latest user message and saves the trimmed text", async () => {
      const { user, props } = renderPanel({ node: nodeWithTwoExchanges() });

      await user.click(within(getMessage("u2")).getByTestId("edit-message-button"));
      const editor = screen.getByRole("textbox", { name: copy.workspace.editUserMessage });
      expect(editor).toHaveValue("Second question");

      await user.clear(editor);
      await user.type(editor, "  Rephrased question ");
      await user.click(screen.getByRole("button", { name: copy.workspace.saveMessageEdit }));

      expect(props.onEditUserMessage).toHaveBeenCalledWith(
        "node-1",
        "u2",
        "Rephrased question",
        undefined,
        undefined,
      );
      await waitFor(() => expect(screen.queryByTestId("message-edit-input")).not.toBeInTheDocument());
    });

    it("cancels a message edit without saving", async () => {
      const { user, props } = renderPanel({ node: nodeWithTwoExchanges() });

      await user.click(within(getMessage("u2")).getByTestId("edit-message-button"));
      await user.click(screen.getByRole("button", { name: copy.workspace.cancelMessageEdit }));

      expect(props.onEditUserMessage).not.toHaveBeenCalled();
      expect(getMessage("u2")).toHaveTextContent("Second question");
    });

    it("copies message content to the clipboard and confirms it", async () => {
      const { user } = renderPanel();
      const assistantMessage = getMessage("node-1-assistant");
      const copyButton = within(assistantMessage).getByTestId("copy-message-button");

      await user.click(copyButton);

      await expect(navigator.clipboard.readText()).resolves.toBe(
        "Plants turn light into chemical energy.",
      );
      await waitFor(() => expect(copyButton).toHaveAttribute("title", copy.common.copied));
    });

    it("disables copy for an empty message", () => {
      renderPanel({
        node: makeNode({
          id: "node-1",
          parentId: "root",
          messages: [
            makeMessage({ id: "u1", role: "user", content: "Question" }),
            makeMessage({ id: "a1", role: "assistant", content: "" }),
          ],
        }),
      });

      expect(within(getMessage("a1")).getByTestId("copy-message-button")).toBeDisabled();
    });
  });

  describe("header actions", () => {
    it("folds a node with children and toggles project notes", async () => {
      const { user, props } = renderPanel({
        node: makeAnsweredNode({ id: "node-1", parentId: "root", children: ["child-1"] }),
        isNotesOpen: true,
      });

      await user.click(screen.getByRole("button", { name: copy.workspace.foldNode }));
      expect(props.onToggleNode).toHaveBeenCalledWith("node-1");

      const notesButton = screen.getByRole("button", { name: copy.workspace.closeProjectNotes });
      expect(notesButton).toHaveAttribute("aria-expanded", "true");
      await user.click(notesButton);
      expect(props.onToggleNotes).toHaveBeenCalledTimes(1);
    });

    it("hides the fold action for a leaf node", () => {
      renderPanel();

      expect(screen.queryByTestId("toggle-node-button")).not.toBeInTheDocument();
    });
  });

  describe("selected text", () => {
    afterEach(() => {
      window.getSelection()?.removeAllRanges();
    });

    it("turns a text selection into a branch question with the selected source text", async () => {
      // jsdom has no layout, so give the selection range a visible rect.
      const rect = { left: 10, top: 200, bottom: 220, width: 80, height: 20 } as DOMRect;
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => rect,
      });
      Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: () => [rect],
      });

      try {
        const { user, props } = renderPanel();
        const answer = screen.getByText("Plants turn light into chemical energy.");

        act(() => {
          const range = document.createRange();
          range.selectNodeContents(answer);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        });
        // The panel captures the selection on mouseup inside the conversation.
        // (fireEvent, because user-event pointer actions would reset the selection.)
        fireEvent.mouseUp(answer);

        await user.click(
          await screen.findByRole("button", { name: copy.workspace.askBranchMindSelection }),
        );

        expect(screen.getByTestId("selected-text-context-chip")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: copy.workspace.branchRight })).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        await user.type(getInstructionInput(), "Why?");
        await user.click(getSendButton());

        await waitFor(() =>
          expect(props.onCreateNode).toHaveBeenCalledWith(
            "node-1",
            "branch",
            "Why?",
            "Plants turn light into chemical energy.",
            [],
            undefined,
            undefined,
          ),
        );
      } finally {
        delete (Range.prototype as Partial<Range>).getBoundingClientRect;
        delete (Range.prototype as Partial<Range>).getClientRects;
      }
    });
  });

  it("resets transient editing state when a different node is selected", async () => {
    const props = createProps();
    const { user, rerender } = renderWithProviders(<NodeDetailPanel {...props} />);

    await user.click(screen.getByRole("button", { name: copy.workspace.editNodeTitle }));
    expect(screen.getByTestId("node-title-edit-input")).toBeInTheDocument();

    rerender(
      <NodeDetailPanel
        {...props}
        node={makeAnsweredNode({ id: "node-2", parentId: "root", title: "Respiration" })}
      />,
    );

    expect(screen.queryByTestId("node-title-edit-input")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Respiration" })).toBeInTheDocument();
  });
});
