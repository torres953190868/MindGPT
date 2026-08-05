// LLM action schemas for the CurriculumBuilderAgent's controlled workflow
// (spec §3.9). Each stage asks the model for ONE JSON object matching the
// stage's action schema (impact analysis D1: "JSON instruction + code-
// executed tools"); the runner validates through these schemas via the model
// adapter and never lets raw model output reach persistence directly.
//
// These are ACTION schemas, not persistence schemas: their outputs are
// assembled into a CurriculumDraft in code, which is then re-validated by the
// deterministic CurriculumValidationService before any database write
// (spec §3.7: the LLM proposes, business services persist).

import { z } from "zod";
import {
  CURRICULUM_LIMITS,
  curriculumConflictSchema,
  curriculumImportanceSchema,
  curriculumNodeSchema,
  curriculumNodeTypeSchema,
  curriculumSourceTypeSchema,
} from "@/lib/curriculum/curriculum-types";

const clientIdSchema = z.string().trim().min(1).max(CURRICULUM_LIMITS.maxClientIdLength);

// ---------------------------------------------------------------------------
// Stage 1 (spec §3.9 step 1): learning-goal normalization. Vague or oversized
// goals are NOT clarified interactively in the MVP; the model records its
// scoping decisions in assumptions/exclusions and the run continues.
// ---------------------------------------------------------------------------

export const intakeNormalizationSchema = z.object({
  subject: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSubjectLength),
  targetCapability: z.string().trim().min(1).max(500),
  startingPoint: z.string().trim().min(1).max(500),
  timeBudget: z.string().trim().min(1).max(200),
  depth: z.enum(["light", "standard", "deep"]),
  assumptions: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAssumptionEntryLength))
    .max(CURRICULUM_LIMITS.maxAssumptions),
  exclusions: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAssumptionEntryLength))
    .max(CURRICULUM_LIMITS.maxExclusions),
});
export type IntakeNormalization = z.infer<typeof intakeNormalizationSchema>;

// ---------------------------------------------------------------------------
// Stage 2 (spec §3.9 step 2): the research plan. The query cap mirrors the
// maxSearchQueries budget (spec §11.4) so a plan can never schedule more
// searches than the budget allows.
// ---------------------------------------------------------------------------

export const RESEARCH_PLAN_MAX_QUERIES = 10;

export const researchPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(300),
        sourceType: curriculumSourceTypeSchema.optional(),
        rationale: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(RESEARCH_PLAN_MAX_QUERIES),
});
export type ResearchPlan = z.infer<typeof researchPlanSchema>;

// ---------------------------------------------------------------------------
// Stage 4 (spec §3.9 step 4): concept extraction and normalization.
// suggestedPrerequisites reference other concepts BY NAME (the dependency
// graph between concrete nodes is built later, during synthesis).
// ---------------------------------------------------------------------------

export const conceptExtractionSchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        aliases: z.array(z.string().trim().min(1).max(120)).max(10),
        kind: curriculumNodeTypeSchema,
        importance: curriculumImportanceSchema,
        difficulty: z.number().int().min(1).max(5),
        summary: z.string().trim().min(1).max(1_000),
        sourceIds: z.array(clientIdSchema).max(CURRICULUM_LIMITS.maxSourcesPerNode),
        suggestedPrerequisites: z.array(z.string().trim().min(1).max(120)).max(10),
      }),
    )
    .min(1)
    .max(80),
});
export type ConceptExtraction = z.infer<typeof conceptExtractionSchema>;

// ---------------------------------------------------------------------------
// Stage 7.1 (spec §3.9 step 7): curriculum skeleton — module-level fields
// only. Nodes are synthesized per module in separate calls so a single
// structured response never has to carry a whole course (truncation risk).
// ---------------------------------------------------------------------------

export const curriculumSkeletonSchema = z.object({
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength),
  audience: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAudienceLength),
  learningGoal: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxLearningGoalLength),
  estimatedWeeks: z.number().int().positive().max(520).optional(),
  estimatedHours: z.number().positive().max(100_000).optional(),
  assumptions: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAssumptionEntryLength))
    .max(CURRICULUM_LIMITS.maxAssumptions),
  exclusions: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAssumptionEntryLength))
    .max(CURRICULUM_LIMITS.maxExclusions),
  conflicts: z.array(curriculumConflictSchema).max(CURRICULUM_LIMITS.maxConflicts),
  modules: z
    .array(
      z.object({
        clientId: clientIdSchema,
        title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength),
        description: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxDescriptionLength),
        orderIndex: z.number().int().min(0),
        required: z.boolean(),
      }),
    )
    .min(1)
    .max(CURRICULUM_LIMITS.maxModules),
});
export type CurriculumSkeleton = z.infer<typeof curriculumSkeletonSchema>;

// ---------------------------------------------------------------------------
// Stage 7.2 (spec §3.9 step 7): nodes of ONE module. The node shape is the
// domain's own CurriculumNode schema — clientIds, prerequisite clientIds and
// sourceIds bindings included — so assembly is a pure composition step.
// ---------------------------------------------------------------------------

export const moduleNodesOutputSchema = z.object({
  nodes: z
    .array(curriculumNodeSchema)
    .min(1)
    .max(CURRICULUM_LIMITS.maxNodesPerModule),
});
export type ModuleNodesOutput = z.infer<typeof moduleNodesOutputSchema>;

// ---------------------------------------------------------------------------
// Stage 6 (spec §3.9 step 6): independent validation scoring. Produced by a
// dedicated model call on the `curriculum_validation` route with an anchored
// rubric in the prompt — the generating model never scores its own output.
// Extends the domain's five-score CurriculumValidationScores with a
// per-dimension rationale.
// ---------------------------------------------------------------------------

const rubricRationaleSchema = z.string().trim().min(1).max(500);

export const curriculumValidationScoreActionSchema = z.object({
  coverageScore: z.number().min(0).max(1),
  sequenceScore: z.number().min(0).max(1),
  prerequisiteScore: z.number().min(0).max(1),
  sourceQualityScore: z.number().min(0).max(1),
  difficultyFitScore: z.number().min(0).max(1),
  rationales: z.object({
    coverageScore: rubricRationaleSchema,
    sequenceScore: rubricRationaleSchema,
    prerequisiteScore: rubricRationaleSchema,
    sourceQualityScore: rubricRationaleSchema,
    difficultyFitScore: rubricRationaleSchema,
  }),
});
export type CurriculumValidationScoreAction = z.infer<
  typeof curriculumValidationScoreActionSchema
>;
