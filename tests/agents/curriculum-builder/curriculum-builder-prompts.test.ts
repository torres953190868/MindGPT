// Prompt-layout tests for the CurriculumBuilderAgent. Provider prompt caches
// match on identical prefixes, so the per-module node prompt must keep all
// run-shared content ahead of all module-specific content — otherwise the N
// module calls of one run can never reuse each other's cached prefix.

import { describe, expect, it } from "vitest";
import type {
  ConceptExtraction,
  CurriculumSkeleton,
  IntakeNormalization,
} from "@/lib/agents/curriculum-builder/curriculum-builder-schema";
import {
  buildModuleNodesUserPrompt,
  CURRICULUM_STAGE_MARKERS,
} from "@/lib/agents/curriculum-builder/curriculum-builder-prompts";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";

const request: CurriculumBuildRequest = {
  subject: "机器学习",
  learningGoal: "能够独立完成常见机器学习项目",
  learnerProfile: { currentLevel: "beginner", knownSkills: ["Python"] },
};

const intake: IntakeNormalization = {
  subject: "机器学习",
  targetCapability: "独立完成机器学习项目",
  startingPoint: "零基础",
  timeBudget: "12 周",
  depth: "standard",
  assumptions: [],
  exclusions: [],
};

const skeleton: CurriculumSkeleton = {
  title: "机器学习入门",
  audience: "初学者",
  learningGoal: "能够独立完成常见机器学习项目",
  assumptions: [],
  exclusions: [],
  conflicts: [],
  modules: [
    { clientId: "m-1", title: "基础", description: "基础概念", orderIndex: 0, required: true },
    { clientId: "m-2", title: "实践", description: "动手实践", orderIndex: 1, required: true },
  ],
};

const concepts: ConceptExtraction = {
  concepts: [
    {
      name: "梯度下降",
      aliases: [],
      kind: "concept",
      importance: "core",
      difficulty: 3,
      summary: "迭代优化算法",
      sourceIds: ["src-1"],
      suggestedPrerequisites: [],
    },
  ],
};

const sources = [
  {
    id: "src-1",
    title: "机器学习教材",
    sourceType: "textbook" as const,
    qualityScore: 0.9,
    url: "https://example.com/textbook",
  },
];

function buildPrompt(moduleClientId: string): string {
  return buildModuleNodesUserPrompt({
    request,
    intake,
    skeleton,
    moduleClientId,
    concepts,
    sources,
  });
}

describe("buildModuleNodesUserPrompt cache-friendly layout", () => {
  it("keeps run-shared blocks ahead of module-specific content", () => {
    const prompt = buildPrompt("m-1");

    const intakeIndex = prompt.indexOf("【标准化目标】");
    const conceptsIndex = prompt.indexOf("【候选知识点】");
    const sourcesIndex = prompt.indexOf("【可用来源");
    const markerIndex = prompt.indexOf(CURRICULUM_STAGE_MARKERS.moduleNodes("m-1"));
    const moduleInfoIndex = prompt.indexOf("【模块信息】");

    expect(intakeIndex).toBeGreaterThanOrEqual(0);
    expect(conceptsIndex).toBeGreaterThan(intakeIndex);
    expect(sourcesIndex).toBeGreaterThan(conceptsIndex);
    expect(markerIndex).toBeGreaterThan(sourcesIndex);
    expect(moduleInfoIndex).toBeGreaterThan(markerIndex);
  });

  it("produces an identical shared prefix for different modules of one run", () => {
    const first = buildPrompt("m-1");
    const second = buildPrompt("m-2");

    const taskMarker = "【本模块任务】";
    const firstPrefix = first.slice(0, first.indexOf(taskMarker));
    const secondPrefix = second.slice(0, second.indexOf(taskMarker));

    expect(firstPrefix.length).toBeGreaterThan(0);
    expect(firstPrefix).toBe(secondPrefix);
    // The shared bulk really is in the prefix: concepts and sources included.
    expect(firstPrefix).toContain("梯度下降");
    expect(firstPrefix).toContain("src-1");
  });
});
