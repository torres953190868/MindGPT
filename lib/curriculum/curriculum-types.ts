// Curriculum domain model for the dual-agent learning system (spec §3.4/§3.5/§7).
// This module is pure types + zod schemas: no I/O, no server-only imports, so
// both API routes and client-side preview code can depend on it.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Domain limits (deterministic checks from spec §3.9 step 6; source count
// aligned with the agent budget in §11.4). Both the zod schemas and
// curriculum-validation-service read from this single place.
// ---------------------------------------------------------------------------

export const CURRICULUM_LIMITS = {
  maxModules: 20,
  maxNodesTotal: 200,
  maxNodesPerModule: 40,
  maxSources: 30,
  maxPrerequisitesPerNode: 10,
  maxTitleLength: 120,
  maxSummaryLength: 2_000,
  maxDescriptionLength: 2_000,
  maxObjectiveEntryLength: 300,
  maxLearningObjectivesPerNode: 10,
  maxCompletionCriteriaPerNode: 10,
  maxTagsPerNode: 20,
  maxTagLength: 60,
  maxSourcesPerNode: 10,
  maxAssumptions: 20,
  maxExclusions: 20,
  maxAssumptionEntryLength: 300,
  maxConflicts: 20,
  maxConflictTopicLength: 200,
  maxConflictSummaryLength: 1_000,
  maxWarnings: 100,
  maxWarningMessageLength: 500,
  maxWarningCodeLength: 80,
  maxClientIdLength: 120,
  maxSourceUrlLength: 2_048,
  maxSourceTitleLength: 300,
  maxSourcePublisherLength: 200,
  maxSourceNotesLength: 1_000,
  maxVersionLabelLength: 60,
  maxAudienceLength: 500,
  maxLearningGoalLength: 2_000,
  maxSubjectLength: 200,
  // Advisory thresholds from spec §3.9 step 3 (source screening).
  minIndependentSources: 5,
  minSourceTypes: 2,
  minCoreModuleSources: 2,
} as const;

// ---------------------------------------------------------------------------
// Enums (zod schemas are the source of truth; TS unions are inferred).
// ---------------------------------------------------------------------------

export const curriculumNodeTypeSchema = z.enum([
  "concept",
  "procedure",
  "example",
  "exercise",
  "project",
  "assessment",
]);
export type CurriculumNodeType = z.infer<typeof curriculumNodeTypeSchema>;

export const curriculumImportanceSchema = z.enum(["core", "advanced", "optional"]);
export type CurriculumImportance = z.infer<typeof curriculumImportanceSchema>;

export const curriculumSourceTypeSchema = z.enum([
  "university_course",
  "textbook",
  "official_documentation",
  "standard",
  "research_paper",
  "industry_guide",
  "other",
]);
export type CurriculumSourceType = z.infer<typeof curriculumSourceTypeSchema>;

export const curriculumWarningSeveritySchema = z.enum(["blocking", "advisory"]);
export type CurriculumWarningSeverity = z.infer<typeof curriculumWarningSeveritySchema>;

// ---------------------------------------------------------------------------
// Draft output schema (spec §3.5). clientIds are produced by the builder and
// validated server-side; database ids are assigned only at persistence time.
// ---------------------------------------------------------------------------

const clientIdSchema = z.string().trim().min(1).max(CURRICULUM_LIMITS.maxClientIdLength);

export const curriculumNodeSchema = z.object({
  clientId: clientIdSchema,
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength),
  summary: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSummaryLength),
  nodeType: curriculumNodeTypeSchema,
  importance: curriculumImportanceSchema,
  difficulty: z.number().int().min(1).max(5),
  estimatedMinutes: z.number().int().positive(),
  learningObjectives: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxObjectiveEntryLength))
    .min(1)
    .max(CURRICULUM_LIMITS.maxLearningObjectivesPerNode),
  completionCriteria: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxObjectiveEntryLength))
    .min(1)
    .max(CURRICULUM_LIMITS.maxCompletionCriteriaPerNode),
  prerequisiteClientIds: z
    .array(clientIdSchema)
    .max(CURRICULUM_LIMITS.maxPrerequisitesPerNode),
  sourceIds: z.array(clientIdSchema).max(CURRICULUM_LIMITS.maxSourcesPerNode),
  tags: z
    .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTagLength))
    .max(CURRICULUM_LIMITS.maxTagsPerNode),
  orderIndex: z.number().int().min(0),
});
export type CurriculumNode = z.infer<typeof curriculumNodeSchema>;

export const curriculumModuleSchema = z.object({
  clientId: clientIdSchema,
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength),
  description: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxDescriptionLength),
  orderIndex: z.number().int().min(0),
  required: z.boolean(),
  nodes: z.array(curriculumNodeSchema).min(1).max(CURRICULUM_LIMITS.maxNodesPerModule),
});
export type CurriculumModule = z.infer<typeof curriculumModuleSchema>;

