import { z } from "zod";
import type { CurriculumNodeStatus, CurriculumVersionStatus } from "@/lib/curriculum/curriculum-types";

export type LearningEnrollmentStatus = "active" | "completed" | "paused";
export type LearningSessionStatus = "active" | "ended" | "abandoned";
export type LearningMessageRole = "user" | "assistant" | "system_event";

export type LearningEnrollmentRow = {
  id: string;
  user_id: string;
  curriculum_id: string;
  curriculum_version_id: string;
  status: LearningEnrollmentStatus;
  current_node_id: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LearningNodeProgressRow = {
  id: string;
  enrollment_id: string;
  node_id: string;
  status: CurriculumNodeStatus;
  mastery_score: number;
  attempt_count: number;
  last_evidence_json: unknown;
  last_assessed_at: string | null;
  next_review_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type LearningSessionRow = {
  id: string;
  enrollment_id: string;
  node_id: string | null;
  skill_id: string | null;
  status: LearningSessionStatus;
  started_at: string;
  ended_at: string | null;
  summary: string;
  created_at: string;
};

export type LearningMessageRow = {
  id: string;
  session_id: string;
  enrollment_id: string;
  role: LearningMessageRole;
  blocks_json: unknown;
  agent_run_id: string | null;
  created_at: string;
};

export type LearningEnrollment = {
  id: string;
  userId: string;
  curriculumId: string;
  curriculumVersionId: string;
  status: LearningEnrollmentStatus;
  currentNodeId: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LearningNodeProgress = {
  id: string;
  enrollmentId: string;
  nodeId: string;
  status: CurriculumNodeStatus;
  masteryScore: number;
  attemptCount: number;
  lastEvidence: unknown;
  lastAssessedAt: string | null;
  nextReviewAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type LearningSession = {
  id: string;
  enrollmentId: string;
  nodeId: string | null;
  skillId: string | null;
  status: LearningSessionStatus;
  startedAt: string;
  endedAt: string | null;
  summary: string;
  createdAt: string;
};

export type LearningMessage = {
  id: string;
  sessionId: string;
  enrollmentId: string;
  role: LearningMessageRole;
  blocks: unknown;
  agentRunId: string | null;
  createdAt: string;
};

export type LearningAssessmentType =
  | "quiz"
  | "open"
  | "code"
  | "project"
  | "exercise"
  | "explanation";

export type CurriculumExercise = {
  id: string;
  curriculumVersionId: string;
  nodeId: string;
  exerciseType: "quiz" | "open" | "code" | "project";
  prompt: unknown;
  rubric: unknown;
  answer: unknown | null;
  orderIndex: number;
  createdAt: string;
};

export type CurriculumExerciseRow = {
  id: string;
  curriculum_version_id: string;
  node_id: string;
  exercise_type: CurriculumExercise["exerciseType"];
  prompt_json: unknown;
  rubric_json: unknown;
  answer_json: unknown | null;
  order_index: number;
  created_at: string;
};

export type LearningAssessmentRow = {
  id: string;
  session_id: string;
  enrollment_id: string;
  node_id: string;
  exercise_id: string | null;
  assessment_type: LearningAssessmentType;
  prompt_json: unknown;
  answer_json: unknown | null;
  rubric_json: unknown;
  score: number;
  evidence_json: unknown;
  answer_hash: string;
  agent_run_id: string | null;
  created_at: string;
};

export type LearningAssessment = {
  id: string;
  sessionId: string;
  enrollmentId: string;
  nodeId: string;
  exerciseId: string | null;
  assessmentType: LearningAssessmentType;
  prompt: unknown;
  answer: unknown | null;
  rubric: unknown;
  score: number;
  evidence: unknown;
  answerHash: string;
  agentRunId: string | null;
  createdAt: string;
};

export type TeachingSkill = {
  id: string;
  name: string;
  explanationStyle:
    | "intuitive_first"
    | "formal_first"
    | "socratic"
    | "example_driven"
    | "project_driven";
  verbosity: "concise" | "standard" | "detailed";
  useAnalogies: boolean;
  includeCode: boolean;
  includeExercises: boolean;
  exerciseCount?: number;
  customInstructions?: string;
};

export const tutorActionSchema = z.enum([
  "continue_learning",
  "explain_current_node",
  "ask_question",
  "start_practice",
  "submit_answer",
  "review",
]);
export type TutorAction = z.infer<typeof tutorActionSchema>;

export const progressProposalSchema = z.object({
  nodeId: z.string().min(1),
  proposedStatus: z.enum(["in_progress", "needs_review", "completed"]),
  masteryScore: z.number().min(0).max(1),
  evidence: z
    .array(
      z.object({
        type: z.enum(["quiz", "explanation", "exercise", "project"]),
        summary: z.string().min(1).max(1_000),
      }),
    )
    .max(10),
  weaknesses: z.array(z.string().min(1).max(500)).max(10),
  nextAction: z.string().min(1).max(500),
});
export type ProgressProposal = z.infer<typeof progressProposalSchema>;

export const tutorBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("recap"), markdown: z.string().min(1).max(8_000) }),
  z.object({ type: z.literal("explanation"), markdown: z.string().min(1).max(12_000) }),
  z.object({ type: z.literal("example"), markdown: z.string().min(1).max(12_000) }),
  z.object({ type: z.literal("code"), language: z.string().min(1).max(40), code: z.string().max(12_000) }),
  z.object({ type: z.literal("question"), questionId: z.string().min(1), markdown: z.string().min(1).max(8_000) }),
  z.object({ type: z.literal("exercise"), exerciseId: z.string().min(1), prompt: z.string().min(1).max(8_000), markdown: z.string().min(1).max(8_000) }),
  z.object({ type: z.literal("source"), sourceId: z.string().min(1), label: z.string().min(1).max(300) }),
  z.object({
    type: z.literal("prerequisite_gap"),
    nodeId: z.string().min(1),
    missingNodeIds: z.array(z.string().min(1)).min(1).max(50),
    markdown: z.string().min(1).max(8_000),
  }),
]);
export type TutorBlock = z.infer<typeof tutorBlockSchema>;

export const tutorResponseSchema = z.object({
  lessonGoal: z.string().min(1).max(1_000),
  currentNodeId: z.string().min(1),
  blocks: z.array(tutorBlockSchema).min(1).max(20),
  progressProposal: progressProposalSchema.optional(),
});
export type TutorResponse = z.infer<typeof tutorResponseSchema> & {
  usage?: TutorUsage;
};

export type EligibleNode = {
  nodeId: string;
  title: string;
  status: CurriculumNodeStatus;
  reason: string;
  priority: number;
};

export type TutorRequest = {
  enrollmentId: string;
  skillId?: string;
  action?: TutorAction;
  message?: string;
  targetNodeId?: string;
};

export type TutorUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  provider: string;
  model: string;
};

export type RequestedNodeEvaluation = {
  node: EligibleNode | null;
  allowed: boolean;
  missingPrerequisites: Array<{ nodeId: string; title: string }>;
  reason: string;
};

export type LearningPath = {
  currentNodeId: string | null;
  nodes: EligibleNode[];
  completedNodeIds: string[];
};

export type LearningVersionContext = {
  curriculumId: string;
  curriculumVersionId: string;
  versionStatus: CurriculumVersionStatus;
  title: string;
  versionLabel: string;
  draft: unknown;
};
