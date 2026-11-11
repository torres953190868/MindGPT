import { describe, expect, it } from "vitest";
import {
  addBlankChildNode,
  addChildNode,
  createRootProject,
  PENDING_ROOT_SUMMARY,
  PENDING_ROOT_TITLE,
} from "@/lib/server/project-model";
import {
  DEFAULT_SIDE_BRANCH_ROLLUP_MAX_CHARS,
  extractSideBranchRollup,
  formatSideBranchRollup,
} from "@/lib/server/tree-context/side-branch-rollup";
import type { SideBranchInsight } from "@/lib/server/tree-context/types";
import type { MindNode, Project } from "@/lib/types";

function appendNode(
  project: Project,
  parentId: string,
  mode: "continue" | "branch",
  title: string,
  summary: string,
  content = `${title} full answer.`,
): { project: Project; node: MindNode } {
  const result = addChildNode(project, parentId, mode, `Ask about ${title}`, {
    title,
    summary,
    content,
  });
  if (!result) {
    throw new Error(`Failed to append ${mode} child to ${parentId}`);
  }
  return result;
}

describe("extractSideBranchRollup", () => {
  it("returns empty array for null/missing ancestor or non-positive limits", () => {
    const project = createRootProject("Transformers", {
      title: "Transformer Overview",
      summary: "Self-attention processes tokens in parallel.",
      content: "Overview content.",
    });
    const withBranch = appendNode(
      project,
      project.rootNodeId,
      "branch",
      "Positional Encoding",
      "Injects token order via sinusoidal or rotary embeddings.",
    ).project;

    expect(
      extractSideBranchRollup({
        project: withBranch,
        ancestorNodeId: null,
        lookbackDepth: 3,
        maxBranches: 5,
      }),
    ).toEqual([]);

    expect(
      extractSideBranchRollup({
        project: withBranch,
        ancestorNodeId: "node_does_not_exist",
        lookbackDepth: 3,
        maxBranches: 5,
      }),
    ).toEqual([]);

    expect(
      extractSideBranchRollup({
        project: withBranch,
        ancestorNodeId: withBranch.rootNodeId,
        lookbackDepth: 0,
        maxBranches: 5,
      }),
    ).toEqual([]);

    expect(
      extractSideBranchRollup({
        project: withBranch,
        ancestorNodeId: withBranch.rootNodeId,
        lookbackDepth: 3,
        maxBranches: 0,
      }),
    ).toEqual([]);
  });

  it("collects completed side-branches from immediate parent backward in deterministic order", () => {
    let project = createRootProject("Distributed Consensus", {
      title: "Consensus Foundations",
      summary: "State machine replication across fault-tolerant replicas.",
      content: "Root explanation.",
    });
    const rootId = project.rootNodeId;

    const rootB1 = appendNode(
      project,
      rootId,
      "branch",
      "FLP Impossibility",
      "Deterministic async consensus cannot guarantee liveness with one crash.",
    );
    project = rootB1.project;

    const rootB2 = appendNode(
      project,
      rootId,
      "branch",
      "Split Brain",
      "Quorum intersection prevents two leaders in the same term.",
    );
    project = rootB2.project;

    const step1 = appendNode(
      project,
      rootId,
      "continue",
      "Raft Leader Election",
      "Randomized timeouts elect a term leader by majority vote.",
    );
    project = step1.project;

    const step1B1 = appendNode(
      project,
      step1.node.id,
      "branch",
      "Pre-Vote Extension",
      "Prevents partitioned nodes from inflating term numbers.",
    );
    project = step1B1.project;

    const step1B2 = appendNode(
      project,
      step1.node.id,
      "branch",
      "Log Up-to-Date Check",
      "Voters reject candidates with older lastLogTerm or shorter logs.",
    );
    project = step1B2.project;

    const step2 = appendNode(
      project,
      step1.node.id,
      "continue",
      "Log Replication",
      "Leader appends entries and commits once replicated to a majority.",
    );
    project = step2.project;

    const step2B1 = appendNode(
      project,
      step2.node.id,
      "branch",
      "Figure 8 Safety",
      "Leaders only commit entries from their current term directly.",
    );
    project = step2B1.project;

    const depth1 = extractSideBranchRollup({
      project,
      ancestorNodeId: step2.node.id,
      lookbackDepth: 1,
      maxBranches: 10,
    });
    expect(depth1).toEqual([
      {
        nodeId: step2B1.node.id,
        parentNodeId: step2.node.id,
        parentTitle: "Log Replication",
        title: "Figure 8 Safety",
        summary: "Leaders only commit entries from their current term directly.",
      },
    ]);

    const depth2 = extractSideBranchRollup({
      project,
      ancestorNodeId: step2.node.id,
      lookbackDepth: 2,
      maxBranches: 10,
    });
    expect(depth2.map((item) => item.title)).toEqual([
      "Figure 8 Safety",
      "Pre-Vote Extension",
      "Log Up-to-Date Check",
    ]);

    const depth3 = extractSideBranchRollup({
      project,
      ancestorNodeId: step2.node.id,
      lookbackDepth: 3,
      maxBranches: 10,
    });
    expect(depth3.map((item) => item.title)).toEqual([
      "Figure 8 Safety",
      "Pre-Vote Extension",
      "Log Up-to-Date Check",
      "FLP Impossibility",
      "Split Brain",
    ]);
    expect(depth3[3]).toMatchObject({
      nodeId: rootB1.node.id,
      parentNodeId: rootId,
      parentTitle: "Consensus Foundations",
    });
  });

  it("excludes excludeNodeId, blank/pending branches, continue siblings, and duplicate IDs", () => {
    let project = createRootProject("Compilers", {
      title: "SSA Form",
      summary: "Each variable is assigned exactly once.",
      content: "SSA overview.",
    });
    const rootId = project.rootNodeId;

    // 1. Continue sibling (should NOT be treated as a side-branch)
    const contSibling = appendNode(
      project,
      rootId,
      "continue",
      "Dominator Trees",
      "Computes dominance frontiers for phi placement.",
    );
    project = contSibling.project;

    // 2. Blank unpopulated branch (messages: [])
    const blankBranch = addBlankChildNode(project, rootId, "branch", "node_branch_blank");
    if (!blankBranch) throw new Error("Failed to add blank branch");
    project = blankBranch.project;

    // 3. Pending placeholder branch with PENDING_ROOT_TITLE / PENDING_ROOT_SUMMARY and empty assistant message
    const pendingEmptyId = "node_branch_pending_empty";
    project = {
      ...project,
      nodes: {
        ...project.nodes,
        [rootId]: {
          ...project.nodes[rootId],
          children: [...project.nodes[rootId].children, pendingEmptyId],
        },
        [pendingEmptyId]: {
          ...blankBranch.node,
          id: pendingEmptyId,
          title: PENDING_ROOT_TITLE,
          summary: PENDING_ROOT_SUMMARY,
          messages: [
            {
              id: "msg_u1",
              role: "user",
              content: "What is a phi node?",
              attachments: [],
              createdAt: "2026-11-11T00:00:00.000Z",
            },
            {
              id: "msg_a1",
              role: "assistant",
              content: "   ",
              attachments: [],
              createdAt: "2026-11-11T00:00:01.000Z",
            },
          ],
        },
      },
    };

    // 4. Mid-stream placeholder still carrying PENDING_ROOT_TITLE / PENDING_ROOT_SUMMARY
    const pendingStreamingId = "node_branch_pending_streaming";
    project = {
      ...project,
      nodes: {
        ...project.nodes,
        [rootId]: {
          ...project.nodes[rootId],
          children: [...project.nodes[rootId].children, pendingStreamingId],
        },
        [pendingStreamingId]: {
          ...blankBranch.node,
          id: pendingStreamingId,
          title: PENDING_ROOT_TITLE,
          summary: PENDING_ROOT_SUMMARY,
          messages: [
            {
              id: "msg_u2",
              role: "user",
              content: "Explain register allocation",
              attachments: [],
              createdAt: "2026-11-11T00:00:00.000Z",
            },
            {
              id: "msg_a2",
              role: "assistant",
              content: '{"title":"Reg',
              attachments: [],
              createdAt: "2026-11-11T00:00:01.000Z",
            },
          ],
        },
      },
    };

    // 5. Excluded completed branch (e.g. currently regenerating)
    const excludedBranch = appendNode(
      project,
      rootId,
      "branch",
      "Critical Edges",
      "Edges from multi-successor blocks to multi-predecessor blocks.",
    );
    project = excludedBranch.project;

    // 6. Valid completed branch (with duplicate ID in parent.children to verify deduplication)
    const validBranch = appendNode(
      project,
      rootId,
      "branch",
      "Phi Functions",
      "Selects the incoming SSA value based on control-flow predecessor.",
    );
    project = validBranch.project;
    project = {
      ...project,
      nodes: {
        ...project.nodes,
        [rootId]: {
          ...project.nodes[rootId],
          children: [...project.nodes[rootId].children, validBranch.node.id],
        },
      },
    };

    const insights = extractSideBranchRollup({
      project,
      ancestorNodeId: rootId,
      excludeNodeId: excludedBranch.node.id,
      lookbackDepth: 2,
      maxBranches: 10,
    });

    expect(insights).toEqual([
      {
        nodeId: validBranch.node.id,
        parentNodeId: rootId,
        parentTitle: "SSA Form",
        title: "Phi Functions",
        summary: "Selects the incoming SSA value based on control-flow predecessor.",
      },
    ]);
  });

  it("excludes the active branch ancestor when inside a side-branch subtree while keeping sibling branches", () => {
    let project = createRootProject("Database Indexing", {
      title: "B+Tree Indexes",
      summary: "Balanced sorted tree storing records in linked leaf pages.",
      content: "B+Tree root.",
    });
    const rootId = project.rootNodeId;

    const branch1 = appendNode(
      project,
      rootId,
      "branch",
      "Write Amplification",
      "Page splits rewrite full 8KB pages on random inserts.",
    );
    project = branch1.project;

    const branch2 = appendNode(
      project,
      rootId,
      "branch",
      "Covering Indexes",
      "INCLUDE columns satisfy queries from the index without heap fetches.",
    );
    project = branch2.project;

    const branch1SubBranch = appendNode(
      project,
      branch1.node.id,
      "branch",
      "Fill Factor Tuning",
      "Leaving free space per page delays split cascades.",
    );
    project = branch1SubBranch.project;

    const branch1Continue = appendNode(
      project,
      branch1.node.id,
      "continue",
      "LSM Comparison",
      "Sequential SSTable flushes trade read amplification for faster writes.",
    );
    project = branch1Continue.project;

    // Continuing further down from inside `branch1 -> branch1Continue`:
    // `branch1` is on our own ancestor path so it MUST NOT be emitted as an external side-branch,
    // whereas `branch1SubBranch` (off `branch1`) and `branch2` (sibling branch off `root`) ARE emitted!
    const insights = extractSideBranchRollup({
      project,
      ancestorNodeId: branch1Continue.node.id,
      lookbackDepth: 3,
      maxBranches: 10,
    });

    expect(insights).toEqual([
      {
        nodeId: branch1SubBranch.node.id,
        parentNodeId: branch1.node.id,
        parentTitle: "Write Amplification",
        title: "Fill Factor Tuning",
        summary: "Leaving free space per page delays split cascades.",
      },
      {
        nodeId: branch2.node.id,
        parentNodeId: rootId,
        parentTitle: "B+Tree Indexes",
        title: "Covering Indexes",
        summary: "INCLUDE columns satisfy queries from the index without heap fetches.",
      },
    ]);
  });

  it("populates leafSummary from the deepest completed continue node and guards against cycles", () => {
    let project = createRootProject("GPU Kernels", {
      title: "Attention Memory Bottleneck",
      summary: "Materializing the NxN attention matrix saturates HBM bandwidth.",
      content: "Root content.",
    });
    const rootId = project.rootNodeId;

    // Branch 1: extended downward `b1 -> cont1 -> cont2`, plus a trailing blank continue and nested branch
    const b1 = appendNode(
      project,
      rootId,
      "branch",
      "Online Softmax",
      "Tracks running max and normalization factor across blocks.",
    );
    project = b1.project;

    // Nested side-branch under b1 should not confuse the downward continue walker
    const b1NestedBranch = appendNode(
      project,
      b1.node.id,
      "branch",
      "FP16 Overflow",
      "Subtracting block row-max keeps exponentials bounded.",
    );
    project = b1NestedBranch.project;

    // Unpopulated blank continue before completed continue should be skipped
    const b1BlankCont = addBlankChildNode(project, b1.node.id, "continue", "node_b1_cont_blank_first");
    if (!b1BlankCont) throw new Error("Failed to add blank continue");
    project = b1BlankCont.project;

    const b1Cont1 = appendNode(
      project,
      b1.node.id,
      "continue",
      "SRAM Tiling",
      "Streams K/V tiles through on-chip SRAM in single pass.",
    );
    project = b1Cont1.project;

    const b1Cont2 = appendNode(
      project,
      b1Cont1.node.id,
      "continue",
      "Backward Recomputation",
      "Recomputes attention weights from saved LSE stats instead of storing NxN.",
    );
    project = b1Cont2.project;

    const b1TrailingBlank = addBlankChildNode(
      project,
      b1Cont2.node.id,
      "continue",
      "node_b1_cont_trailing_blank",
    );
    if (!b1TrailingBlank) throw new Error("Failed to add trailing blank");
    project = b1TrailingBlank.project;

    // Introduce a synthetic cycle on b1Cont2 -> b1.id & b1Cont1.id to verify cycle protection
    project = {
      ...project,
      nodes: {
        ...project.nodes,
        [b1Cont2.node.id]: {
          ...project.nodes[b1Cont2.node.id],
          children: [b1.node.id, b1Cont1.node.id, ...project.nodes[b1Cont2.node.id].children],
        },
      },
    };

    // Branch 2: continue node has identical summary to branch -> leafSummary omitted
    const b2 = appendNode(
      project,
      rootId,
      "branch",
      "Tensor Cores",
      "Uses MMA instructions for 16x16 matrix fragments.",
    );
    project = b2.project;

    const b2SameSummaryCont = appendNode(
      project,
      b2.node.id,
      "continue",
      "Tensor Core Followup",
      "Uses MMA instructions for 16x16 matrix fragments.",
    );
    project = b2SameSummaryCont.project;

    const insights = extractSideBranchRollup({
      project,
      ancestorNodeId: rootId,
      lookbackDepth: 2,
      maxBranches: 10,
    });

    expect(insights).toEqual([
      {
        nodeId: b1.node.id,
        parentNodeId: rootId,
        parentTitle: "Attention Memory Bottleneck",
        title: "Online Softmax",
        summary: "Tracks running max and normalization factor across blocks.",
        leafSummary:
          "Backward Recomputation: Recomputes attention weights from saved LSE stats instead of storing NxN.",
      },
      {
        nodeId: b2.node.id,
        parentNodeId: rootId,
        parentTitle: "Attention Memory Bottleneck",
        title: "Tensor Cores",
        summary: "Uses MMA instructions for 16x16 matrix fragments.",
      },
    ]);
    expect("leafSummary" in insights[1]).toBe(false);
  });

  it("strictly caps results at maxBranches in priority order", () => {
    let project = createRootProject("Networking", {
      title: "TCP Congestion Control",
      summary: "Adapts sending rate to network capacity.",
      content: "Root.",
    });
    const rootId = project.rootNodeId;

    for (let i = 1; i <= 5; i += 1) {
      project = appendNode(
        project,
        rootId,
        "branch",
        `Branch ${i}`,
        `Summary for branch ${i}.`,
      ).project;
    }

    const capped = extractSideBranchRollup({
      project,
      ancestorNodeId: rootId,
      lookbackDepth: 2,
      maxBranches: 3,
    });

    expect(capped).toHaveLength(3);
    expect(capped.map((item) => item.title)).toEqual(["Branch 1", "Branch 2", "Branch 3"]);
  });
});