export const curriculumSourceSchema = z.object({
  id: clientIdSchema,
  url: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSourceUrlLength),
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSourceTitleLength),
  publisher: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSourcePublisherLength).optional(),
  sourceType: curriculumSourceTypeSchema,
  // Retrieval timestamp as ISO-8601 text; kept as a plain string so sources
  // imported from heterogeneous fetchers do not fail on format drift.
  retrievedAt: z.string().trim().min(1).max(60),
  qualityScore: z.number().min(0).max(1),
  notes: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSourceNotesLength).optional(),
});
export type CurriculumSource = z.infer<typeof curriculumSourceSchema>;

export const curriculumEdgeSchema = z.object({
  fromClientId: clientIdSchema,
  toClientId: clientIdSchema,
  edgeType: z.enum(["prerequisite", "recommended", "related"]),
});
export type CurriculumEdge = z.infer<typeof curriculumEdgeSchema>;

export const curriculumConflictSchema = z.object({
  topic: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxConflictTopicLength),
  summary: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxConflictSummaryLength),
  sourceIds: z.array(clientIdSchema).min(1).max(CURRICULUM_LIMITS.maxSources),
});
export type CurriculumConflict = z.infer<typeof curriculumConflictSchema>;

export const structuredWarningSchema = z.object({
  code: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxWarningCodeLength),
  severity: curriculumWarningSeveritySchema,
  message: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxWarningMessageLength),
  moduleClientId: clientIdSchema.optional(),
  nodeClientId: clientIdSchema.optional(),
});
export type StructuredWarning = z.infer<typeof structuredWarningSchema>;

// The five rubric scores (spec §3.9 step 6). In this phase they stay empty;
// Phase 2 fills them from an independent validation-model call.
export const curriculumValidationScoresSchema = z.object({
  coverageScore: z.number().min(0).max(1),
  sequenceScore: z.number().min(0).max(1),
  prerequisiteScore: z.number().min(0).max(1),
  sourceQualityScore: z.number().min(0).max(1),
  difficultyFitScore: z.number().min(0).max(1),
});
export type CurriculumValidationScores = z.infer<typeof curriculumValidationScoresSchema>;

export const curriculumDraftValidationSchema = curriculumValidationScoresSchema.extend({
  warnings: z.array(structuredWarningSchema).max(CURRICULUM_LIMITS.maxWarnings),
});

export const curriculumDraftSchema = z.object({
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength),
  subject: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSubjectLength),
  versionLabel: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxVersionLabelLength),
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
  modules: z.array(curriculumModuleSchema).min(1).max(CURRICULUM_LIMITS.maxModules),
  sources: z.array(curriculumSourceSchema).min(1).max(CURRICULUM_LIMITS.maxSources),
  // The original builder schema derives prerequisite edges from nodes. This
  // optional extension preserves loose recommended/related edges for the
  // editor and version diff without breaking older generated drafts.
  edges: z.array(curriculumEdgeSchema).max(CURRICULUM_LIMITS.maxNodesTotal).optional(),
  conflicts: z.array(curriculumConflictSchema).max(CURRICULUM_LIMITS.maxConflicts),
  validation: curriculumDraftValidationSchema,
});
export type CurriculumDraft = z.infer<typeof curriculumDraftSchema>;

const curriculumModulePatchSchema = curriculumModuleSchema.omit({ nodes: true });
const curriculumNodePatchSchema = curriculumNodeSchema.extend({
  moduleClientId: clientIdSchema,
});
const curriculumPatchOperations = <TSchema extends z.ZodType>(schema: TSchema) =>
  z
    .object({
      upsert: z.array(schema).max(CURRICULUM_LIMITS.maxNodesTotal).optional(),
      delete: z.array(clientIdSchema).max(CURRICULUM_LIMITS.maxNodesTotal).optional(),
    })
    .refine((value) => value.upsert !== undefined || value.delete !== undefined, {
      message: "At least one upsert or delete operation is required.",
    });

export const curriculumVersionPatchSchema = z
  .object({
    versionLabel: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxVersionLabelLength).optional(),
    audience: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAudienceLength).optional(),
    estimatedWeeks: z.number().int().positive().max(520).nullable().optional(),
    estimatedHours: z.number().positive().max(100_000).nullable().optional(),
    assumptions: z
      .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAssumptionEntryLength))
      .max(CURRICULUM_LIMITS.maxAssumptions)
      .optional(),
    exclusions: z
      .array(z.string().trim().min(1).max(CURRICULUM_LIMITS.maxAssumptionEntryLength))
      .max(CURRICULUM_LIMITS.maxExclusions)
      .optional(),
    conflicts: z.array(curriculumConflictSchema).max(CURRICULUM_LIMITS.maxConflicts).optional(),
    modules: curriculumPatchOperations(curriculumModulePatchSchema).optional(),
    nodes: curriculumPatchOperations(curriculumNodePatchSchema).optional(),
    edges: z
      .object({
        upsert: z.array(curriculumEdgeSchema).max(CURRICULUM_LIMITS.maxNodesTotal).optional(),
        delete: z.array(curriculumEdgeSchema).max(CURRICULUM_LIMITS.maxNodesTotal).optional(),
      })
      .refine((value) => value.upsert !== undefined || value.delete !== undefined, {
        message: "At least one upsert or delete operation is required.",
      })
      .optional(),
    sources: curriculumPatchOperations(curriculumSourceSchema).optional(),
  })
  .refine(
    (value) =>
      Object.keys(value).some((key) => value[key as keyof typeof value] !== undefined),
    { message: "At least one curriculum version update is required." },
  );
