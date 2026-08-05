import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  TUTOR_CONTEXT_MAX_CHARS,
  type TutorAgentInput,
} from "@/lib/agents/tutor/tutor-agent";
import {
  createCurriculumModule,
  createCurriculumNode,
  createValidCurriculumDraft,
} from "../../curriculum/fixtures";

describe("Tutor system rules", () => {
  it("includes the ten required curriculum-boundary semantics", () => {
    const input = {
      request: { message: "继续" },
      context: { currentNode: null, path: { nodes: [] } },
      session: {} ,
      recentMessages: [],
      sources: [],
    } as unknown as TutorAgentInput;
    const prompt = buildPrompt(input);

    expect(prompt).toContain("教材决定讲什么");
    expect(prompt).toContain("Skill 只决定怎么讲");
    expect(prompt).toContain("前置知识尚未完成的锁定节点");
    expect(prompt).toContain("可审查的学习证据");
    expect(prompt).toContain("教材内容不足时要明确指出");
    expect(prompt).toContain("课程外补充");
    expect(prompt).toContain("不能自动加入教材");
    expect(prompt).toContain("不能越权解锁节点");
    expect(prompt).toContain("TutorResponse 结构");
  });

  it("injects prioritized course, graph, session, mastery and error context with a size cap", () => {
    const draft = createValidCurriculumDraft();
    const node = { ...draft.modules[0].nodes[0], moduleOrderIndex: 0 };
    const prompt = buildPrompt({
      request: { message: "继续" },
      context: {
        currentNode: node,
        version: { draft },
        progress: [{
          nodeId: node.clientId,
          masteryScore: 0.42,
          status: "needs_review",
        }],
        path: {
          nodes: [{ nodeId: node.clientId, title: node.title, status: "needs_review", reason: "Review" }],
        },
      },
      session: { summary: "学习者已理解定义，但在应用题上反复出错。" },
      recentMessages: [],
      recentErrors: ["混淆必要条件与充分条件"],
      sources: [{ sourceId: "source-1", chunkId: "chunk-1", excerpt: "课程资料摘录" }],
    } as unknown as TutorAgentInput);

    expect(prompt).toContain("课程元信息");
    expect(prompt).toContain("模块/节点大纲");
    expect(prompt).toContain("直接前置");
    expect(prompt).toContain("直接后继");
    expect(prompt).toContain("会话摘要");
    expect(prompt).toContain("0.42");
    expect(prompt).toContain("混淆必要条件");
    expect(prompt.length).toBeLessThanOrEqual(TUTOR_CONTEXT_MAX_CHARS);
  });

  it("truncates oversized context by priority, keeping the current node intact", () => {
    const draft = createValidCurriculumDraft();
    // Bulk up the outline (mid-priority section) with extra modules/nodes.
    for (let moduleIndex = 0; moduleIndex < 6; moduleIndex += 1) {
      draft.modules.push(
        createCurriculumModule({
          clientId: `extra-module-${moduleIndex}`,
          title: `扩展模块-${moduleIndex}`,
          orderIndex: 10 + moduleIndex,
          required: false,
          nodes: Array.from({ length: 8 }, (_, nodeIndex) =>
            createCurriculumNode({
              clientId: `extra-node-${moduleIndex}-${nodeIndex}`,
              title: `扩展节点标题-${moduleIndex}-${nodeIndex}-用于撑大大纲的低优先级内容`,
              orderIndex: nodeIndex,
            }),
          ),
        }),
      );
    }

    const objectives = Array.from(
      { length: 6 },
      (_, index) => `当前节点学习目标-${index}-必须在截断后完整保留`,
    );
    const completionCriteria = Array.from(
      { length: 3 },
      (_, index) => `当前节点完成标准-${index}-必须在截断后完整保留`,
    );
    const node = {
      ...draft.modules[1].nodes[0],
      moduleOrderIndex: 1,
      summary: `当前节点详细摘要-${"必须完整保留。".repeat(60)}`,
      learningObjectives: objectives,
      completionCriteria,
    };

    const eligibleMarker = "可学习节点标题-这些低优先级内容应被截掉";
    const historyMarker = "历史消息标记-这些最低优先级内容应被截掉";
    const prompt = buildPrompt({
      request: { message: "继续" },
      context: {
        currentNode: node,
        version: { draft },
        progress: [{ nodeId: node.clientId, masteryScore: 0.5, status: "in_progress" }],
        path: {
          nodes: Array.from({ length: 30 }, (_, index) => ({
            nodeId: `eligible-${index}`,
            title: `${eligibleMarker}-${index}-${"填".repeat(1_400)}`,
            status: "available",
            reason: "Prerequisites completed",
          })),
        },
      },
      session: { summary: "会话摘要标记-学习者已掌握定义，应用题仍需练习。" },
      recentMessages: Array.from({ length: 12 }, (_, index) => ({
        role: "user",
        blocks: [{ type: "explanation", markdown: `${historyMarker}-${index}-${"长".repeat(3_000)}` }],
      })),
      sources: [],
      recentErrors: ["混淆必要条件与充分条件"],
    } as unknown as TutorAgentInput);

    expect(prompt.length).toBeLessThanOrEqual(TUTOR_CONTEXT_MAX_CHARS);
    // High-priority sections survive in full: the current node context is
    // never partially truncated.
    expect(prompt).toContain(node.summary);
    for (const objective of objectives) expect(prompt).toContain(objective);
    for (const criterion of completionCriteria) expect(prompt).toContain(criterion);
    // Mid-priority sections that still fit are kept.
    expect(prompt).toContain("模块/节点大纲");
    expect(prompt).toContain("会话摘要标记");
    // Low-priority sections are cut first once the cap is reached.
    expect(prompt).not.toContain("Eligible 节点");
    expect(prompt).not.toContain(eligibleMarker);
    expect(prompt).not.toContain("最近消息");
    expect(prompt).not.toContain(historyMarker);
    expect(prompt).not.toContain("学习者请求");
  });
});

describe("Tutor dependency constraints (spec §15.5)", () => {
  const tutorAgentSource = readFileSync(
    join(process.cwd(), "lib/agents/tutor/tutor-agent.ts"),
    "utf8",
  );

  it("does not import open web search or web fetcher modules", () => {
    const importSpecifiers = [...tutorAgentSource.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(importSpecifiers.length).toBeGreaterThan(0);
    for (const specifier of importSpecifiers) {
      expect(specifier).not.toMatch(/web-search-provider|safe-web-fetcher|tavily/i);
    }
    expect(tutorAgentSource).not.toMatch(/tavily/i);
  });
});