describe("formatSideBranchRollup", () => {
  const sampleInsights: SideBranchInsight[] = [
    {
      nodeId: "b1",
      parentNodeId: "p1",
      parentTitle: "Log Replication",
      title: "Figure 8 Safety",
      summary: "Leaders only commit entries from their current term directly.",
    },
    {
      nodeId: "b2",
      parentNodeId: "p0",
      parentTitle: "Attention Memory Bottleneck",
      title: "Online Softmax",
      summary: "Tracks running max across tiles.",
      leafSummary: "Backward Recomputation: Avoids storing NxN weights in HBM.",
    },
  ];

  it("returns empty string for empty insights or non-positive maxChars", () => {
    expect(formatSideBranchRollup([])).toBe("");
    expect(formatSideBranchRollup(sampleInsights, 0)).toBe("");
    expect(formatSideBranchRollup(sampleInsights, -25)).toBe("");
  });

  it("formats insights with and without leafSummary accurately", () => {
    const formatted = formatSideBranchRollup(sampleInsights);

    expect(formatted).toBe(
      [
        '- [From "Log Replication"] Figure 8 Safety: Leaders only commit entries from their current term directly.',
        '- [From "Attention Memory Bottleneck"] Online Softmax: Tracks running max across tiles. (Conclusion: Backward Recomputation: Avoids storing NxN weights in HBM.)',
      ].join("\n"),
    );
    expect(formatted.length).toBeLessThanOrEqual(DEFAULT_SIDE_BRANCH_ROLLUP_MAX_CHARS);
  });

  it("truncates cleanly with trailing \\n... without exceeding maxChars", () => {
    const manyInsights: SideBranchInsight[] = Array.from({ length: 10 }, (_, index) => ({
      nodeId: `b_${index + 1}`,
      parentNodeId: "root",
      parentTitle: "System Design",
      title: `Clarification ${index + 1}`,
      summary: `Detailed side-branch conclusion number ${index + 1} covering tradeoffs and invariants.`,
    }));

    const maxChars = 260;
    const formatted = formatSideBranchRollup(manyInsights, maxChars);

    expect(formatted.length).toBeLessThanOrEqual(maxChars);
    expect(formatted.endsWith("\n...")).toBe(true);
    expect(formatted).toContain('- [From "System Design"] Clarification 1:');
    expect(formatted).toContain('- [From "System Design"] Clarification 2:');
    expect(formatted).not.toContain("Clarification 5");
  });

  it("handles exact boundary fits and ultra-small maxChars budgets safely", () => {
    const single: SideBranchInsight[] = [sampleInsights[0]];
    const exactLine =
      '- [From "Log Replication"] Figure 8 Safety: Leaders only commit entries from their current term directly.';

    // Exact fit on final line should not unnecessarily truncate
    expect(formatSideBranchRollup(single, exactLine.length)).toBe(exactLine);

    // Budget smaller than even the first line falls back to ellipsis within budget
    expect(formatSideBranchRollup(single, 20)).toBe("...");
    expect(formatSideBranchRollup(single, 2)).toBe("..");
  });
});
