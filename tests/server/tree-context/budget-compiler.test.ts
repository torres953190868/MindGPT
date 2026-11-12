import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildMessages } from "@/lib/server/deepseek-core";
import {
  addBlankChildNode,
  addChildNode,
  createRootProject,
} from "@/lib/server/project-model";
import {
  allocateRecentTurnsWithDowngrade,
  buildTreePromptContext,
  formatAssistantTurnJson,
  formatFoldedAncestorsSlot,
  formatTreeSystemBackgroundBlock,
  formatUserMemorySlot,
  type FoldedAncestorNode,
  type NodeConversationTurn,
  type RootContextAnchor,
  type UserMemoryContextSlot,
} from "@/lib/server/tree-context";
import type { Project } from "@/lib/types";

const readProjectsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/projects-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/projects-repository")>();

  return {
    ...actual,
    getProjectsRepository: vi.fn(() => ({
      readProjects: readProjectsMock,
      readProjectsForSession: vi.fn(),
      deleteProject: vi.fn(),
      saveProject: vi.fn(),
      updateNodePositionForOwner: vi.fn(),
    })),
  };
});

import {
  prepareChildContext,
  preparePopulateBlankNodeContext,
  prepareRegenerateNodeContext,
} from "@/lib/server/projects-service";

const replyContractSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(280),
  content: z.string().trim().min(1).max(8_000),
});

function makeTurn(input: {
  nodeId: string;
  nodeTitle: string;
  summary: string;
  branchType?: "root" | "continue" | "branch";
  depth: number;
  userContent: string;
  assistantRawContent: string;
}): NodeConversationTurn {
  return {
    nodeId: input.nodeId,
    nodeTitle: input.nodeTitle,
    branchType: input.branchType ?? "continue",
    depth: input.depth,
    userContent: input.userContent,
    assistantJsonContent: formatAssistantTurnJson({
      title: input.nodeTitle,
      summary: input.summary,
      content: input.assistantRawContent,
    }),
    assistantRawContent: input.assistantRawContent,
  };
}

