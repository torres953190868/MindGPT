import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment, ChatMessage, Project } from "@/lib/types";

const storedProjects = vi.hoisted(() => ({ list: [] as Project[] }));

vi.mock("@/lib/server/projects-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/projects-repository")>();

  return {
    ...actual,
    getProjectsRepository: vi.fn(() => ({
      readProjects: vi.fn(async () => storedProjects.list),
      readProjectsForSession: vi.fn(async (ownerId: string) =>
        storedProjects.list.filter((p) => p.ownerSessionId === ownerId),
      ),
      deleteProject: vi.fn(async (projectId: string) => {
        storedProjects.list = storedProjects.list.filter((p) => p.id !== projectId);
      }),
      saveProject: vi.fn(async (project: Project) => {
        const index = storedProjects.list.findIndex((p) => p.id === project.id);
        if (index >= 0) {
          storedProjects.list[index] = project;
        } else {
          storedProjects.list.push(project);
        }
      }),
      updateNodePositionForOwner: vi.fn(async () => null),
    })),
  };
});

import {
  addChildNode,
  createPendingRootProject,
  createRootProject,
  PENDING_ROOT_SUMMARY,
  PENDING_ROOT_TITLE,
} from "@/lib/server/project-model";
import {
  createBlankChildNodeForOwner,
  createChildNodeForOwner,
  createProjectForOwner,
  populateBlankNodeForOwner,
  prepareChildContext,
  preparePopulateBlankNodeContext,
  prepareRegenerateNodeContext,
} from "@/lib/server/projects-service";
import {
  buildContextualizedRetrievalQuery,
  collectInheritedKnowledgeAttachments,
  MAX_RETRIEVAL_QUERY_CHARS,
} from "@/lib/server/tree-context";

function makePdfAttachment(id: string, documentId: string): ChatAttachment {
  return {
    id,
    name: `${documentId}.pdf`,
    mimeType: "application/pdf",
    size: 1024,
    createdAt: "2026-08-01T00:00:00.000Z",
    documentId,
    documentStatus: "indexed",
  };
}

function makeCurriculumAttachment(id: string, curriculumId: string): ChatAttachment {
  return {
    id,
    name: `Course ${curriculumId}`,
    mimeType: "application/x-branchmind-curriculum",
    size: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    curriculumId,
  };
}

