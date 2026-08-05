import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";

export type CurriculumGenerationFormValues = {
  subject: string;
  learningGoal: string;
  currentLevel: CurriculumBuildRequest["learnerProfile"]["currentLevel"];
  durationWeeks: string;
  hoursPerWeek: string;
  includeMathDepth: NonNullable<NonNullable<CurriculumBuildRequest["constraints"]>["includeMathDepth"]>;
  includeProjects: boolean;
};

export function buildCurriculumBuildRequest(
  values: CurriculumGenerationFormValues,
): CurriculumBuildRequest {
  return {
    subject: values.subject.trim(),
    learnerProfile: {
      currentLevel: values.currentLevel,
      knownSkills: [],
    },
    learningGoal: values.learningGoal.trim(),
    constraints: {
      ...(values.durationWeeks ? { durationWeeks: Number(values.durationWeeks) } : {}),
      ...(values.hoursPerWeek ? { hoursPerWeek: Number(values.hoursPerWeek) } : {}),
      includeMathDepth: values.includeMathDepth,
      includeProjects: values.includeProjects,
    },
  };
}

export function isCurriculumGenerationQuotaExhausted(
  quota: { remaining: number | null } | null,
): boolean {
  return quota?.remaining === 0;
}