export type CurriculumVersionPatch = z.infer<typeof curriculumVersionPatchSchema>;

// ---------------------------------------------------------------------------
// Build request input (spec §3.4). Defined now, consumed by Phase 2's
// POST /api/curricula/generate.
// ---------------------------------------------------------------------------

export const curriculumBuildRequestSchema = z.object({
  subject: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSubjectLength),
  learnerProfile: z.object({
    currentLevel: z.enum(["beginner", "intermediate", "advanced"]),
    knownSkills: z.array(z.string().trim().min(1).max(120)).max(50),
    weakAreas: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  }),
  learningGoal: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxLearningGoalLength),
  constraints: z
    .object({
      durationWeeks: z.number().int().positive().max(520).optional(),
      hoursPerWeek: z.number().positive().max(80).optional(),
      preferredLanguage: z.string().trim().min(1).max(40).optional(),
      includeProjects: z.boolean().optional(),
      includeMathDepth: z.enum(["light", "standard", "deep"]).optional(),
    })
    .optional(),
  sourcePreferences: z
    .object({
      preferredSourceTypes: z
        .array(
          z.enum([
            "university_course",
            "textbook",
            "official_documentation",
            "standard",
            "research_paper",
            "industry_guide",
          ]),
        )
        .max(6)
        .optional(),
      excludedDomains: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    })
    .optional(),
  // A skill may influence presentation style but never replaces validation.
  skillId: z.string().trim().min(1).max(120).optional(),
});
export type CurriculumBuildRequest = z.infer<typeof curriculumBuildRequestSchema>;

// ---------------------------------------------------------------------------
// Database enums and row types (spec §7). These mirror
// supabase/migrations/20260804000000_curriculum_foundation.sql one-to-one.
// ---------------------------------------------------------------------------

export type CurriculumStatus = "draft" | "active" | "archived";
export type CurriculumVersionStatus = "draft" | "published" | "superseded";
export type CurriculumEdgeType = "prerequisite" | "recommended" | "related";
export type CurriculumSupportType = "primary" | "supporting" | "example";
export type CurriculumExerciseType = "quiz" | "open" | "code" | "project";

// Learner-facing node lifecycle. Defined here so Phase 4 does not redefine it;
// no code path uses it in this phase.
export type CurriculumNodeStatus =
  | "locked"
  | "available"
  | "in_progress"
  | "needs_review"
  | "completed";

export type CurriculumRow = {
  id: string;
  owner_user_id: string;
  project_id: string | null;
  title: string;
  subject: string;
  learning_goal: string;
  status: CurriculumStatus;
  created_at: string;
  updated_at: string;
};

export type CurriculumVersionRow = {
  id: string;
  curriculum_id: string;
  agent_run_id: string | null;
  version_number: number;
  version_label: string;
  status: CurriculumVersionStatus;
  audience: string;
  assumptions_json: string[];
  exclusions_json: string[];
  conflicts_json: CurriculumConflict[];
  estimated_weeks: number | null;
  estimated_hours: number | null;
  build_request_json: CurriculumBuildRequest | null;
  validation_json: unknown | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
};

export type CurriculumModuleRow = {
  id: string;
  curriculum_version_id: string;
  title: string;
  description: string;
  order_index: number;
  required: boolean;
  created_at: string;
};

export type CurriculumNodeRow = {
  id: string;
  curriculum_version_id: string;
  module_id: string;
  title: string;
  summary: string;
  node_type: CurriculumNodeType;
  importance: CurriculumImportance;
  difficulty: number;
  estimated_minutes: number;
  learning_objectives_json: string[];
  completion_criteria_json: string[];
  tags_json: string[];
  order_index: number;
  created_at: string;
};

export type CurriculumEdgeRow = {
  id: string;
  curriculum_version_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: CurriculumEdgeType;
  created_at: string;
};

export type CurriculumSourceRow = {
  id: string;
  curriculum_version_id: string;
  url: string;
  canonical_url: string;
  title: string;
  publisher: string | null;
  source_type: CurriculumSourceType;
  retrieved_at: string;
  published_at: string | null;
  quality_score: number;
  content_hash: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export type CurriculumNodeSourceRow = {
  node_id: string;
  source_id: string;
  support_type: CurriculumSupportType;
  note: string | null;
  created_at: string;
};

export type CurriculumExerciseRow = {
  id: string;
  curriculum_version_id: string;
  node_id: string;
  exercise_type: CurriculumExerciseType;
  prompt_json: Record<string, unknown>;
  rubric_json: Record<string, unknown>;
  answer_json: Record<string, unknown> | null;
  order_index: number;
  created_at: string;
};

export type CurriculumSourceChunkRow = {
  id: string;
  source_id: string;
  chunk_index: number;
  excerpt: string;
  embedding: number[] | string | null;
  token_count: number;
  content_hash: string;
  created_at: string;
};