function makePlainAttachment(id: string): ChatAttachment {
  return {
    id,
    name: "screenshot.png",
    mimeType: "image/png",
    size: 512,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeMessage(
  id: string,
  role: ChatMessage["role"],
  content: string,
  attachments: ChatAttachment[] = [],
): ChatMessage {
  return {
    id,
    role,
    content,
    attachments,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("attachment-inheritance & contextualized retrieval query", () => {
  beforeEach(() => {
    storedProjects.list = [];
  });

  describe("collectInheritedKnowledgeAttachments", () => {
    it("inherits root-attached PDF and curriculum across Continue Down and Branch Right 3+ hops deep", () => {
      const rootPdf = makePdfAttachment("att_root_pdf", "doc_transformer");
      const rootCur = makeCurriculumAttachment("att_root_cur", "cur_dl_101");
      const nonKnowledge = makePlainAttachment("att_plain");

      let project = createRootProject(
        "Explain Transformer architecture",
        {
          title: "Transformer Architecture",
          summary: "Encoder-decoder model built around self-attention.",
          content: "Transformers replace recurrence with multi-head attention.",
        },
        [rootPdf, rootCur, nonKnowledge],
      );
      const rootId = project.rootNodeId;

      // Sibling branch with an unrelated PDF (must NOT leak into main lineage)
      const siblingBranch = addChildNode(
        project,
        rootId,
        "branch",
        "Compare with RNN",
        {
          title: "RNN Comparison",
          summary: "Sequential bottlenecks in RNNs.",
          content: "RNNs process tokens sequentially.",
        },
        [makePdfAttachment("att_sibling_pdf", "doc_rnn_unrelated")],
      )!;
      project = siblingBranch.project;

      // Hop 1: Continue Down (no attachments)
      const hop1 = addChildNode(
        project,
        rootId,
        "continue",
        "Dive into Scaled Dot-Product Attention",
        {
          title: "Scaled Dot-Product Attention",
          summary: "Computes softmax(QK^T / sqrt(d_k))V.",
          content: "Dot products are scaled by 1/sqrt(d_k).",
        },
        [],
      )!;
      project = hop1.project;

      // Hop 2: Branch Right (no attachments)
      const hop2 = addChildNode(
        project,
        hop1.node.id,
        "branch",
        "Why does large d_k saturate softmax?",
        {
          title: "Softmax Saturation Variance",
          summary: "Dot product variance grows as d_k when q, k have unit variance.",
          content: "Variance analysis of q dot k.",
        },
        [],
      )!;
      project = hop2.project;

      // Hop 3: Continue Down (no attachments)
      const hop3 = addChildNode(
        project,
        hop2.node.id,
        "continue",
        "Show a numerical example",
        {
          title: "Numerical Variance Example",
          summary: "Concrete example for d_k = 64.",
          content: "With d_k = 64, std is 8.",
        },
        [],
      )!;
      project = hop3.project;

      // Generating Hop 4 off Hop 3 (4 hops deep from root) with explicitAttachments = []
      const inherited = collectInheritedKnowledgeAttachments({
        project,
        ancestorNodeId: hop3.node.id,
        explicitAttachments: [],
      });

      expect(inherited).toEqual([rootPdf, rootCur]);
      expect(
        inherited.some((att) => att.documentId === "doc_rnn_unrelated"),
      ).toBe(false);
    });

    it("orders closest context first and deduplicates against explicitAttachments and currentNodePrefixMessages", () => {
      const pdfRoot = makePdfAttachment("att_root", "doc_root");
      const curRoot = makeCurriculumAttachment("att_cur_root", "cur_root");
      const pdfHop1 = makePdfAttachment("att_hop1", "doc_hop1");
      const pdfHop2Early = makePdfAttachment("att_hop2_early", "doc_hop2_early");
      const pdfHop2Late = makePdfAttachment("att_hop2_late", "doc_hop2_late");
      const pdfPrefix1 = makePdfAttachment("att_prefix1", "doc_prefix1");
      const pdfPrefix2 = makePdfAttachment("att_prefix2", "doc_prefix2");
      const pdfExplicit = makePdfAttachment("att_explicit", "doc_hop1");
      const curExplicit = makeCurriculumAttachment("att_cur_explicit", "cur_root");

      let project = createRootProject(
        "Root topic",
        {
          title: "Root",
          summary: "Root summary",
          content: "Root content",
        },
        [pdfRoot, curRoot],
      );
      const rootId = project.rootNodeId;

      const hop1 = addChildNode(
        project,
        rootId,
        "continue",
        "Hop 1",
        {
          title: "Hop 1",
          summary: "Hop 1 summary",
          content: "Hop 1 content",
        },
        [pdfHop1],
      )!;
      project = hop1.project;

      const hop2 = addChildNode(
        project,
        hop1.node.id,
        "branch",
        "Hop 2 first turn",
        {
          title: "Hop 2",
          summary: "Hop 2 summary",
          content: "Hop 2 content",
        },
        [pdfHop2Early],
      )!;
      project = hop2.project;

      // Add a second turn inside hop2 with a newer PDF + duplicate of pdfRoot
      project.nodes[hop2.node.id] = {
        ...project.nodes[hop2.node.id],
        messages: [
          ...project.nodes[hop2.node.id].messages,
          makeMessage("u_hop2_2", "user", "Hop 2 second turn", [
            pdfHop2Late,
            makePdfAttachment("att_root_reattached", "doc_root"),
          ]),
          makeMessage("a_hop2_2", "assistant", "Hop 2 second answer"),
        ],
      };

      const prefixMessages: ChatMessage[] = [
        makeMessage("u_cur_1", "user", "Turn 1 in current node", [pdfPrefix1]),
        makeMessage("a_cur_1", "assistant", "Answer 1"),
        makeMessage("u_cur_2", "user", "Turn 2 in current node", [
          pdfPrefix2,
          makePdfAttachment("att_dup_hop2_early", "doc_hop2_early"),
        ]),
        makeMessage("a_cur_2", "assistant", "Answer 2"),
      ];

      const inherited = collectInheritedKnowledgeAttachments({
        project,
        ancestorNodeId: hop2.node.id,
        explicitAttachments: [pdfExplicit, curExplicit],
        currentNodePrefixMessages: prefixMessages,
      });

      // Expected order:
      // 1. currentNodePrefixMessages latest -> earliest: doc_prefix2, doc_hop2_early, doc_prefix1
      // 2. hop2 latest -> earliest: doc_hop2_late, doc_root (doc_hop2_early already seen)
      // 3. hop1: doc_hop1 skipped because it is in explicitAttachments
      // 4. root: doc_root already seen, cur_root skipped because it is in explicitAttachments
      expect(
        inherited.map((att) => att.documentId ?? att.curriculumId),
      ).toEqual([
        "doc_prefix2",
        "doc_hop2_early",
        "doc_prefix1",
        "doc_hop2_late",
        "doc_root",
      ]);
    });
  });

  describe("clean persisted child node attachments & projects-service integration", () => {
    it("inherits root attachments during prepareChildContext, populate, and regenerate while keeping child node stored attachments []", async () => {
      const ownerId = "owner_inheritance_test";
      const rootPdf = makePdfAttachment("att_pdf_main", "doc_attention");
      const rootCur = makeCurriculumAttachment("att_cur_main", "cur_attention");

      const created = await createProjectForOwner(
        ownerId,
        "Attention mechanisms",
        {
          title: "Attention Is All You Need",
          summary: "Sequence transduction model based on self-attention.",
          content: "Self-attention relates positions of a single sequence.",
        },
        [rootPdf, rootCur],
      );
      const projectId = created.project.id;
      const rootNodeId = created.project.rootNodeId;

      // 1. Continue Down child with empty attachments []
      const childContext = await prepareChildContext(ownerId, projectId, rootNodeId, {
        mode: "continue",
        explicitAttachments: [],
        instruction: "举个例子",
      });
      expect(childContext.inheritedAttachments).toEqual([rootPdf, rootCur]);
      expect(childContext.retrievalQuery).toContain("举个例子");
      expect(childContext.retrievalQuery).toContain("Attention Is All You Need");

      const childCreated = await createChildNodeForOwner(
        ownerId,
        projectId,
        rootNodeId,
        "continue",
        "举个例子",
        {
          title: "Scaled Dot-Product Example",
          summary: "3-token query-key matrix multiplication example.",
          content: "Suppose Q and K are 3x4 matrices...",
        },
        [],
      );
      expect(childCreated.node.messages[0].attachments).toEqual([]);

      // 2. Blank Branch Right node populated off childCreated (2 hops deep)
      const blankCreated = await createBlankChildNodeForOwner(
        ownerId,
        projectId,
        childCreated.node.id,
        "branch",
      );
      const populateContext = await preparePopulateBlankNodeContext(
        ownerId,
        projectId,
        blankCreated.node.id,
        {
          instruction: "为什么这里要除以根号 d？",
          attachments: [],
        },
      );
      expect(populateContext.attachments).toEqual([]);
      expect(populateContext.inheritedAttachments).toEqual([rootPdf, rootCur]);
      expect(populateContext.retrievalQuery).toContain("为什么这里要除以根号 d？");
      expect(populateContext.retrievalQuery).toContain("Scaled Dot-Product Example");
      expect(populateContext.retrievalQuery).toContain("Attention Is All You Need");

      const populated = await populateBlankNodeForOwner(
        ownerId,
        projectId,
        blankCreated.node.id,
        "为什么这里要除以根号 d？",
        {
          title: "Scaling Factor 1/sqrt(d_k)",
          summary: "Keeps dot-product variance at 1 before softmax.",
          content: "Without scaling, softmax gradients vanish.",
        },
        [],
      );
      expect(populated.node.messages[0].attachments).toEqual([]);

      // 3. Regenerate populated node — still inherits root attachments without mutating node
      const regenerateContext = await prepareRegenerateNodeContext(
        ownerId,
        projectId,
        populated.node.id,
        {
          instruction: "Give the variance proof step by step",
        },
      );
      expect(regenerateContext.attachments).toEqual([]);
      expect(regenerateContext.inheritedAttachments).toEqual([rootPdf, rootCur]);
      expect(regenerateContext.retrievalQuery).toContain(
        "Give the variance proof step by step",
      );
      expect(regenerateContext.retrievalQuery).toContain(
        "Scaled Dot-Product Example",
      );
    });
  });

  describe("buildContextualizedRetrievalQuery", () => {
    it("enriches short follow-ups with parent title/summary and distinct root title", () => {
      let project = createRootProject("Transformers", {
        title: "Transformer Architecture",
        summary: "Replaces recurrence with multi-head self-attention.",
        content: "Root content.",
      });
      const rootId = project.rootNodeId;

      const parent = addChildNode(
        project,
        rootId,
        "continue",
        "Explain attention formula",
        {
          title: "Scaled Dot-Product Attention",
          summary:
            "Computes Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V to prevent softmax saturation.",
          content: "Parent content.",
        },
      )!;
      project = parent.project;

      const zhQuery = buildContextualizedRetrievalQuery({
        project,
        ancestorNodeId: parent.node.id,
        instruction: "举个例子",
      });
      expect(zhQuery).toContain("举个例子");
      expect(zhQuery).toContain(
        "Scaled Dot-Product Attention: Computes Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V to prevent softmax saturation.",
      );
      expect(zhQuery).toContain("Transformer Architecture");
      expect(zhQuery.length).toBeLessThanOrEqual(MAX_RETRIEVAL_QUERY_CHARS);

      const enQuery = buildContextualizedRetrievalQuery({
        project,
        ancestorNodeId: parent.node.id,
        instruction: "Why divide by sqrt(d_k)?",
      });
      expect(enQuery).toContain("Why divide by sqrt(d_k)?");
      expect(enQuery).toContain("Scaled Dot-Product Attention:");
      expect(enQuery).toContain("Transformer Architecture");
      expect(enQuery.length).toBeLessThanOrEqual(MAX_RETRIEVAL_QUERY_CHARS);
    });

    it("stays compact (<= 480 chars) when instruction and sourceText are long while still retaining parent.title", () => {
      let project = createRootProject("Deep Learning", {
        title: "Deep Learning Optimization",
        summary: "Stochastic gradient methods for deep networks.",
        content: "Root content.",
      });
      const parent = addChildNode(
        project,
        project.rootNodeId,
        "branch",
        "Explain AdamW",
        {
          title: "Decoupled Weight Decay (AdamW)",
          summary:
            "Separates L2 weight decay from adaptive gradient rescaling in Adam.",
          content: "Parent content.",
        },
      )!;
      project = parent.project;

      const longInstruction =
        "Compare how adaptive moment estimation interacts with L2 regularization versus decoupled weight decay across different learning rate schedules and warmup horizons. ".repeat(
          3,
        );
      const longSourceText =
        "In standard Adam, L2 regularization modifies the gradient before moving averages m_t and v_t are computed, coupling regularization strength to gradient magnitude. ".repeat(
          3,
        );

      const query = buildContextualizedRetrievalQuery({
        project,
        ancestorNodeId: parent.node.id,
        instruction: longInstruction,
        sourceText: longSourceText,
      });

      expect(query.length).toBeLessThanOrEqual(MAX_RETRIEVAL_QUERY_CHARS);
      expect(query).toContain("Decoupled Weight Decay (AdamW)");
      expect(query).toContain("Deep Learning Optimization");
    });

    it("skips PENDING_ROOT_TITLE and PENDING_ROOT_SUMMARY placeholders", () => {
      const pending = createPendingRootProject("Initial streaming topic");

      const query = buildContextualizedRetrievalQuery({
        project: pending.project,
        ancestorNodeId: pending.node.id,
        instruction: "举个例子",
      });

      expect(query).toBe("举个例子");
      expect(query).not.toContain(PENDING_ROOT_TITLE);
      expect(query).not.toContain(PENDING_ROOT_SUMMARY);
    });
  });
});
