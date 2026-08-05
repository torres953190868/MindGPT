// Shared factories for curriculum domain tests. `createValidCurriculumDraft`
// produces a draft that passes every deterministic check in
// curriculum-validation-service: 5 sources across 5 types, 2 required modules
// each backed by 2 distinct sources, a linear prerequisite chain in reading
// order, unique titles/ids/orderIndexes, and every core node sourced.

import type {
  CurriculumDraft,
  CurriculumModule,
  CurriculumNode,
  CurriculumSource,
} from "@/lib/curriculum/curriculum-types";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createCurriculumSource(
  overrides?: Partial<CurriculumSource>,
): CurriculumSource {
  return {
    id: nextId("source"),
    url: "https://example.edu/course",
    title: "Example Source",
    publisher: "Example Publisher",
    sourceType: "textbook",
    retrievedAt: "2026-08-04T00:00:00.000Z",
    qualityScore: 0.9,
    ...overrides,
  };
}

export function createCurriculumNode(overrides?: Partial<CurriculumNode>): CurriculumNode {
  return {
    clientId: nextId("node"),
    title: `Node ${idCounter}`,
    summary: "A concise summary of this learning node.",
    nodeType: "concept",
    importance: "core",
    difficulty: 2,
    estimatedMinutes: 30,
    learningObjectives: ["Understand the core idea"],
    completionCriteria: ["Can explain the idea in own words"],
    prerequisiteClientIds: [],
    sourceIds: [],
    tags: [],
    orderIndex: 0,
    ...overrides,
  };
}

export function createCurriculumModule(
  overrides?: Partial<CurriculumModule>,
): CurriculumModule {
  return {
    clientId: nextId("module"),
    title: `Module ${idCounter}`,
    description: "A module of the course.",
    orderIndex: 0,
    required: true,
    nodes: [createCurriculumNode()],
    ...overrides,
  };
}

export function createValidCurriculumDraft(): CurriculumDraft {
  const sources: CurriculumSource[] = [
    createCurriculumSource({
      id: "s1",
      title: "University Course",
      url: "https://example.edu/course",
      sourceType: "university_course",
    }),
    createCurriculumSource({
      id: "s2",
      title: "Textbook",
      url: "https://example.com/textbook",
      sourceType: "textbook",
    }),
    createCurriculumSource({
      id: "s3",
      title: "Official Docs",
      url: "https://example.org/docs",
      sourceType: "official_documentation",
    }),
    createCurriculumSource({
      id: "s4",
      title: "Research Paper",
      url: "https://example.net/paper",
      sourceType: "research_paper",
    }),
    createCurriculumSource({
      id: "s5",
      title: "Industry Guide",
      url: "https://example.io/guide",
      sourceType: "industry_guide",
    }),
  ];

  return {
    title: "Foundations of Testing",
    subject: "Software Testing",
    versionLabel: "v1",
    audience: "Beginner developers",
    learningGoal: "Be able to design and run a reliable test suite.",
    estimatedWeeks: 4,
    estimatedHours: 24,
    assumptions: ["Learner can read TypeScript"],
    exclusions: ["No coverage of hardware testing"],
    modules: [
      {
        clientId: "m1",
        title: "Foundations",
        description: "Core vocabulary and mental models.",
        orderIndex: 0,
        required: true,
        nodes: [
          {
            clientId: "n1",
            title: "Testing Vocabulary",
            summary: "Units, integration, and end-to-end basics.",
            nodeType: "concept",
            importance: "core",
            difficulty: 1,
            estimatedMinutes: 30,
            learningObjectives: ["Name the test levels"],
            completionCriteria: ["Can classify a given test by level"],
            prerequisiteClientIds: [],
            sourceIds: ["s1", "s2"],
            tags: ["basics"],
            orderIndex: 0,
          },
          {
            clientId: "n2",
            title: "Writing a Unit Test",
            summary: "Arrange, act, assert in practice.",
            nodeType: "procedure",
            importance: "core",
            difficulty: 2,
            estimatedMinutes: 45,
            learningObjectives: ["Write a passing unit test"],
            completionCriteria: ["Test fails for the right reason when broken"],
            prerequisiteClientIds: ["n1"],
            sourceIds: ["s2"],
            tags: [],
            orderIndex: 1,
          },
        ],
      },
      {
        clientId: "m2",
        title: "Applied Practice",
        description: "A small project applying the foundations.",
        orderIndex: 1,
        required: true,
        nodes: [
          {
            clientId: "n3",
            title: "Test a Small Feature",
            summary: "Design and implement tests for a feature.",
            nodeType: "project",
            importance: "core",
            difficulty: 3,
            estimatedMinutes: 120,
            learningObjectives: ["Ship a tested feature"],
            completionCriteria: ["Feature merged with a green suite"],
            prerequisiteClientIds: ["n2"],
            sourceIds: ["s3", "s4"],
            tags: ["project"],
            orderIndex: 0,
          },
        ],
      },
    ],
    sources,
    conflicts: [],
    validation: {
      coverageScore: 0.9,
      sequenceScore: 0.9,
      prerequisiteScore: 0.95,
      sourceQualityScore: 0.9,
      difficultyFitScore: 0.9,
      warnings: [],
    },
  };
}
