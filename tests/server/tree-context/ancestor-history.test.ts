import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  addBlankChildNode,
  addChildNode,
  createPendingRootProject,
  createRootProject,
  PENDING_ROOT_SUMMARY,
  PENDING_ROOT_TITLE,
} from "@/lib/server/project-model";
import {
  buildContextSummariesFromPath,
  extractAncestorHistory,
  extractNodeTurns,
  formatAssistantTurnJson,
  isCompletedMindNode,
} from "@/lib/server/tree-context/ancestor-history";
import type { ChatMessage, MindNode, Project } from "@/lib/types";

const replyContractSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(280),
  content: z.string().trim().min(1).max(8_000),
});

function makeMsg(
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id,
    role,
    content,
    attachments: [],
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("ancestor-history (Tree Context Point 1)", () => {
  describe("isCompletedMindNode", () => {
    it("returns false for pending root placeholders and blank child nodes", () => {
      const pending = createPendingRootProject("Understand Fourier transforms");
      expect(isCompletedMindNode(pending.node)).toBe(false);

      const blankAdded = addBlankChildNode(
        pending.project,
        pending.node.id,
        "branch",
      );
      expect(blankAdded).not.toBeNull();
      expect(isCompletedMindNode(blankAdded!.node)).toBe(false);

      const whitespaceAssistantNode: MindNode = {
        ...pending.node,
        title: "Custom Title",
        summary: "Custom Summary",
        messages: [
          makeMsg("u1", "user", "Hello"),
          makeMsg("a1", "assistant", "   \n\t  "),
        ],
      };
      expect(isCompletedMindNode(whitespaceAssistantNode)).toBe(false);
    });

    it("returns true when at least one non-empty assistant reply exists", () => {
      const project = createRootProject("Fourier transforms", {
        title: "Fourier Overview",
        summary: "Decomposes signals into frequencies.",
        content: "A Fourier transform maps time-domain signals to frequencies.",
      });
      const rootNode = project.nodes[project.rootNodeId];
      expect(isCompletedMindNode(rootNode)).toBe(true);

      const partiallyStreamingSecondTurn: MindNode = {
        ...rootNode,
        messages: [
          ...rootNode.messages,
          makeMsg("u2", "user", "Follow-up question"),
          makeMsg("a2", "assistant", ""),
        ],
      };
      expect(isCompletedMindNode(partiallyStreamingSecondTurn)).toBe(true);
    });
  });

  describe("buildContextSummariesFromPath", () => {
    it("resolves summaries by exact node IDs without duplicate-title collisions on or across branches", () => {
      let project = createRootProject("Linear Algebra", {
        title: "Examples",
        summary: "Root overview of linear transformations.",
        content: "Root content.",
      });
      const rootId = project.rootNodeId;

      const branchA = addChildNode(project, rootId, "branch", "Give 2D example", {
        title: "Examples",
        summary: "2D rotation matrix example.",
        content: "Branch A content.",
      })!;
      project = branchA.project;

      const branchB = addChildNode(project, rootId, "branch", "Give 3D example", {
        title: "Examples",
        summary: "3D projection matrix example.",
        content: "Branch B content.",
      })!;
      project = branchB.project;

      const contB = addChildNode(
        project,
        branchB.node.id,
        "continue",
        "Add summaryless edge case",
        {
          title: "Examples",
          summary: "   ",
          content: "Continuation under Branch B.",
        },
      )!;
      project = contB.project;

      expect(buildContextSummariesFromPath(project, branchA.node.id)).toEqual([
        "Examples: Root overview of linear transformations.",
        "Examples: 2D rotation matrix example.",
      ]);

      expect(buildContextSummariesFromPath(project, contB.node.id)).toEqual([
        "Examples: Root overview of linear transformations.",
        "Examples: 3D projection matrix example.",
        "Examples",
      ]);

      expect(buildContextSummariesFromPath(project, "missing_node_id")).toEqual([]);
    });
  });

  describe("formatAssistantTurnJson", () => {
    it("emits schema-valid JSON, compacts overlong metadata, and preserves LaTeX/Chinese without double-escaping", () => {
      const latexAndChineseContent = String.raw`设函数 $f(x) = \frac{1}{2}x^2$，则导数为：
$$f'(x) = x$$`;

      const longTitle = `  ${"Quantum   Mechanics ".repeat(10)}  `;
      const longSummary = `  ${"Wavefunction collapse and operator algebra.\n".repeat(10)}  `;

      const encoded = formatAssistantTurnJson({
        title: longTitle,
        summary: longSummary,
        content: latexAndChineseContent,
      });

      const parsed = replyContractSchema.parse(JSON.parse(encoded));
      expect(parsed.title.length).toBeLessThanOrEqual(120);
      expect(parsed.summary.length).toBeLessThanOrEqual(280);
      expect(parsed.content).toBe(latexAndChineseContent);

      // Single JSON encoding: raw JSON contains `\frac` escaped once (`\\frac`), never `\\\\frac`.
      expect(encoded).toContain(String.raw`\\frac{1}{2}`);
      expect(encoded).not.toContain(String.raw`\\\\frac{1}{2}`);
      expect(encoded).toContain("设函数");
      expect(Object.keys(JSON.parse(encoded))).toEqual([
        "title",
        "summary",
        "content",
      ]);
    });

    it("derives clean fallback title and summary when empty", () => {
      const encoded = formatAssistantTurnJson({
        title: "   ",
        summary: "",
        content: "## Eigenvalue Decomposition\n\nEvery symmetric matrix is orthogonally diagonalizable.",
      });

      const parsed = replyContractSchema.parse(JSON.parse(encoded));
      expect(parsed.title).toBe("Eigenvalue Decomposition");
      expect(parsed.summary).toContain("Eigenvalue Decomposition");
      expect(parsed.summary).toContain("orthogonally diagonalizable");
    });
  });

  describe("extractNodeTurns", () => {
    it("pairs multi-turn messages, uses node title/summary on the final completed pair, and derives fallbacks for earlier pairs", () => {
      const pair1Assistant = String.raw`First answer with inline math $\frac{1}{2}$.`;
      const pair2Assistant = String.raw`Second answer with $\sqrt{2}$ and 中文解释.`;

      const messages: ChatMessage[] = [
        makeMsg("u1", "user", "Explain half fractions"),
        makeMsg("a1", "assistant", pair1Assistant),
        makeMsg("u2", "user", "Now explain square roots"),
        makeMsg("a2", "assistant", pair2Assistant),
        makeMsg("u3", "user", "Unfinished pending turn"),
        makeMsg("a3", "assistant", ""),
      ];

      const turns = extractNodeTurns(
        {
          id: "node_multi",
          title: "Square Roots & Irrationals",
          summary: "Covers sqrt(2) and irrationality.",
          branchType: "continue",
        },
        messages,
        2,
      );

      expect(turns).toHaveLength(2);

      // Earlier pair derives fallback title/summary from that pair's text
      expect(turns[0]).toMatchObject({
        nodeId: "node_multi",
        nodeTitle: "Square Roots & Irrationals",
        branchType: "continue",
        depth: 2,
        userContent: "Explain half fractions",
        assistantRawContent: pair1Assistant,
      });
      const parsedTurn0 = replyContractSchema.parse(
        JSON.parse(turns[0].assistantJsonContent),
      );
      expect(parsedTurn0.title).toBe("Explain half fractions");
      expect(parsedTurn0.summary).toContain(String.raw`\frac{1}{2}`);
      expect(parsedTurn0.content).toBe(pair1Assistant);

      // Final completed pair uses node.title and node.summary
      expect(turns[1]).toMatchObject({
        nodeId: "node_multi",
        nodeTitle: "Square Roots & Irrationals",
        branchType: "continue",
        depth: 2,
        userContent: "Now explain square roots",
        assistantRawContent: pair2Assistant,
      });
      const parsedTurn1 = replyContractSchema.parse(
        JSON.parse(turns[1].assistantJsonContent),
      );
      expect(parsedTurn1.title).toBe("Square Roots & Irrationals");
      expect(parsedTurn1.summary).toBe("Covers sqrt(2) and irrationality.");
      expect(parsedTurn1.content).toBe(pair2Assistant);
    });

    it("ignores PENDING_ROOT_TITLE and PENDING_ROOT_SUMMARY if assistant content is already present", () => {
      const turns = extractNodeTurns(
        {
          id: "node_root",
          title: PENDING_ROOT_TITLE,
          summary: PENDING_ROOT_SUMMARY,
          branchType: "root",
        },
        [
          makeMsg("u1", "user", "What is Bayes' theorem?"),
          makeMsg("a1", "assistant", "Bayes' theorem updates prior probabilities."),
        ],
        0,
      );

      expect(turns).toHaveLength(1);
      expect(turns[0].nodeTitle).not.toBe(PENDING_ROOT_TITLE);
      const parsed = replyContractSchema.parse(
        JSON.parse(turns[0].assistantJsonContent),
      );
      expect(parsed.title).toBe("What is Bayes' theorem?");
      expect(parsed.summary).toBe("Bayes' theorem updates prior probabilities.");
    });
  });

  describe("extractAncestorHistory", () => {
    it("preserves rootAnchor, folds distant ancestors, and keeps recent native turns on a 7-node deep path", () => {
      let project = createRootProject(
        "Build a complete intuition for Calculus from limits to Stokes' theorem",
        {
          title: "Calculus Roadmap",
          summary: "Overview connecting limits, derivatives, integrals, and vector calculus.",
          content: String.raw`Calculus studies continuous change starting from $\lim_{x \to a} f(x)$.`,
        },
      );

      const stepSpecs = [
        {
          mode: "continue" as const,
          instruction: "Step 1: Formal epsilon-delta limits",
          title: "Epsilon-Delta Limits",
          summary: "Defines rigor via epsilon-delta neighborhoods.",
          content: String.raw`For all $\varepsilon > 0$, there exists $\delta > 0$.`,
        },
        {
          mode: "continue" as const,
          instruction: "Step 2: Derivatives as linear approximations",
          title: "Derivatives",
          summary: "Local linear approximation and tangent slopes.",
          content: String.raw`The derivative is $f'(x) = \lim_{h \to 0} \frac{f(x+h)-f(x)}{h}$.`,
        },
        {
          mode: "branch" as const,
          instruction: "Step 3: Chain rule in multivariable settings",
          title: "Multivariable Chain Rule",
          summary: "Composes Jacobian matrices across smooth maps.",
          content: String.raw`Jacobian composition: $D(g \circ f)(x) = Dg(f(x)) Df(x)$.`,
        },
        {
          mode: "continue" as const,
          instruction: "Step 4: Differential forms",
          title: "Differential Forms",
          summary: "Antisymmetric tensors unify line, surface, and volume integrands.",
          content: String.raw`Wedge product satisfies $\alpha \wedge \beta = -\beta \wedge \alpha$.`,
        },
        {
          mode: "continue" as const,
          instruction: "Step 5: Exterior derivative",
          title: "Exterior Derivative",
          summary: "Generalizes grad, curl, and div with d(d omega) = 0.",
          content: String.raw`Half-area example: $\int_C \frac{1}{2}(x\,dy - y\,dx)$ equals area.`,
        },
        {
          mode: "continue" as const,
          instruction: "Step 6: Generalized Stokes' theorem",
          title: "Generalized Stokes' Theorem",
          summary: "Integrates exterior derivatives over manifolds with boundary.",
          content: String.raw`核心公式：$$\int_{\partial M} \omega = \int_M d\omega$$ 其中系数如 $\frac{1}{2}$ 保持不变。`,
        },
      ];

      let parentId = project.rootNodeId;
      const nodeIds = [parentId];
      for (const spec of stepSpecs) {
        const added = addChildNode(project, parentId, spec.mode, spec.instruction, {
          title: spec.title,
          summary: spec.summary,
          content: spec.content,
        })!;
        project = added.project;
        parentId = added.node.id;
        nodeIds.push(parentId);
      }

      const history = extractAncestorHistory({
        project,
        ancestorNodeId: parentId,
        maxRecentFullNodes: 2,
      });

      expect(history.pathNodes).toHaveLength(7);
      expect(history.contextTitles).toEqual([
        "Calculus Roadmap",
        "Epsilon-Delta Limits",
        "Derivatives",
        "Multivariable Chain Rule",
        "Differential Forms",
        "Exterior Derivative",
        "Generalized Stokes' Theorem",
      ]);
      expect(history.contextSummaries).toHaveLength(7);
      expect(history.contextSummaries[0]).toBe(
        "Calculus Roadmap: Overview connecting limits, derivatives, integrals, and vector calculus.",
      );

      // Root anchor preserved despite 7-node depth (well past old slice(-8))
      expect(history.rootAnchor).toEqual({
        nodeId: nodeIds[0],
        title: "Calculus Roadmap",
        summary:
          "Overview connecting limits, derivatives, integrals, and vector calculus.",
        initialQuestion:
          "Build a complete intuition for Calculus from limits to Stokes' theorem",
      });

      // First 5 nodes (depths 0..4) folded into concise summaries
      expect(history.foldedAncestors).toEqual([
        {
          nodeId: nodeIds[0],
          title: "Calculus Roadmap",
          summary:
            "Overview connecting limits, derivatives, integrals, and vector calculus.",
          branchType: "root",
          depth: 0,
        },
        {
          nodeId: nodeIds[1],
          title: "Epsilon-Delta Limits",
          summary: "Defines rigor via epsilon-delta neighborhoods.",
          branchType: "continue",
          depth: 1,
        },
        {
          nodeId: nodeIds[2],
          title: "Derivatives",
          summary: "Local linear approximation and tangent slopes.",
          branchType: "continue",
          depth: 2,
        },
        {
          nodeId: nodeIds[3],
          title: "Multivariable Chain Rule",
          summary: "Composes Jacobian matrices across smooth maps.",
          branchType: "branch",
          depth: 3,
        },
        {
          nodeId: nodeIds[4],
          title: "Differential Forms",
          summary:
            "Antisymmetric tensors unify line, surface, and volume integrands.",
          branchType: "continue",
          depth: 4,
        },
      ]);

      // Last 2 nodes (depths 5 and 6) expanded as native recentTurns
      expect(history.recentTurns).toHaveLength(2);
      expect(history.recentTurns[0].nodeId).toBe(nodeIds[5]);
      expect(history.recentTurns[0].depth).toBe(5);
      expect(history.recentTurns[1].nodeId).toBe(nodeIds[6]);
      expect(history.recentTurns[1].depth).toBe(6);

      // Verify LaTeX `\frac{1}{2}` is unescaped in assistantRawContent and single-JSON-encoded in assistantJsonContent
      expect(history.recentTurns[0].assistantRawContent).toContain(
        String.raw`\frac{1}{2}`,
      );
      expect(history.recentTurns[0].assistantRawContent).not.toContain(
        String.raw`\\frac{1}{2}`,
      );
      expect(history.recentTurns[1].assistantJsonContent).toContain(
        String.raw`\\frac{1}{2}`,
      );
      expect(history.recentTurns[1].assistantJsonContent).not.toContain(
        String.raw`\\\\frac{1}{2}`,
      );
      expect(
        JSON.parse(history.recentTurns[1].assistantJsonContent).content,
      ).toBe(history.recentTurns[1].assistantRawContent);
    });

    it("never confuses duplicate node titles on the same path or across sibling branches", () => {
      let project = createRootProject("Compare sorting algorithms", {
        title: "Complexity Analysis",
        summary: "Root O(n log n) lower bound.",
        content: "Comparison sorts require Omega(n log n) comparisons.",
      });
      const rootId = project.rootNodeId;

      const siblingBranch = addChildNode(
        project,
        rootId,
        "branch",
        "Analyze QuickSort",
        {
          title: "Complexity Analysis",
          summary: "QuickSort average O(n log n), worst O(n^2).",
          content: "QuickSort pivot partitioning details.",
        },
      )!;
      project = siblingBranch.project;

      const mainContinue = addChildNode(
        project,
        rootId,
        "continue",
        "Analyze MergeSort",
        {
          title: "Complexity Analysis",
          summary: "MergeSort deterministic O(n log n) time, O(n) space.",
          content: "MergeSort divide-and-conquer details.",
        },
      )!;
      project = mainContinue.project;

      const leafContinue = addChildNode(
        project,
        mainContinue.node.id,
        "continue",
        "Analyze HeapSort",
        {
          title: "Complexity Analysis",
          summary: "HeapSort O(n log n) time, O(1) auxiliary space.",
          content: "HeapSort in-place binary heap details.",
        },
      )!;
      project = leafContinue.project;

      const extracted = extractAncestorHistory({
        project,
        ancestorNodeId: leafContinue.node.id,
        maxRecentFullNodes: 1,
      });

      expect(extracted.contextSummaries).toEqual([
        "Complexity Analysis: Root O(n log n) lower bound.",
        "Complexity Analysis: MergeSort deterministic O(n log n) time, O(n) space.",
        "Complexity Analysis: HeapSort O(n log n) time, O(1) auxiliary space.",
      ]);
      expect(extracted.foldedAncestors.map((item) => item.summary)).toEqual([
        "Root O(n log n) lower bound.",
        "MergeSort deterministic O(n log n) time, O(n) space.",
      ]);
      expect(extracted.recentTurns).toHaveLength(1);
      expect(
        JSON.parse(extracted.recentTurns[0].assistantJsonContent).summary,
      ).toBe("HeapSort O(n log n) time, O(1) auxiliary space.");
    });

    it("handles pending/blank nodes, maxRecentFullNodes = 0, and currentNodePrefixMessages during multi-turn regeneration", () => {
      // 1. Pending root node yields null rootAnchor and no completed turns
      const pendingInit = createPendingRootProject("Pending root question");
      const pendingExtracted = extractAncestorHistory({
        project: pendingInit.project,
        ancestorNodeId: pendingInit.node.id,
        maxRecentFullNodes: 2,
      });
      expect(pendingExtracted.rootAnchor).toBeNull();
      expect(pendingExtracted.foldedAncestors).toEqual([]);
      expect(pendingExtracted.recentTurns).toEqual([]);

      // 2. Path with an intermediate blank node preserves original path depth indices
      const baseProject = createRootProject("Graph Theory", {
        title: "Graphs Intro",
        summary: "Vertices and edges.",
        content: "A graph G = (V, E).",
      });
      const blankMid = addBlankChildNode(
        baseProject,
        baseProject.rootNodeId,
        "continue",
        "node_blank_mid",
      )!;
      const completedLeaf: MindNode = {
        id: "node_after_blank",
        projectId: baseProject.id,
        parentId: blankMid.node.id,
        title: "Shortest Paths",
        titleManuallyEdited: false,
        summary: "Dijkstra and Bellman-Ford.",
        messages: [
          makeMsg("u_leaf", "user", "How to find shortest paths?"),
          makeMsg("a_leaf", "assistant", "Use Dijkstra for non-negative weights."),
        ],
        children: [],
        position: { x: 120, y: 700 },
        branchType: "continue",
        collapsed: false,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      };
      const projectWithBlankMid: Project = {
        ...blankMid.project,
        nodes: {
          ...blankMid.project.nodes,
          [blankMid.node.id]: {
            ...blankMid.node,
            children: [completedLeaf.id],
          },
          [completedLeaf.id]: completedLeaf,
        },
      };

      // maxRecentFullNodes = 0 must fold ALL completed nodes (not slice(-0)!)
      const zeroRecent = extractAncestorHistory({
        project: projectWithBlankMid,
        ancestorNodeId: completedLeaf.id,
        maxRecentFullNodes: 0,
      });
      expect(zeroRecent.recentTurns).toEqual([]);
      expect(zeroRecent.foldedAncestors).toEqual([
        {
          nodeId: baseProject.rootNodeId,
          title: "Graphs Intro",
          summary: "Vertices and edges.",
          branchType: "root",
          depth: 0,
        },
        {
          nodeId: completedLeaf.id,
          title: "Shortest Paths",
          summary: "Dijkstra and Bellman-Ford.",
          branchType: "continue",
          depth: 2,
        },
      ]);

      // 3. Multi-turn regeneration appends currentNodePrefixMessages at depth = pathNodes.length
      const regeneratingChildNode = {
        id: "node_regen_target",
        title: "A* Search Heuristic",
        summary: "Admissible heuristics guarantee optimality.",
        branchType: "branch" as const,
      };
      const prefixMessages: ChatMessage[] = [
        makeMsg("p_u1", "user", "What is heuristic search?"),
        makeMsg(
          "p_a1",
          "assistant",
          "Heuristic search guides expansion with h(n).",
        ),
        makeMsg("p_u2", "user", "Incomplete trailing message"),
        makeMsg("p_a2", "assistant", "   "),
      ];

      const regenHistory = extractAncestorHistory({
        project: projectWithBlankMid,
        ancestorNodeId: completedLeaf.id,
        maxRecentFullNodes: 1,
        currentNodePrefixMessages: prefixMessages,
        currentNode: regeneratingChildNode,
      });

      expect(regenHistory.foldedAncestors).toHaveLength(1);
      expect(regenHistory.foldedAncestors[0].nodeId).toBe(baseProject.rootNodeId);
      expect(regenHistory.recentTurns).toHaveLength(2);
      expect(regenHistory.recentTurns[0]).toMatchObject({
        nodeId: completedLeaf.id,
        depth: 2,
      });
      expect(regenHistory.recentTurns[1]).toMatchObject({
        nodeId: "node_regen_target",
        nodeTitle: "A* Search Heuristic",
        branchType: "branch",
        depth: 3,
        userContent: "What is heuristic search?",
        assistantRawContent: "Heuristic search guides expansion with h(n).",
      });
    });
  });
});
