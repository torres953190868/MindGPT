import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import {
  BranchNodeCard,
  type BranchNodeData,
  type InlineNodeComposerData,
} from "@/components/workspace/BranchNodeCard";
import type { MindNode } from "@/lib/types";
import { makeMessage, makeNode } from "../fixtures";
import { copy, renderWithProviders } from "../../setup/render";

function FlowWrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

function createData(overrides: Partial<BranchNodeData> = {}): BranchNodeData {
  return {
    mindNode: makeNode({
      id: "node-1",
      parentId: "root",
      title: "Photosynthesis",
      summary: "How plants make food",
      branchType: "branch",
      children: ["child-1", "child-2"],
    }),
    selected: false,
    isEntering: false,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    isStreaming: false,
    creationDisabled: false,
    mobileLongPressDragEnabled: false,
    mobileLongPressDragging: false,
    onMobileLongPressStart: vi.fn(),
    consumeMobileNodeClickSuppression: vi.fn(() => false),
    ...overrides,
  };
}

function renderCard(overrides: Partial<BranchNodeData> = {}) {
  const data = createData(overrides);
  const props: NodeProps = {
    id: data.mindNode.id,
    data,
    type: "branchNode",
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: false,
    selected: data.selected,
    draggable: true,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
  const result = renderWithProviders(<BranchNodeCard {...props} />, { wrapper: FlowWrapper });
  return { ...result, data };
}

function withNode(overrides: Partial<MindNode>): Pick<BranchNodeData, "mindNode"> {
  return {
    mindNode: makeNode({
      id: "node-1",
      parentId: "root",
      title: "Photosynthesis",
      summary: "How plants make food",
      ...overrides,
    }),
  };
}

describe("BranchNodeCard", () => {
  it("renders the kind label, title, summary and child count", () => {
    renderCard();

    const card = screen.getByRole("article", { name: "Photosynthesis" });
    expect(card).toHaveAccessibleDescription("How plants make food");
    expect(card).toHaveTextContent(copy.workspace.branch);
    expect(screen.getByLabelText(copy.workspace.childCount(2))).toHaveTextContent("2");
    expect(
      screen.getByRole("button", { name: copy.workspace.openNode("Photosynthesis") }),
    ).toBeInTheDocument();
  });

  it.each([
    ["root", copy.workspace.root],
    ["continue", copy.workspace.continue],
  ] as const)("labels a %s node", (branchType, label) => {
    renderCard(withNode({ branchType }));

    expect(screen.getByTestId("branch-node-card").querySelector("[data-kind]")).toHaveTextContent(
      label,
    );
  });

  it("hides the multi-turn badge when a node has 0 or 1 user turn and renders it for multi-turn nodes", () => {
    const { unmount: unmountZero } = renderCard(withNode({ messages: [] }));
    expect(screen.queryByTestId("branch-node-turn-count")).not.toBeInTheDocument();
    unmountZero();

    const { unmount: unmountOne } = renderCard(
      withNode({
        messages: [
          makeMessage({ id: "u1", role: "user", content: "First question" }),
          makeMessage({ id: "a1", role: "assistant", content: "First answer" }),
          makeMessage({ id: "u-empty", role: "user", content: "   " }),
        ],
      }),
    );
    expect(screen.queryByTestId("branch-node-turn-count")).not.toBeInTheDocument();
    unmountOne();

    const threeTurnMessages = [
      makeMessage({ id: "u1", role: "user", content: "Turn 1" }),
      makeMessage({ id: "a1", role: "assistant", content: "Answer 1" }),
      makeMessage({ id: "u2", role: "user", content: "Turn 2" }),
      makeMessage({ id: "a2", role: "assistant", content: "Answer 2" }),
      makeMessage({ id: "u3", role: "user", content: "Turn 3" }),
      makeMessage({ id: "a3", role: "assistant", content: "Answer 3" }),
    ];
    const { unmount: unmountThree } = renderCard(withNode({ messages: threeTurnMessages }));
    const badge = screen.getByTestId("branch-node-turn-count");
    expect(badge).toHaveTextContent(copy.workspace.turnCountShort(3));
    expect(badge).toHaveAttribute("aria-label", copy.workspace.turnCount(3));
    unmountThree();

    renderCard({
      ...withNode({ messages: threeTurnMessages }),
      inlineComposer: {
        nodeId: "node-1",
        isBusy: false,
        error: null,
        placeholder: "Ask anything",
        submitLabel: "Send",
        onSubmit: vi.fn(async () => "project-1"),
      },
    });
    expect(screen.queryByTestId("branch-node-turn-count")).not.toBeInTheDocument();
  });

  it("reflects the selected state", () => {
    const { unmount } = renderCard({ selected: false });
    expect(screen.getByTestId("branch-node-card")).toHaveAttribute("data-selected", "false");
    expect(screen.getByTestId("open-node-button")).toHaveAttribute("aria-pressed", "false");
    unmount();

    renderCard({ selected: true });
    expect(screen.getByTestId("branch-node-card")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("open-node-button")).toHaveAttribute("aria-pressed", "true");
  });

  it("selects the node when the card is opened", async () => {
    const { user, data } = renderCard();

    await user.click(screen.getByTestId("open-node-button"));

    expect(data.onSelect).toHaveBeenCalledTimes(1);
    expect(data.onSelect).toHaveBeenCalledWith("node-1");
  });

  it("does not select the node when a mobile long-press suppressed the click", async () => {
    const { user, data } = renderCard({
      consumeMobileNodeClickSuppression: vi.fn(() => true),
    });

    await user.click(screen.getByTestId("open-node-button"));

    expect(data.onSelect).not.toHaveBeenCalled();
  });

  it("continues below and branches right from the quick actions", async () => {
    const { user, data } = renderCard();

    await user.click(screen.getByRole("button", { name: copy.workspace.newContinueBelow }));
    expect(data.onSelect).toHaveBeenLastCalledWith("node-1");
    expect(data.onCreate).toHaveBeenLastCalledWith("node-1", "continue");

    await user.click(screen.getByRole("button", { name: copy.workspace.newBranchRight }));
    expect(data.onCreate).toHaveBeenLastCalledWith("node-1", "branch");
    expect(data.onCreate).toHaveBeenCalledTimes(2);
  });

  it("folds and expands children with an accurate label", async () => {
    const { user, data, unmount } = renderCard();

    const foldButton = screen.getByRole("button", {
      name: copy.workspace.collapseChildrenFor("Photosynthesis"),
    });
    expect(foldButton).toHaveAttribute("aria-expanded", "true");
    await user.click(foldButton);
    expect(data.onToggle).toHaveBeenCalledWith("node-1");
    unmount();

    renderCard(withNode({ children: ["child-1"], collapsed: true }));
    expect(
      screen.getByRole("button", { name: copy.workspace.expandChildrenFor("Photosynthesis") }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("uses a neutral toggle label for a leaf node", () => {
    renderCard(withNode({ children: [] }));

    const toggle = screen.getByRole("button", {
      name: copy.workspace.toggleChildren("Photosynthesis"),
    });
    expect(toggle).not.toHaveAttribute("aria-expanded");
  });

  it("disables creation actions while another node is being created", () => {
    renderCard({ creationDisabled: true });

    expect(screen.getByRole("button", { name: copy.workspace.newContinueBelow })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.workspace.newBranchRight })).toBeDisabled();
    expect(screen.getByTestId("toggle-children-button")).toBeEnabled();
  });

  it("shows a thinking state instead of the title while streaming", () => {
    renderCard({ isStreaming: true });

    expect(
      screen.getByRole("button", { name: copy.workspace.openNode(copy.workspace.thinkingElapsed(0)) }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("thinking-elapsed-timer")).toBeInTheDocument();
    expect(screen.queryByText("How plants make food")).not.toBeInTheDocument();
    expect(screen.getByTestId("toggle-children-button")).toBeDisabled();
  });

  it("starts a mobile long-press drag from the card body but not from quick actions", () => {
    const { data } = renderCard({ mobileLongPressDragEnabled: true });

    fireEvent.pointerDown(screen.getByTestId("continue-below-button"), {
      pointerId: 1,
      isPrimary: true,
    });
    expect(data.onMobileLongPressStart).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText("How plants make food"), {
      pointerId: 7,
      clientX: 12,
      clientY: 34,
      button: 0,
      isPrimary: true,
    });
    expect(data.onMobileLongPressStart).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({ pointerId: 7, clientX: 12, clientY: 34, button: 0 }),
    );
  });

  describe("inline composer", () => {
    function createComposer(overrides: Partial<InlineNodeComposerData> = {}): InlineNodeComposerData {
      return {
        nodeId: "node-1",
        isBusy: false,
        error: null,
        placeholder: "Ask anything",
        submitLabel: "Send",
        onSubmit: vi.fn(async () => "project-1"),
        ...overrides,
      };
    }

    it("replaces the quick actions with a composer that submits with Enter", async () => {
      const inlineComposer = createComposer();
      const { user } = renderCard({ inlineComposer });

      expect(screen.queryByTestId("continue-below-button")).not.toBeInTheDocument();
      const input = screen.getByPlaceholderText("Ask anything");

      await user.type(input, "Line one{Shift>}{Enter}{/Shift}");
      expect(inlineComposer.onSubmit).not.toHaveBeenCalled();

      await user.type(input, "line two{Enter}");
      await waitFor(() =>
        expect(inlineComposer.onSubmit).toHaveBeenCalledWith(
          "Line one\nline two",
          [],
          undefined,
          undefined,
        ),
      );
      await waitFor(() => expect(input).toHaveValue(""));
    });

    it("shows the submission error only after a failed submit", async () => {
      const inlineComposer = createComposer({
        error: "Could not create project.",
        onSubmit: vi.fn(async () => null),
      });
      const { user } = renderCard({ inlineComposer });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.type(screen.getByPlaceholderText("Ask anything"), "Hello");
      await user.click(screen.getByRole("button", { name: copy.workspace.send }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not create project.");
      expect(screen.getByPlaceholderText("Ask anything")).toHaveValue("Hello");
    });

    it("disables sending while busy", async () => {
      renderCard({ inlineComposer: createComposer({ isBusy: true }) });

      expect(screen.getByPlaceholderText("Ask anything")).toBeDisabled();
      expect(screen.getByRole("button", { name: copy.workspace.send })).toBeDisabled();
    });
  });
});