describe("budget-compiler & pipeline wiring (Tree Context Point 4)", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
  });

  describe("allocateRecentTurnsWithDowngrade", () => {
    it("smoothly downgrades older overflow turns into foldedAncestors without splitting user/assistant pairs", () => {
      const existingFolded: FoldedAncestorNode[] = [
        {
          nodeId: "node_0",
          title: "Root Foundations",
          summary: "Core axioms of probability.",
          branchType: "root",
          depth: 0,
        },
      ];

      const turn1 = makeTurn({
        nodeId: "node_1",
        nodeTitle: "Conditional Probability",
        summary: "Defines P(A|B) via joint probability.",
        depth: 1,
        userContent: "Explain conditional probability in detail.",
        assistantRawContent: "Conditional probability explanation ".repeat(20),
      });
      const turn2a = makeTurn({
        nodeId: "node_2",
        nodeTitle: "Bayes Theorem",
        summary: "Early derivation step.",
        depth: 2,
        userContent: "Derive Bayes theorem step 1.",
        assistantRawContent: "Step 1 derivation ".repeat(25),
      });
      const turn2b = makeTurn({
        nodeId: "node_2",
        nodeTitle: "Bayes Theorem",
        summary: "Inverts conditional probabilities using priors and likelihoods.",
        depth: 2,
        userContent: "Finish Bayes theorem derivation.",
        assistantRawContent: "Step 2 derivation ".repeat(25),
      });
      const turn3 = makeTurn({
        nodeId: "node_3",
        nodeTitle: "Posterior Updating",
        summary: "Sequential Bayesian updating with new observations.",
        depth: 3,
        userContent: "How does sequential updating work?",
        assistantRawContent: "Posterior becomes the next prior.",
      });

      const turn3Cost =
        turn3.userContent.length + turn3.assistantJsonContent.length;
      const turn2bCost =
        turn2b.userContent.length + turn2b.assistantJsonContent.length;

      // Budget fits turn3 + turn2b, forcing turn2a and turn1 to downgrade smoothly.
      const result = allocateRecentTurnsWithDowngrade({
        recentTurns: [turn1, turn2a, turn2b, turn3],
        foldedAncestors: existingFolded,
        recentTurnsBudgetChars: turn3Cost + turn2bCost + 10,
      });

      expect(result.recentTurns).toEqual([turn2b, turn3]);
      // Every kept turn has both userContent and valid assistantJsonContent.
      for (const turn of result.recentTurns) {
        expect(turn.userContent.length).toBeGreaterThan(0);
        expect(() =>
          replyContractSchema.parse(JSON.parse(turn.assistantJsonContent)),
        ).not.toThrow();
      }

      // Downgraded turns appear in foldedAncestors, deduplicated by nodeId and sorted ascending by depth.
      expect(result.foldedAncestors.map((item) => item.nodeId)).toEqual([
        "node_0",
        "node_1",
        "node_2",
      ]);
      expect(result.foldedAncestors.map((item) => item.depth)).toEqual([0, 1, 2]);
      expect(result.foldedAncestors[1]).toMatchObject({
        nodeId: "node_1",
        title: "Conditional Probability",
        summary: "Defines P(A|B) via joint probability.",
      });
      expect(result.foldedAncestors[2]).toMatchObject({
        nodeId: "node_2",
        title: "Bayes Theorem",
        summary: "Early derivation step.",
      });
    });

    it("compacts the single most recent turn rather than dropping immediate parent context when one turn exceeds a positive budget", () => {
      const olderTurn = makeTurn({
        nodeId: "node_1",
        nodeTitle: "Older Node",
        summary: "Older summary preserved as folded.",
        depth: 1,
        userContent: "Older question",
        assistantRawContent: "Older answer",
      });
      const hugeLatestTurn = makeTurn({
        nodeId: "node_2",
        nodeTitle: "Immediate Parent",
        summary: "Immediate parent key takeaway.",
        depth: 2,
        userContent: `Analyze this passage: ${"word ".repeat(150)}`,
        assistantRawContent: `Detailed breakdown: ${"analysis ".repeat(300)}`,
      });

      const budget = 420;
      const result = allocateRecentTurnsWithDowngrade({
        recentTurns: [olderTurn, hugeLatestTurn],
        foldedAncestors: [],
        recentTurnsBudgetChars: budget,
      });

      expect(result.recentTurns).toHaveLength(1);
      const compacted = result.recentTurns[0];
      expect(compacted.nodeId).toBe("node_2");
      expect(
        compacted.userContent.length + compacted.assistantJsonContent.length,
      ).toBeLessThanOrEqual(budget);
      expect(
        replyContractSchema.safeParse(JSON.parse(compacted.assistantJsonContent))
          .success,
      ).toBe(true);

      expect(result.foldedAncestors).toEqual([
        {
          nodeId: "node_1",
          title: "Older Node",
          summary: "Older summary preserved as folded.",
          branchType: "continue",
          depth: 1,
        },
      ]);
    });

    it("downgrades all turns into foldedAncestors when recentTurnsBudgetChars <= 0", () => {
      const turn1 = makeTurn({
        nodeId: "node_0",
        nodeTitle: "Root",
        summary: "Root summary.",
        branchType: "root",
        depth: 0,
        userContent: "Q0",
        assistantRawContent: "A0",
      });
      const turn2 = makeTurn({
        nodeId: "node_1",
        nodeTitle: "Child",
        summary: "Child summary.",
        branchType: "continue",
        depth: 1,
        userContent: "Q1",
        assistantRawContent: "A1",
      });

      const result = allocateRecentTurnsWithDowngrade({
        recentTurns: [turn1, turn2],
        foldedAncestors: [],
        recentTurnsBudgetChars: 0,
      });

      expect(result.recentTurns).toEqual([]);
      expect(result.foldedAncestors).toEqual([
        {
          nodeId: "node_0",
          title: "Root",
          summary: "Root summary.",
          branchType: "root",
          depth: 0,
        },
        {
          nodeId: "node_1",
          title: "Child",
          summary: "Child summary.",
          branchType: "continue",
          depth: 1,
        },
      ]);
    });
  });

  describe("formatFoldedAncestorsSlot & formatUserMemorySlot", () => {
    const rootAnchor: RootContextAnchor = {
      nodeId: "node_0",
      title: "Distributed Consensus",
      initialQuestion: "How do distributed systems agree on state under faults?",
      summary: "Frames safety, liveness, and FLP impossibility.",
    };

    const foldedAncestors: FoldedAncestorNode[] = [
      {
        nodeId: "node_0",
        title: "Distributed Consensus",
        summary: "Frames safety, liveness, and FLP impossibility.",
        branchType: "root",
        depth: 0,
      },
      {
        nodeId: "node_1",
        title: "Paxos Phases",
        summary: "Prepare/promise and accept/accepted quorum mechanics.",
        branchType: "continue",
        depth: 1,
      },
      {
        nodeId: "node_2",
        title: "Raft Leader Election",
        summary: "Randomized election timeouts and term numbers.",
        branchType: "continue",
        depth: 2,
      },
      {
        nodeId: "node_3",
        title: "Log Replication",
        summary: "AppendEntries consistency check and commit index rules.",
        branchType: "continue",
        depth: 3,
      },
    ];

    it("omits Root Anchor header when root is already expanded in keptRecentTurns", () => {
      const rootTurn = makeTurn({
        nodeId: "node_0",
        nodeTitle: "Distributed Consensus",
        summary: "Frames safety, liveness, and FLP impossibility.",
        branchType: "root",
        depth: 0,
        userContent: "How do distributed systems agree?",
        assistantRawContent: "Safety and liveness.",
      });

      expect(
        formatFoldedAncestorsSlot({
          rootAnchor,
          foldedAncestors: [],
          keptRecentTurns: [rootTurn],
          maxChars: 1000,
        }),
      ).toBe("");
    });

    it("preserves Root Anchor + closest folded ancestors with ... marker when capped by maxChars", () => {
      const full = formatFoldedAncestorsSlot({
        rootAnchor,
        foldedAncestors,
        keptRecentTurns: [],
        maxChars: 2000,
      });

      expect(full).toContain(
        "Canvas root goal (Distributed Consensus): How do distributed systems agree on state under faults? -> Frames safety, liveness, and FLP impossibility.",
      );
      expect(full).toContain("- [depth 1 | continue] Paxos Phases:");
      expect(full).toContain("- [depth 3 | continue] Log Replication:");
      // Root node is not duplicated as a `- [depth 0 | root]` bullet when covered by the Root Anchor header.
      expect(full).not.toContain("- [depth 0 | root]");

      // Constrain budget so Root Anchor + closest ancestor (depth 3) fit, dropping older middle entries.
      const tightBudget = 260;
      const capped = formatFoldedAncestorsSlot({
        rootAnchor,
        foldedAncestors,
        keptRecentTurns: [],
        maxChars: tightBudget,
      });

      expect(capped.length).toBeLessThanOrEqual(tightBudget);
      expect(capped).toContain("Canvas root goal (Distributed Consensus):");
      expect(capped).toContain("\n...\n");
      expect(capped).toContain("Log Replication");
      expect(capped).not.toContain("Paxos Phases");

      for (const tinyBudget of [0, 2, 12, 80, 140]) {
        const result = formatFoldedAncestorsSlot({
          rootAnchor,
          foldedAncestors,
          keptRecentTurns: [],
          maxChars: tinyBudget,
        });
        expect(result.length).toBeLessThanOrEqual(Math.max(0, tinyBudget));
      }
    });

    it("formats UserMemoryContextSlot cleanly and enforces maxChars", () => {
      expect(formatUserMemorySlot(undefined, 500)).toBe("");
      expect(formatUserMemorySlot({}, 500)).toBe("");
      expect(
        formatUserMemorySlot({ profileSummary: "Learner" }, 0),
      ).toBe("");

      const memory: UserMemoryContextSlot = {
        profileSummary: "Backend engineer studying distributed systems",
        preferredStyle: "Concrete state-machine timelines before formal proofs",
        concepts: [
          { concept: "Quorum intersection", status: "mastered" },
          {
            concept: "Raft figure-8 safety",
            status: "struggling",
            note: "Mixes up committing prior-term vs current-term entries",
          },
          { concept: "Linearizability", status: "learning" },
        ],
      };

      const formatted = formatUserMemorySlot(memory, 1000);
      expect(formatted).toContain(
        "Profile: Backend engineer studying distributed systems",
      );
      expect(formatted).toContain(
        "Preferred style: Concrete state-machine timelines before formal proofs",
      );
      expect(formatted).toContain("- [mastered] Quorum intersection");
      expect(formatted).toContain(
        "- [struggling] Raft figure-8 safety: Mixes up committing prior-term vs current-term entries",
      );

      const truncated = formatUserMemorySlot(memory, 150);
      expect(truncated.length).toBeLessThanOrEqual(150);
      expect(truncated.endsWith("...")).toBe(true);
    });
  });

  describe("deep 6+ hop tree end-to-end buildMessages pipeline", () => {
    function makeDeepTreeProject(): {
      project: Project;
      leafParentId: string;
    } {
      let project = createRootProject(
        "How do modern transformers train stably at scale?",
        {
          title: "Transformer Scaling Goal",
          summary: "Overview of attention, normalization, and optimization stability.",
          content: "Transformers rely on residual streams, normalization, and warmup.",
        },
      );
      project = {
        ...project,
        notes:
          '<h2>Project Invariants</h2><ul><li>Always write gradients with $\\nabla_\\theta \\mathcal{L}$</li><li>Batch size fixed at 2M tokens</li></ul><script>alert("xss")</script>',
      };

      let currentParentId = project.rootNodeId;

      const hops = [
        {
          instruction: "Step 1: Self-attention scaling",
          title: "Scaled Dot-Product",
          summary: "Dividing by sqrt(d_k) prevents softmax saturation.",
          content: "Without $1/\\sqrt{d_k}$, logits grow with dimension.",
        },
        {
          instruction: "Step 2: Pre-LN vs Post-LN",
          title: "Pre-LN Residual Stream",
          summary: "Pre-LN keeps identity gradient highway intact.",
          content: "Pre-LN places LayerNorm inside the residual branch.",
        },
        {
          instruction: "Step 3: RMSNorm & QK-Norm",
          title: "Attention Logit Stability",
          summary: "QK-Norm bounds attention entropy spikes at high LR.",
          content: "QK-Norm normalizes queries and keys prior to dot products.",
        },
        {
          instruction: "Step 4: AdamW & Weight Decay",
          title: "Decoupled Weight Decay",
          summary: "Decouples L2 regularization from adaptive second moments.",
          content: "AdamW applies weight decay directly to parameters.",
        },
        {
          instruction: "Step 5: Warmup & Cosine Schedule",
          title: "LR Schedule Dynamics",
          summary: "Linear warmup stabilizes early Adam second-moment estimates.",
          content: "Early steps have high variance in $v_t$ estimates.",
        },
      ];

      const hopNodeIds: string[] = [project.rootNodeId];
      for (const hop of hops) {
        const added = addChildNode(
          project,
          currentParentId,
          "continue",
          hop.instruction,
          {
            title: hop.title,
            summary: hop.summary,
            content: hop.content,
          },
        )!;
        project = added.project;
        currentParentId = added.node.id;
        hopNodeIds.push(currentParentId);
      }

      // Attach a side-branch with a downward continue conclusion on hop 4, and another side-branch on hop 5.
      const sideBranchA = addChildNode(
        project,
        hopNodeIds[4],
        "branch",
        "Why not standard L2 penalty inside Adam?",
        {
          title: "L2 vs Decoupled Decay",
          summary: "Adaptive gradients rescale L2 penalty inversely with gradient norm.",
          content: "Coupled L2 penalizes large-gradient weights less.",
        },
      )!;
      project = sideBranchA.project;

      const sideBranchAConclusion = addChildNode(
        project,
        sideBranchA.node.id,
        "continue",
        "What is the practical hyperparameter takeaway?",
        {
          title: "Hyperparameter Decoupling",
          summary: "Learning rate and weight decay become orthogonal knobs.",
          content: "You can tune LR without retuning lambda.",
        },
      )!;
      project = sideBranchAConclusion.project;

      const sideBranchB = addChildNode(
        project,
        hopNodeIds[5],
        "branch",
        "What happens if warmup is skipped?",
        {
          title: "Zero-Warmup Divergence",
          summary: "Early gradient spikes cause irreversible attention collapse.",
          content: "Skipping warmup spikes loss in the first 100 steps.",
        },
      )!;
      project = sideBranchB.project;

      return {
        project,
        leafParentId: currentParentId, // depth 5 (generating depth 6 = 7th node along path!)
      };
    }

    it("compiles a 6-hop continue prompt with Root Anchor, folded ancestors, side-branches, cleaned notes, user memory, and native JSON turns", () => {
      const { project, leafParentId } = makeDeepTreeProject();
      const userMemory: UserMemoryContextSlot = {
        profileSummary: "ML researcher training a 7B model",
        preferredStyle: "Concise equations + empirical failure modes",
        concepts: [
          { concept: "Scaled dot-product attention", status: "mastered" },
          {
            concept: "MuP parameterization",
            status: "learning",
            note: "Wants width-scaling intuition",
          },
        ],
      };

      const treeContext = buildTreePromptContext({
        project,
        ancestorNodeId: leafParentId,
        mode: "continue",
        userMemory,
      });

      const messages = buildMessages({
        mode: "continue",
        instruction: "Step 6: How does gradient clipping interact with warmup?",
        contextTitles: treeContext.contextSummaries,
        treeContext,
      });

      // 0. Static system prefix stays at byte offset 0; background workspace context follows.
      expect(messages[0].role).toBe("system");
      expect(messages[0].content.indexOf("You are BranchMind,")).toBe(0);
      expect(
        messages[0].content.startsWith(
          "You are BranchMind, a visual branching learning and research assistant.",
        ),
      ).toBe(true);
      expect(messages[0].content.indexOf("Workspace context:")).toBeGreaterThan(0);
      expect(messages[0].content).toContain("Workspace context:");
      expect(messages[0].content).toContain(
        "Canvas root goal (Transformer Scaling Goal): How do modern transformers train stably at scale? -> Overview of attention, normalization, and optimization stability.",
      );
      expect(messages[0].content).toContain(
        "- [depth 1 | continue] Scaled Dot-Product: Dividing by sqrt(d_k) prevents softmax saturation.",
      );
      expect(messages[0].content).toContain(
        "- [depth 2 | continue] Pre-LN Residual Stream: Pre-LN keeps identity gradient highway intact.",
      );
      // Cleaned Tiptap HTML project notes (preserving LaTeX, stripping HTML & <script>).
      expect(messages[0].content).toContain("Pinned project notes:");
      expect(messages[0].content).toContain("## Project Invariants");
      expect(messages[0].content).toContain(
        "- Always write gradients with $\\nabla_\\theta \\mathcal{L}$",
      );
      expect(messages[0].content).not.toContain("<script>");
      expect(messages[0].content).not.toContain("alert(");
      // User Memory slot rendered cleanly.
      expect(messages[0].content).toContain("User learning memory:");
      expect(messages[0].content).toContain(
        "Profile: ML researcher training a 7B model",
      );
      expect(messages[0].content).toContain("- [learning] MuP parameterization");

      // Native alternating user -> assistant multi-turn pairs for the 3 recent full nodes (depths 3, 4, 5) + final user message.
      // Total messages = 1 system + 3 * 2 history + 1 final user = 8.
      expect(messages).toHaveLength(8);
      for (let i = 1; i <= 6; i += 2) {
        expect(messages[i].role).toBe("user");
        expect(messages[i + 1].role).toBe("assistant");
        const parsedAssistant = replyContractSchema.parse(
          JSON.parse(messages[i + 1].content),
        );
        expect(parsedAssistant.content.length).toBeGreaterThan(0);
      }

      const finalUser = messages[messages.length - 1];
      expect(finalUser.role).toBe("user");
      expect(finalUser.content).toContain("Node mode: continue");
      expect(finalUser.content).toContain(
        "Mode guidance: Mode: Continue Down (mainline progression).",
      );
      expect(finalUser.content).toContain("Clarified side-branches:");
      expect(finalUser.content).toContain("Zero-Warmup Divergence");
      expect(finalUser.content).toContain(
        "L2 vs Decoupled Decay: Adaptive gradients rescale L2 penalty inversely with gradient norm. (Conclusion: Hyperparameter Decoupling: Learning rate and weight decay become orthogonal knobs.)",
      );
      expect(finalUser.content).toContain(
        "User instruction: Step 6: How does gradient clipping interact with warmup?",
      );

      // Zero JSON.stringify(history) anywhere in the compiled prompt.
      for (const message of messages) {
        expect(message.content).not.toContain("Recent node conversation:");
      }
    });

    it("focuses tightly on branch mode with sourceText: omits project notes, keeps Root Anchor, and expands only immediate parent", () => {
      const { project, leafParentId } = makeDeepTreeProject();

      const treeContext = buildTreePromptContext({
        project,
        ancestorNodeId: leafParentId,
        mode: "branch",
        hasSourceText: true,
      });

      const messages = buildMessages({
        mode: "branch",
        instruction: "Why is v_t variance so high in early steps?",
        sourceText: "Early steps have high variance in $v_t$ estimates.",
        treeContext,
      });

      expect(treeContext.pinnedProjectNotes).toBe("");
      expect(messages[0].content).not.toContain("Pinned project notes:");
      expect(messages[0].content).toContain(
        "Canvas root goal (Transformer Scaling Goal):",
      );

      // Only 1 recent node expanded (1 user + 1 assistant) -> 1 system + 2 recent + 1 final user = 4 messages.
      expect(messages).toHaveLength(4);
      expect(messages[1]).toEqual({
        role: "user",
        content: "Step 5: Warmup & Cosine Schedule",
      });
      expect(messages[2].role).toBe("assistant");
      expect(
        replyContractSchema.safeParse(JSON.parse(messages[2].content)).success,
      ).toBe(true);

      expect(messages[3].content).toContain(
        "Mode guidance: Mode: Branch Right on selected source text",
      );
      expect(messages[3].content).toContain(
        "Selected source text: Early steps have high variance in $v_t$ estimates.",
      );
    });

    it("supports legacy buildMessages calls without treeContext by pairing completed turns and keeping trailing unpaired user context", () => {
      const messages = buildMessages({
        mode: "continue",
        instruction: "Give a concrete numeric example",
        contextTitles: ["Root", "Bayes"],
        messages: [
          { role: "user", content: "What is Bayes theorem?" },
          {
            role: "assistant",
            content: "# Bayes Theorem\nP(A|B) = P(B|A)P(A)/P(B).",
          },
          { role: "user", content: "Trailing draft context" },
        ],
      });

      // 1 system + 2 paired native turns + 1 final user = 4
      expect(messages).toHaveLength(4);
      expect(messages[1]).toEqual({
        role: "user",
        content: "What is Bayes theorem?",
      });
      expect(messages[2].role).toBe("assistant");
      expect(
        replyContractSchema.safeParse(JSON.parse(messages[2].content)).success,
      ).toBe(true);
      expect(messages[3].content).toContain(
        "Prior user context: Trailing draft context",
      );
      expect(messages[3].content).not.toContain("Recent node conversation:");
    });

    it("returns empty string from formatTreeSystemBackgroundBlock when all slots are empty", () => {
      expect(formatTreeSystemBackgroundBlock(undefined)).toBe("");
    });
  });

  describe("projects-service duplicate node title resolution & treeContext wiring", () => {
    it("resolves each node's actual summary along the exact node-ID path when multiple nodes share the same title", async () => {
      let project = createRootProject("Give examples of linear maps", {
        title: "Examples",
        summary: "Root overview of linear map examples.",
        content: "Root content.",
      });
      project = {
        ...project,
        id: "project_dup_titles",
        ownerSessionId: "owner_dup",
      };
      const rootId = project.rootNodeId;

      const branchA = addChildNode(project, rootId, "branch", "2D rotation", {
        title: "Examples",
        summary: "2D rotation matrix example.",
        content: "Branch A content.",
      })!;
      project = { ...branchA.project, ownerSessionId: "owner_dup" };

      const branchB = addChildNode(project, rootId, "branch", "3D projection", {
        title: "Examples",
        summary: "3D orthogonal projection example.",
        content: "Branch B content.",
      })!;
      project = { ...branchB.project, ownerSessionId: "owner_dup" };

      const childUnderB = addChildNode(
        project,
        branchB.node.id,
        "continue",
        "Eigenvalues of projection",
        {
          title: "Examples",
          summary: "Projection eigenvalues are 0 and 1.",
          content: "Child under B content.",
        },
      )!;
      project = { ...childUnderB.project, ownerSessionId: "owner_dup" };

      const blankUnderB = addBlankChildNode(
        project,
        childUnderB.node.id,
        "continue",
      )!;
      project = { ...blankUnderB.project, ownerSessionId: "owner_dup" };

      readProjectsMock.mockResolvedValue([project]);

      const childCtx = await prepareChildContext(
        "owner_dup",
        "project_dup_titles",
        childUnderB.node.id,
        { mode: "continue", hasSourceText: false },
      );

      expect(childCtx.contextSummaries).toEqual([
        "Examples: Root overview of linear map examples.",
        "Examples: 3D orthogonal projection example.",
        "Examples: Projection eigenvalues are 0 and 1.",
      ]);
      expect(childCtx.treeContext.contextSummaries).toEqual(
        childCtx.contextSummaries,
      );
      expect(childCtx.treeContext.sideBranches).toEqual([
        expect.objectContaining({
          nodeId: branchA.node.id,
          summary: "2D rotation matrix example.",
        }),
      ]);

      const populateCtx = await preparePopulateBlankNodeContext(
        "owner_dup",
        "project_dup_titles",
        blankUnderB.node.id,
        { instruction: "Populate next example" },
      );
      expect(populateCtx.contextSummaries).toEqual([
        "Examples: Root overview of linear map examples.",
        "Examples: 3D orthogonal projection example.",
        "Examples: Projection eigenvalues are 0 and 1.",
      ]);
      expect(populateCtx.treeContext.mode).toBe("continue");

      const regenTargetAssistant = childUnderB.node.messages.find(
        (m) => m.role === "assistant",
      )!;
      const regenCtx = await prepareRegenerateNodeContext(
        "owner_dup",
        "project_dup_titles",
        childUnderB.node.id,
        { assistantMessageId: regenTargetAssistant.id },
      );
      expect(regenCtx.contextSummaries).toEqual([
        "Examples: Root overview of linear map examples.",
        "Examples: 3D orthogonal projection example.",
      ]);
      expect(regenCtx.treeContext.recentTurns).toHaveLength(2);
    });
  });
});
