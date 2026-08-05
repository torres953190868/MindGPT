// Deterministic mock script for the CurriculumBuilderAgent (impact analysis
// D6). When AI_MOCK_MODE is on and the caller did not inject a model adapter,
// the facade wires this script into a MockModelAdapter so the ENTIRE state
// machine — intake → planning → searching → fetching → extraction → synthesis
// → validation → saving — runs end-to-end with zero network and zero real
// model calls (the E2E/development critical path).
//
// Contract with the runner (keep in sync when editing either side):
// - every user prompt carries its CURRICULUM_STAGE_MARKERS marker; the
//   matchers below route scripted actions on those markers, so stage retries
//   and resumes consume the right entries;
// - source clientIds are runner-assigned as src-1, src-2, ... in fetch order;
//   the mock plan issues 3 queries and the MockWebSearchProvider yields 3
//   unique results per query, so src-1..src-8 always exist (fetch cap 8) —
//   the script only binds to src-1..src-3;
// - the produced draft passes deterministic validation with advisory-only
//   warnings (all mock sources infer as "other", hence FEW_SOURCE_TYPES).

import type { MockActionScriptEntry } from "@/lib/agent-runtime/model-adapter";
import type { AgentModelActionRequest } from "@/lib/agent-runtime/model-adapter";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";
import { CURRICULUM_STAGE_MARKERS } from "@/lib/agents/curriculum-builder/curriculum-builder-prompts";

function markerRequestMatcher(marker: string) {
  return (request: AgentModelActionRequest<unknown>) =>
    request.contextMessages.some((message) => message.content.includes(marker));
}

