import { createAgentModelAdapter, type AgentModelMessage } from "@/lib/agent-runtime/model-adapter";
import { AgentBudgetTracker, TUTOR_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { createModelCallUsage } from "@/lib/agent-runtime/agent-usage";
import type { LearningContext } from "@/lib/learning/learning-service";
import {
  tutorResponseSchema,
  type LearningMessage,
  type LearningSession,
  type TeachingSkill,
  type TutorRequest,
  type TutorResponse,
} from "@/lib/learning/learning-types";
import type { SourceChunkMatch } from "@/lib/research/source-chunk-service";
import { flattenLearningNodes } from "@/lib/learning/learning-path-service";

export const TUTOR_CONTEXT_MAX_CHARS = 12_000;
export const TUTOR_CONTEXT_MAX_ELIGIBLE_NODES = 10;

export type TutorAgentInput = {
  request: TutorRequest;
  context: LearningContext;
  session: LearningSession;
  recentMessages: LearningMessage[];
  sources: SourceChunkMatch[];
  skill?: TeachingSkill;
  recentErrors?: string[];
};

function buildDeterministicResponse(input: TutorAgentInput): TutorResponse {
  const node = input.context.currentNode;
  if (!node) throw new Error("Tutor cannot run without a current node.");
  const source = input.sources[0];
  const skill = input.skill;
  const explanation =
    skill?.explanationStyle === "socratic"
      ? `先回答一个问题：你会如何用自己的话解释「${node.title}」？然后我们再一起补齐${node.learningObjectives[0] ?? "本节目标"}。`
      : skill?.explanationStyle === "formal_first"
        ? `先给出形式化框架：${node.summary}。本节需要达到的目标是：${node.learningObjectives.join("；")}。`
        : `${node.learningObjectives.join("；")}。你可以先用自己的话解释这个概念，再进入下一步。`;
  return {
    lessonGoal: node.learningObjectives[0] ?? node.summary,
    currentNodeId: node.clientId,
    blocks: [
      { type: "recap", markdown: `本节聚焦「${node.title}」：${node.summary}` },
      {
        type: "explanation",
        markdown: explanation,
      },
      {
        type: "question",
        questionId: `question-${node.clientId}`,
        markdown: input.request.message?.trim()
          ? `针对你的问题「${input.request.message.trim()}」，你认为它和「${node.title}」的关系是什么？`
          : `你认为「${node.title}」最重要的一个使用场景是什么？`,
      },
      ...(skill?.includeExercises === false
        ? []
        : [{
            type: "exercise" as const,
            exerciseId: `generated-exercise-${node.clientId}`,
            prompt: `请用自己的话解释「${node.title}」，并给出一个能体现“${node.learningObjectives[0] ?? node.title}”的例子。`,
            markdown: `练习：请完成下面的问题，然后通过“提交评估”让服务端判定掌握情况。`,
          }]),
      ...(source
        ? [{ type: "source" as const, sourceId: source.sourceId, label: "课程资料摘录" }]
        : []),
      ...(skill?.includeCode
        ? [{ type: "code" as const, language: "text", code: `# ${node.title}\n# Try the idea in a small example` }]
        : []),
    ],
    progressProposal: {
      nodeId: node.clientId,
      proposedStatus: "in_progress",
      masteryScore: 0,
      evidence: [{ type: "explanation", summary: "Tutor 已开始该节点的引导学习。" }],
      weaknesses: [],
      nextAction: "回答引导问题后继续练习。",
    },
  };
}

export function buildPrompt(input: TutorAgentInput) {
  const node = input.context.currentNode;
  const draft = input.context.version?.draft;
  const allNodes = draft ? flattenLearningNodes(draft) : [];
  const currentIndex = node ? allNodes.findIndex((candidate) => candidate.clientId === node.clientId) : -1;
  const previous = currentIndex > 0 ? allNodes[currentIndex - 1] : null;
  const next = currentIndex >= 0 ? allNodes[currentIndex + 1] : null;
  const progress = node
    ? input.context.progress?.find((entry) => entry.nodeId === node.clientId)
    : null;
  const eligible = (input.context.path?.nodes ?? [])
    .filter((entry) => entry.status !== "locked")
    .slice(0, TUTOR_CONTEXT_MAX_ELIGIBLE_NODES)
    .map((entry) => `${entry.title} [${entry.status}; ${entry.reason}]`)
    .join(" | ");
  const outline = allNodes.map((entry) => `${entry.title}(${entry.importance})`).join(" → ");
  const sources = input.sources
    .map((source) => `${source.sourceId}/${source.chunkId}: ${source.excerpt}`)
    .join("\n");
  const recentHistory = input.recentMessages
    .slice(-12)
    .map((message) => `${message.role}: ${JSON.stringify(message.blocks)}`)
    .join("\n");
  const rules = `你是 BranchMind Tutor。你必须遵守以下 10 条规则：
1. 只教授当前 enrollment 绑定的已发布课程版本。
2. 教材决定讲什么；Skill 只决定怎么讲，不能改变课程范围。
3. 不修改课程内容，不访问开放网页，只使用当前课程与授权资料。
4. 不得选择前置知识尚未完成的锁定节点。
5. 不得声称用户已经掌握，除非存在可审查的学习证据。
6. 不能直接写入 mastery/status；progressProposal 只能是建议。
7. 教材内容不足时要明确指出，不得偷偷用临时知识重写教材。
8. 超纲内容可以解释，但必须标记为“课程外补充”，且不能自动加入教材。
9. 教学内容和 progressProposal 只能围绕当前节点，不能越权解锁节点。
10. 输出必须符合 TutorResponse 结构，并让练习/问题可被服务端评估。`;
  const sections = [
    rules,
    `课程元信息：标题=${draft?.title ?? "未知"}；学习目标=${draft?.learningGoal ?? "未知"}`,
    `当前节点：${node?.title ?? "无"}\n节点摘要：${node?.summary ?? ""}\n学习目标：${node?.learningObjectives?.join("；") ?? ""}\n完成标准：${node?.completionCriteria?.join("；") ?? ""}`,
    `直接前置：${previous ? `${previous.title} — ${previous.summary}` : "无"}\n直接后继：${next ? `${next.title} — ${next.summary}` : "无"}`,
    `当前节点掌握度：${progress ? `${progress.masteryScore.toFixed(2)}（${progress.status}）` : "暂无评估"}`,
    `最近错误证据：${(input.recentErrors ?? []).slice(0, 5).join("；") || "暂无"}`,
    `模块/节点大纲：${outline || "暂无"}`,
    `会话摘要：${input.session?.summary?.trim() || "暂无"}`,
    `Eligible 节点（最多 ${TUTOR_CONTEXT_MAX_ELIGIBLE_NODES} 个）：${eligible || "暂无"}`,
    `可引用的课程来源 chunk：${sources || "暂无"}`,
    `最近消息：${recentHistory || "暂无"}`,
    `学习者请求：${input.request.message ?? "继续学习"}\n教学偏好：${JSON.stringify(input.skill ?? {})}`,
    "返回 lessonGoal、currentNodeId、blocks（recap/explanation/example/code/question/exercise/source）和可选 progressProposal。progressProposal 只能是建议，nodeId 必须是当前节点。",
  ];
  let prompt = "";
  for (const section of sections) {
    const nextPrompt = prompt ? `${prompt}\n${section}` : section;
    if (nextPrompt.length > TUTOR_CONTEXT_MAX_CHARS) break;
    prompt = nextPrompt;
  }
  return prompt;
}

export async function runTutorAgent(input: TutorAgentInput): Promise<TutorResponse> {
  const budget = new AgentBudgetTracker(TUTOR_AGENT_BUDGET);
  budget.consumeStep();
  // The current Tutor shape performs one enrolled-source lookup before one
  // model round-trip. Count that lookup here so the configured source-search
  // cap remains enforced without introducing a second orchestration loop.
  budget.consumeSearch();
  budget.assertWithinRuntime("inline");
  const adapter = createAgentModelAdapter({
    mockScript: [{ action: buildDeterministicResponse(input) }],
  });
  const contextMessages: AgentModelMessage[] = input.recentMessages.map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    content: JSON.stringify(message.blocks),
  }));
  if (input.request.message?.trim()) {
    contextMessages.push({ role: "user", content: input.request.message.trim() });
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const runtimeLimit = TUTOR_AGENT_BUDGET.maxRuntimeMs ?? 90_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AgentError("Tutor agent runtime budget exhausted.", {
        code: "AGENT_BUDGET_EXHAUSTED",
        expose: true,
        retryable: false,
        status: 500,
        details: { dimension: "maxRuntimeMs", used: runtimeLimit, limit: runtimeLimit },
      }));
    }, runtimeLimit);
  });
  try {
    const result = await Promise.race([
      adapter.completeAction({
        task: "tutor_chat",
        systemPrompt: buildPrompt(input),
        contextMessages,
        actionSchema: tutorResponseSchema,
        maxOutputTokens: TUTOR_AGENT_BUDGET.maxOutputTokensPerCall,
        signal: controller.signal,
      }),
      timeout,
    ]);
    const durationMs = Date.now() - startedAt;
    budget.consumeTokens(result.usage.promptTokens);
    budget.consumeOutputTokens(result.usage.completionTokens);
    budget.recordModelCall(createModelCallUsage({
      provider: result.provider,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      cacheHitTokens: result.usage.promptCacheHitTokens,
      cacheMissTokens: result.usage.promptCacheMissTokens,
      durationMs,
    }));
    budget.assertWithinRuntime("inline");
    return {
      ...tutorResponseSchema.parse(result.action),
      usage: {
        ...result.usage,
        durationMs,
        provider: result.provider,
        model: result.model,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
