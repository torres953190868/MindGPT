import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MindMap } from "@/components/workspace/MindMap";
import type { Project } from "@/lib/types";
import { makeNode, makeProject } from "../fixtures";
import { mockReactFlow } from "../../setup/react-flow";
import { copy, renderWithProviders } from "../../setup/render";

mockReactFlow();

/**
 * root ─┬─ continue-1 ── hidden-grandchild (hidden while continue-1 is collapsed)
 *       └─ branch-1
 */
function createProject({ collapsed = false } = {}): Project {
  return makeProject([
    makeNode({ id: "root", title: "Root idea", children: ["continue-1", "branch-1"] }),
    makeNode({
      id: "continue-1",
      parentId: "root",
      title: "Go deeper",
      branchType: "continue",
      position: { x: 0, y: 320 },
      children: ["hidden-grandchild"],
      collapsed,
    }),
    makeNode({
      id: "branch-1",
      parentId: "root",
      title: "Side topic",
      branchType: "branch",
      position: { x: 420, y: 0 },
    }),
    makeNode({
      id: "hidden-grandchild",
      parentId: "continue-1",
      title: "Even deeper",
      branchType: "continue",
      position: { x: 0, y: 640 },
    }),
  ]);
}

function renderMindMap(project: Project, selectedNodeId: string | null = null) {
  const props = {
    project,
    selectedNodeId,
    onSelectNode: vi.fn(),
    onCreateNode: vi.fn(),
    onToggleNode: vi.fn(),
    onMoveNode: vi.fn(),
    creatingNodeId: null,
    streamingNodeId: null,
  };
  const result = renderWithProviders(<MindMap {...props} />);
  return { ...result, props };
}

function getNodeCard(nodeId: string) {
  const card = screen
    .getAllByTestId("branch-node-card")
    .find((element) => element.dataset.nodeId === nodeId);
  if (!card) throw new Error(`Node card ${nodeId} not rendered`);
  return card;
}

describe("MindMap", () => {
  it("renders every visible node and the edges between them", async () => {
    const { container } = renderMindMap(createProject());

    expect(screen.getByRole("region", { name: "Mind map" })).toBeInTheDocument();
    expect(screen.getAllByTestId("branch-node-card")).toHaveLength(4);
    await waitFor(() => expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(3));
    expect(container.querySelector('[data-id="root-branch-1"]')).toBeInTheDocument();
  });

  it("hides descendants of a collapsed node", async () => {
    const { container } = renderMindMap(createProject({ collapsed: true }));

    const cards = screen.getAllByTestId("branch-node-card");
    expect(cards.map((card) => card.dataset.nodeId).sort()).toEqual([
      "branch-1",
      "continue-1",
      "root",
    ]);
    await waitFor(() => expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(2));
  });

  it("selects a node when it is clicked", async () => {
    const { user, props } = renderMindMap(createProject());

    // Nodes stay visibility:hidden until React Flow has measured them.
    await user.click(
      await within(getNodeCard("branch-1")).findByRole("button", {
        name: copy.workspace.openNode("Side topic"),
      }),
    );

    expect(props.onSelectNode).toHaveBeenCalledWith("branch-1");
  });

  it("marks the selected node", () => {
    renderMindMap(createProject(), "continue-1");

    expect(getNodeCard("continue-1")).toHaveAttribute("data-selected", "true");
    expect(getNodeCard("root")).toHaveAttribute("data-selected", "false");
  });

  it("creates a branch from a node's quick action", async () => {
    const { user, props } = renderMindMap(createProject());

    await user.click(
      await within(getNodeCard("root")).findByRole("button", {
        name: copy.workspace.newBranchRight,
      }),
    );

    expect(props.onCreateNode).toHaveBeenCalledWith("root", "branch");
  });

  it("shows an empty state when no node is visible", () => {
    renderMindMap(makeProject([], { rootNodeId: "missing" }));

    expect(screen.getByTestId("mind-map-empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("mind-map")).not.toBeInTheDocument();
  });
});