export function buildMockCurriculumScript(
  request: CurriculumBuildRequest,
): MockActionScriptEntry[] {
  const subject = request.subject;
  const level = request.learnerProfile.currentLevel;
  const weeks = request.constraints?.durationWeeks ?? 12;
  const hoursPerWeek = request.constraints?.hoursPerWeek ?? 5;
  const depth = request.constraints?.includeMathDepth ?? "standard";

  const intakeAction = {
    subject,
    targetCapability: request.learningGoal,
    startingPoint: `当前水平 ${level}；已掌握：${request.learnerProfile.knownSkills.join("、") || "无"}`,
    timeBudget: `${weeks} 周，每周 ${hoursPerWeek} 小时`,
    depth,
    assumptions: [
      "假设学习者可以投入所声明的时间预算",
      `以公开权威资料为主要依据梳理「${subject}」的知识结构`,
    ],
    exclusions: [`不覆盖超出「${subject}」入门到独立实践范围的高级专题`],
  };

  const planAction = {
    queries: [
      {
        query: `${subject} 大学课程 教学大纲`,
        sourceType: "university_course",
        rationale: "获取权威课程结构与先修要求",
      },
      {
        query: `${subject} 经典教材 章节目录`,
        sourceType: "textbook",
        rationale: "参考经典教材的章节划分与知识粒度",
      },
      {
        query: `${subject} 官方文档 实践指南`,
        sourceType: "official_documentation",
        rationale: "覆盖实践流程与工具链",
      },
    ],
  };

  const extractionAction = {
    concepts: [
      {
        name: `${subject}基础概念`,
        aliases: [`${subject}入门概念`],
        kind: "concept",
        importance: "core",
        difficulty: 1,
        summary: `${subject}的基本定义、边界与核心术语。`,
        sourceIds: ["src-1", "src-2"],
        suggestedPrerequisites: [],
      },
      {
        name: `${subject}核心方法`,
        aliases: [],
        kind: "concept",
        importance: "core",
        difficulty: 2,
        summary: `${subject}的核心方法与适用场景。`,
        sourceIds: ["src-1"],
        suggestedPrerequisites: [`${subject}基础概念`],
      },
      {
        name: `${subject}实践流程`,
        aliases: [],
        kind: "procedure",
        importance: "core",
        difficulty: 3,
        summary: `把${subject}方法落地到真实任务的标准流程。`,
        sourceIds: ["src-2", "src-3"],
        suggestedPrerequisites: [`${subject}核心方法`],
      },
      {
        name: `${subject}综合项目`,
        aliases: [],
        kind: "project",
        importance: "advanced",
        difficulty: 4,
        summary: `综合运用${subject}知识完成一个端到端项目。`,
        sourceIds: ["src-3"],
        suggestedPrerequisites: [`${subject}实践流程`],
      },
    ],
  };

  const skeletonAction = {
    title: `${subject}系统学习教程`,
    audience: `${level} 学习者`,
    learningGoal: request.learningGoal,
    estimatedWeeks: weeks,
    estimatedHours: weeks * hoursPerWeek,
    assumptions: intakeAction.assumptions,
    exclusions: intakeAction.exclusions,
    conflicts: [],
    modules: [
      {
        clientId: "m-1",
        title: `${subject}基础`,
        description: `建立${subject}的核心概念与方法框架。`,
        orderIndex: 0,
        required: true,
      },
      {
        clientId: "m-2",
        title: `${subject}实践`,
        description: `按标准流程把${subject}应用到真实任务。`,
        orderIndex: 1,
        required: true,
      },
    ],
  };

  const moduleOneNodesAction = {
    nodes: [
      {
        clientId: "n-1-1",
        title: `${subject}基础概念`,
        summary: `理解${subject}的基本定义、边界与核心术语。`,
        nodeType: "concept",
        importance: "core",
        difficulty: 1,
        estimatedMinutes: 45,
        learningObjectives: [`能用自己的话解释${subject}的核心概念`],
        completionCriteria: ["能向他人准确复述核心概念并举出一个例子"],
        prerequisiteClientIds: [],
        sourceIds: ["src-1", "src-2"],
        tags: [subject],
        orderIndex: 0,
      },
      {
        clientId: "n-1-2",
        title: `${subject}核心方法`,
        summary: `掌握${subject}的核心方法及其适用场景。`,
        nodeType: "concept",
        importance: "core",
        difficulty: 2,
        estimatedMinutes: 60,
        learningObjectives: [`能说明${subject}核心方法的适用条件`],
        completionCriteria: ["能为给定场景选择合适的方法并说明理由"],
        prerequisiteClientIds: ["n-1-1"],
        sourceIds: ["src-1"],
        tags: [subject],
        orderIndex: 1,
      },
      {
        clientId: "n-1-3",
        title: `${subject}基础自测`,
        summary: `检验对${subject}基础概念与方法的掌握程度。`,
        nodeType: "assessment",
        importance: "optional",
        difficulty: 2,
        estimatedMinutes: 20,
        learningObjectives: ["自检基础知识的掌握情况"],
        completionCriteria: ["完成自测并能解释每道题的依据"],
        prerequisiteClientIds: ["n-1-2"],
        sourceIds: [],
        tags: [subject],
        orderIndex: 2,
      },
    ],
  };

  const moduleTwoNodesAction = {
    nodes: [
      {
        clientId: "n-2-1",
        title: `${subject}实践流程`,
        summary: `按标准流程把${subject}方法落地到真实任务。`,
        nodeType: "procedure",
        importance: "core",
        difficulty: 3,
        estimatedMinutes: 90,
        learningObjectives: [`能按标准流程执行一次完整的${subject}实践`],
        completionCriteria: ["能在指导下独立完成流程的每个步骤"],
        prerequisiteClientIds: ["n-1-2"],
        sourceIds: ["src-2", "src-3"],
        tags: [subject],
        orderIndex: 0,
      },
      {
        clientId: "n-2-2",
        title: `${subject}综合项目`,
        summary: `端到端完成一个${subject}综合项目。`,
        nodeType: "project",
        importance: "core",
        difficulty: 4,
        estimatedMinutes: 180,
        learningObjectives: [`能独立交付一个完整的${subject}项目`],
        completionCriteria: ["项目成果可演示，且能说明每个决策的依据"],
        prerequisiteClientIds: ["n-2-1"],
        sourceIds: ["src-3"],
        tags: [subject],
        orderIndex: 1,
      },
    ],
  };

  const validationScoresAction = {
    coverageScore: 0.9,
    sequenceScore: 0.9,
    prerequisiteScore: 0.92,
    sourceQualityScore: 0.85,
    difficultyFitScore: 0.9,
    rationales: {
      coverageScore: "核心主题均有节点覆盖，进阶主题留作选修。",
      sequenceScore: "模块由基础到实践，节点顺序符合学习路径。",
      prerequisiteScore: "每个节点的前置均存在且先于节点出现。",
      sourceQualityScore: "核心节点均有独立来源支撑，类型可进一步多样化。",
      difficultyFitScore: "难度曲线与声明的学习者水平及时间预算匹配。",
    },
  };

  const mainSequence = [
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.intake), action: intakeAction },
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.planning), action: planAction },
    {
      match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.extraction),
      action: extractionAction,
    },
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.skeleton), action: skeletonAction },
    {
      match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.moduleNodes("m-1")),
      action: moduleOneNodesAction,
    },
    {
      match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.moduleNodes("m-2")),
      action: moduleTwoNodesAction,
    },
    {
      match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.validation),
      action: validationScoresAction,
    },
  ];

  // Duplicate the post-research synthesis/validation entries so the mock script
  // can survive one repair loop (spec §3.8) without exhausting. Intake and
  // planning are not re-run during repair; searching/tool calls are deterministic
  // and do not consume model script entries.
  const repairSequence = [
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.extraction), action: extractionAction },
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.skeleton), action: skeletonAction },
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.moduleNodes("m-1")), action: moduleOneNodesAction },
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.moduleNodes("m-2")), action: moduleTwoNodesAction },
    { match: markerRequestMatcher(CURRICULUM_STAGE_MARKERS.validation), action: validationScoresAction },
  ];

  return [...mainSequence, ...repairSequence];
}
