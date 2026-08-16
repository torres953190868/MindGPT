import { HttpError } from "@/lib/server/http";
import {
  getCurriculumRepository,
  type CurriculumVersionContentDto,
} from "@/lib/curriculum/curriculum-repository";
import type { CurriculumVersionStatus } from "@/lib/curriculum/curriculum-types";
import { searchEnrolledCourseSources, type SourceChunkMatch } from "@/lib/research/source-chunk-service";
import { getLearningRepository, type LearningRepository } from "@/lib/learning/learning-repository";
import {
  buildLearningPath,
  evaluateRequestedNode,
  flattenLearningNodes,
  type LearningPathNode,
} from "@/lib/learning/learning-path-service";
import {
  diffCurriculumDrafts,
  type CurriculumVersionDiff,
} from "@/lib/curriculum/curriculum-version-diff-service";
import type {
  LearningEnrollment,
  LearningMessage,
  LearningPath,
  LearningSession,
  TeachingSkill,
  TutorRequest,
  TutorResponse,
} from "@/lib/learning/learning-types";
import type { EnrollmentMigrationProgressInput } from "@/lib/learning/learning-repository";
import { runTutorAgent, type TutorAgentInput } from "@/lib/agents/tutor/tutor-agent";
import { TUTOR_AGENT_BUDGET, type AgentRunUsage } from "@/lib/agent-runtime/agent-budget";
import { AgentError, isAgentError } from "@/lib/agent-runtime/agent-errors";
import {
  completeStep,
  createRun,
  finishRun,
  startRun,
} from "@/lib/agent-runtime/agent-run-service";
import type { AgentRunDto } from "@/lib/agent-runtime/agent-run-types";
import { createModelCallUsage, hashTelemetryText } from "@/lib/agent-runtime/agent-usage";
import { createId } from "@/lib/ids";
import { isTutorAgentEnabled } from "@/lib/server/feature-flags";
import { appendTutorTurn, listRecentLearningMessages } from "@/lib/learning/message-service";
import { incrementDailyAgentUsage } from "@/lib/server/ai-usage";
import { getAssessmentRepository } from "@/lib/learning/assessment-repository";

export type LearningContext = {
  enrollment: LearningEnrollment;
  version: CurriculumVersionContentDto;
  path: LearningPath;
  currentNode: LearningPathNode | null;
  progress: Awaited<ReturnType<LearningRepository["listProgress"]>>;
};

export type EnrollmentNodeMapping = {
  fromNodeId: string;
  fromTitle: string;
  toNodeId: string | null;
  toTitle: string | null;
  confidence: "title" | "position" | "unmatched";
  previousProgress: LearningContext["progress"][number] | null;
};

export type EnrollmentMigrationPreview = {
  fromVersionId: string;
  targetVersionId: string;
  diff: CurriculumVersionDiff;
  diffSummary: {
    added: number;
    removed: number;
    changed: number;
  };
  mappings: EnrollmentNodeMapping[];
};

export type EnrollmentMigrationResult = {
  migrated: boolean;
  idempotent: boolean;
  enrollment: LearningEnrollment;
  preview: EnrollmentMigrationPreview;
  path: LearningPath | null;
};

export function getTeachingSkill(skillId?: string): TeachingSkill {
  switch (skillId?.trim().toLowerCase()) {
    case "socratic":
      return {
        id: "socratic",
        name: "Socratic guide",
        explanationStyle: "socratic",
        verbosity: "standard",
        useAnalogies: false,
        includeCode: false,
        includeExercises: true,
      };
    case "formal":
      return {
        id: "formal",
        name: "Formal explainer",
        explanationStyle: "formal_first",
        verbosity: "detailed",
        useAnalogies: false,
        includeCode: false,
        includeExercises: true,
      };
    case "code":
      return {
        id: "code",
        name: "Code-first coach",
        explanationStyle: "example_driven",
        verbosity: "standard",
        useAnalogies: false,
        includeCode: true,
        includeExercises: true,
      };
    default:
      return {
        id: "default",
        name: "Intuitive guide",
        explanationStyle: "intuitive_first",
        verbosity: "standard",
        useAnalogies: true,
        includeCode: false,
        includeExercises: true,
      };
  }
}

function notFound(message: string): never {
  throw new HttpError(message, { code: "NOT_FOUND", expose: true, status: 404 });
}

export function assertTutorAgentEnabled(): void {
  if (!isTutorAgentEnabled()) {
    throw new HttpError("Resource not found.", {
      code: "NOT_FOUND",
      expose: true,
      status: 404,
    });
  }
}

function ensureLearnerVersion(version: CurriculumVersionContentDto | null) {
  if (!version) notFound("Curriculum version was not found.");
  if (version.version.status !== "published" && version.version.status !== "superseded") {
    throw new HttpError("Only published curriculum versions can be learned.", {
      code: "CURRICULUM_VERSION_NOT_PUBLISHED",
      expose: true,
      status: 409,
    });
  }
  return version;
}

export async function enrollLearnerForVersion(
  userId: string,
  curriculumId: string,
  curriculumVersionId: string,
  options: { repository?: LearningRepository } = {},
) {
  const curriculumRepository = getCurriculumRepository();
  const version = ensureLearnerVersion(
    await curriculumRepository.getVersionWithContentById(curriculumId, curriculumVersionId),
  );
  if (version.version.curriculumId !== curriculumId) notFound("Curriculum version was not found.");
  if (version.version.status !== "published") {
    throw new HttpError("Only the current published curriculum version accepts new enrollments.", {
      code: "CURRICULUM_VERSION_NOT_CURRENTLY_PUBLISHED",
      expose: true,
      status: 409,
    });
  }

  return (options.repository ?? getLearningRepository()).createEnrollment(userId, {
    curriculumId,
    curriculumVersionId,
  });
}

function normalizedNodeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildEnrollmentNodeMappings(
  from: CurriculumVersionContentDto,
  target: CurriculumVersionContentDto,
  progress: LearningContext["progress"],
): EnrollmentNodeMapping[] {
  const oldNodes = flattenLearningNodes(from.draft);
  const newNodes = flattenLearningNodes(target.draft);
  const usedTargetIds = new Set<string>();
  return oldNodes.map((oldNode) => {
    const previousProgress = progress.find((entry) => entry.nodeId === oldNode.clientId) ?? null;
    const titleMatch = newNodes.find(
      (newNode) =>
        !usedTargetIds.has(newNode.clientId) &&
        normalizedNodeTitle(newNode.title) === normalizedNodeTitle(oldNode.title),
    );
    const positionMatch = newNodes.find(
      (newNode) =>
        !usedTargetIds.has(newNode.clientId) &&
        newNode.moduleOrderIndex === oldNode.moduleOrderIndex &&
        newNode.orderIndex === oldNode.orderIndex,
    );
    const match = titleMatch ?? positionMatch;
    if (match) usedTargetIds.add(match.clientId);
    return {
      fromNodeId: oldNode.clientId,
      fromTitle: oldNode.title,
      toNodeId: match?.clientId ?? null,
      toTitle: match?.title ?? null,
      confidence: titleMatch ? "title" : positionMatch ? "position" : "unmatched",
      previousProgress,
    };
  });
}

function createEnrollmentMigrationPreview(
  from: CurriculumVersionContentDto,
  target: CurriculumVersionContentDto,
  progress: LearningContext["progress"],
): EnrollmentMigrationPreview {
  const diff = diffCurriculumDrafts(
    from.draft,
    target.draft,
    from.version.id,
    target.version.id,
  );
  const allDiffs = [...diff.modules, ...diff.nodes, ...diff.edges, ...diff.sources];
  return {
    fromVersionId: from.version.id,
    targetVersionId: target.version.id,
    diff,
    diffSummary: {
      added: allDiffs.filter((entry) => entry.kind === "added").length,
      removed: allDiffs.filter((entry) => entry.kind === "removed").length,
      changed: allDiffs.filter((entry) => entry.kind === "changed").length,
    },
    mappings: buildEnrollmentNodeMappings(from, target, progress),
  };
}

export async function migrateEnrollmentForOwner(
  userId: string,
  curriculumId: string,
  enrollmentId: string,
  input: { targetVersionId: string; confirmation: boolean },
  options: { repository?: LearningRepository } = {},
): Promise<EnrollmentMigrationResult> {
  const repository = options.repository ?? getLearningRepository();
  const enrollment = await repository.getEnrollmentForUser(userId, enrollmentId);
  if (!enrollment || enrollment.curriculumId !== curriculumId) {
    notFound("Learning enrollment was not found.");
  }
  const curriculumRepository = getCurriculumRepository();
  const [from, target] = await Promise.all([
    curriculumRepository.getVersionWithContentById(curriculumId, enrollment.curriculumVersionId),
    curriculumRepository.getVersionWithContentById(curriculumId, input.targetVersionId),
  ]);
  if (!from || !target) notFound("Curriculum version was not found.");
  if (target.version.status !== "published") {
    throw new HttpError("Enrollment migration requires a currently published target version.", {
      code: "CURRICULUM_VERSION_NOT_PUBLISHED",
      expose: true,
      status: 409,
    });
  }

  const progress = await repository.listProgress(userId, enrollmentId);
  const preview = createEnrollmentMigrationPreview(from, target, progress);
  if (enrollment.curriculumVersionId === input.targetVersionId) {
    return {
      migrated: false,
      idempotent: true,
      enrollment,
      preview,
      path: buildLearningPath(target.draft, progress, enrollment.currentNodeId),
    };
  }
  if (input.confirmation !== true) {
    return { migrated: false, idempotent: false, enrollment, preview, path: null };
  }

  const targetProgress: EnrollmentMigrationProgressInput[] = preview.mappings
    .filter((mapping) => mapping.toNodeId && mapping.previousProgress)
    .map((mapping) => {
      const previous = mapping.previousProgress!;
      return {
        fromNodeId: mapping.fromNodeId,
        toNodeId: mapping.toNodeId!,
        status: previous.status,
        masteryScore: previous.masteryScore,
        attemptCount: previous.attemptCount,
        lastAssessedAt: previous.lastAssessedAt,
        nextReviewAt: previous.nextReviewAt,
        startedAt: previous.startedAt,
        completedAt: previous.completedAt,
        lastEvidence: {
          previous: previous.lastEvidence,
          migration: {
            code: "MIGRATED_FROM_VERSION",
            fromVersionId: from.version.id,
            fromNodeId: mapping.fromNodeId,
            migratedAt: new Date().toISOString(),
          },
        },
      };
    });
  const mappedCurrentNodeId = preview.mappings.find(
    (mapping) => mapping.fromNodeId === enrollment.currentNodeId,
  )?.toNodeId ?? null;
  const migratedEnrollment = await repository.migrateEnrollment(
    userId,
    enrollmentId,
    target.version.id,
    targetProgress,
    mappedCurrentNodeId,
  );
  if (!migratedEnrollment) notFound("Learning enrollment was not found.");
  const migratedProgress = await repository.listProgress(userId, enrollmentId);
  return {
    migrated: true,
    idempotent: false,
    enrollment: migratedEnrollment,
    preview,
    path: buildLearningPath(target.draft, migratedProgress, migratedEnrollment.currentNodeId),
  };
}

async function readContext(
  userId: string,
  enrollmentId: string,
  repository = getLearningRepository(),
): Promise<LearningContext> {
  const enrollment = await repository.getEnrollmentForUser(userId, enrollmentId);
  if (!enrollment) notFound("Learning enrollment was not found.");
  const version = ensureLearnerVersion(
    await getCurriculumRepository().getVersionWithContentById(
      enrollment.curriculumId,
      enrollment.curriculumVersionId,
    ),
  );
  const progress = await repository.listProgress(userId, enrollmentId);
  const path = buildLearningPath(version.draft, progress, enrollment.currentNodeId);
  const nodes = flattenLearningNodes(version.draft);
  return {
    enrollment,
    version,
    path,
    currentNode: nodes.find((node) => node.clientId === path.currentNodeId) ?? null,
    progress,
  };
}

export async function getLearningContextForOwner(
  userId: string,
  enrollmentId: string,
  options: { repository?: LearningRepository } = {},
) {
  return readContext(userId, enrollmentId, options.repository);
}

export type TutorChatResult = LearningContext & {
  response: TutorResponse;
  session: LearningSession;
  sources: SourceChunkMatch[];
};

async function recordTutorAgentUsage(userId: string, response: TutorResponse) {
  await incrementDailyAgentUsage({
    userId,
    tokens: response.usage?.totalTokens ?? 0,
    runsCount: 1,
  });
}

type TutorChatRunContext = {
  userId: string;
  request: TutorRequest;
  context: LearningContext;
  session: LearningSession;
  skill: TeachingSkill;
  currentNodeId: string;
  recentMessages: LearningMessage[];
  recentErrors: string[];
  sources: SourceChunkMatch[];
};

// Same content-to-{chars, sha256} summary the curriculum runner persists for
// model steps; prompt bodies are never stored.
function summarizeTutorContextMessages(request: TutorRequest, recentMessages: LearningMessage[]) {
  const entries = recentMessages.map((message) => {
    const content = JSON.stringify(message.blocks);
    return {
      role: message.role === "user" ? "user" : "assistant",
      chars: content.length,
      sha256: hashTelemetryText(content),
    };
  });
  const trimmed = request.message?.trim();
  if (trimmed) entries.push({ role: "user", chars: trimmed.length, sha256: hashTelemetryText(trimmed) });
  return JSON.stringify(entries);
}

// Creates + starts a lightweight run for one tutor chat so metrics and trace
// endpoints cover the tutor. Tutor runs share the one-active-run-per-curriculum
// constraint with curriculum_builder; an in-flight generation must never block
// a chat, so AGENT_RUN_CONFLICT degrades to serving the turn without a record.
async function startTutorChatRun(input: TutorChatRunContext): Promise<AgentRunDto | null> {
  const { enrollment } = input.context;
  try {
    const { run } = await createRun({
      agentType: "tutor",
      userId: input.userId,
      projectId: null,
      curriculumId: enrollment.curriculumId,
      curriculumVersionId: enrollment.curriculumVersionId,
      enrollmentId: enrollment.id,
      idempotencyKey: createId("tutor-chat"),
      // Privacy-safe summary only: ids, enums and counts — never the
      // assembled prompt or conversation text.
      input: {
        enrollmentId: enrollment.id,
        nodeId: input.currentNodeId,
        sessionId: input.session.id,
        skillId: input.skill.id,
        action: input.request.action ?? null,
        targetNodeId: input.request.targetNodeId ?? null,
        messageLength: input.request.message?.trim().length ?? 0,
        recentMessageCount: input.recentMessages.length,
        recentErrorCount: input.recentErrors.length,
        sourceCount: input.sources.length,
      },
      budget: TUTOR_AGENT_BUDGET,
    });
    return await startRun(run.id);
  } catch (error) {
    if (isAgentError(error) && error.code === "AGENT_RUN_CONFLICT") {
      console.warn("BranchMind tutor run recording degraded", {
        code: error.code,
        curriculumId: enrollment.curriculumId,
        enrollmentId: enrollment.id,
      });
      return null;
    }
    throw error;
  }
}

function buildTutorChatRunUsage(response: TutorResponse, sourceCount: number): AgentRunUsage {
  const usage = response.usage;
  const modelCalls = usage
    ? [createModelCallUsage({
        provider: usage.provider,
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        durationMs: usage.durationMs,
      })]
    : [];
  return {
    agentSteps: 1,
    searchQueries: 1, // The enrolled-source lookup counted by the tutor budget.
    fetchedPages: 0,
    repairLoops: 0,
    sources: sourceCount,
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    runtimeMs: usage?.durationMs ?? 0,
    ...(modelCalls.length > 0
      ? { estimatedCostUsd: modelCalls[0].estimatedCostUsd, modelCalls }
      : {}),
  };
}

// Runs the tutor's single model call inside the run lifecycle: one model
// step, then a terminal finishRun whose usage doubles as the daily-usage
// accounting for the turn (finishRun summarizes it into the daily counters),
// so callers must skip the manual increment when runRecorded is true.
async function runTutorChatWithRunRecord(
  input: TutorChatRunContext,
): Promise<{ response: TutorResponse; runRecorded: boolean }> {
  const agentInput: TutorAgentInput = {
    request: input.request,
    context: input.context,
    session: input.session,
    recentMessages: input.recentMessages,
    sources: input.sources,
    skill: input.skill,
    recentErrors: input.recentErrors,
  };
  const run = await startTutorChatRun(input);
  if (!run) return { response: await runTutorAgent(agentInput), runRecorded: false };

  const stepInput = {
    task: "tutor_chat",
    messagesSummary: summarizeTutorContextMessages(input.request, input.recentMessages),
  };
  const startedAt = Date.now();
  let response: TutorResponse;
  try {
    response = await runTutorAgent(agentInput);
  } catch (error) {
    const tracked = isAgentError(error)
      ? error
      : new AgentError(error instanceof Error ? error.message : String(error), {
          code: "AGENT_STAGE_FAILED",
          status: 500,
        });
    await completeStep({
      runId: run.id,
      stepNumber: 1,
      stage: "teaching",
      stepType: "model",
      toolName: null,
      input: stepInput,
      output: null,
      status: "failed",
      durationMs: Date.now() - startedAt,
      usage: null,
      error: { code: tracked.code, message: tracked.message },
    });
    await finishRun(run.id, {
      status: "failed",
      errorCode: tracked.code,
      errorMessage: tracked.message,
      usage: null,
    });
    throw error;
  }

  await completeStep({
    runId: run.id,
    stepNumber: 1,
    stage: "teaching",
    stepType: "model",
    toolName: null,
    input: stepInput,
    output: {
      lessonGoal: response.lessonGoal,
      currentNodeId: response.currentNodeId,
      blocks: response.blocks,
      progressProposal: response.progressProposal ?? null,
    },
    status: "succeeded",
    durationMs: response.usage?.durationMs ?? Date.now() - startedAt,
    usage: response.usage
      ? createModelCallUsage({
          provider: response.usage.provider,
          model: response.usage.model,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          durationMs: response.usage.durationMs,
        })
      : null,
    error: null,
  });
  await finishRun(run.id, {
    status: "succeeded",
    usage: buildTutorChatRunUsage(response, input.sources.length),
  });
  return { response, runRecorded: true };
}

export async function chatWithTutorForOwner(
  userId: string,
  request: TutorRequest,
  options: { repository?: LearningRepository; skill?: TeachingSkill } = {},
): Promise<TutorChatResult> {
  const repository = options.repository ?? getLearningRepository();
  const skill = options.skill ?? getTeachingSkill(request.skillId);
  const initial = await readContext(userId, request.enrollmentId, repository);
  const requested = request.targetNodeId
    ? evaluateRequestedNode(request.targetNodeId, initial.progress, initial.version.draft)
    : null;
  if (requested && !requested.node) {
    notFound("The requested learning node was not found in this enrollment.");
  }
  const currentNodeId = requested?.node?.nodeId ?? initial.path.currentNodeId;
  const currentNode = requested
    ? flattenLearningNodes(initial.version.draft).find((node) => node.clientId === request.targetNodeId) ?? null
    : initial.currentNode;
  if (!currentNodeId || !currentNode) {
    throw new HttpError("This curriculum has no available learning node.", {
      code: "NO_ELIGIBLE_LEARNING_NODE",
      expose: true,
      status: 409,
    });
  }

  const session = await repository.getOrCreateSession(userId, request.enrollmentId, {
    nodeId: currentNodeId,
    skillId: request.skillId ?? options.skill?.id ?? null,
  });
  if (!session) notFound("Learning session was not found.");

  if (requested && !requested.allowed) {
    const gapResponse: TutorResponse = {
      lessonGoal: `开始「${currentNode.title}」前，请先完成前置节点。`,
      currentNodeId,
      blocks: [{
        type: "prerequisite_gap",
        nodeId: currentNodeId,
        missingNodeIds: requested.missingPrerequisites.map((entry) => entry.nodeId),
        markdown: requested.missingPrerequisites.length > 0
          ? `该节点暂时锁定。请先完成：${requested.missingPrerequisites.map((entry) => `「${entry.title}」`).join("、")}。`
          : requested.reason,
      }],
    };
    const appended = await appendTutorTurn(userId, request.enrollmentId, session.id, {
      userMessage: request.message,
      response: gapResponse,
      session,
    }, repository);
    await recordTutorAgentUsage(userId, appended.response);
    return {
      ...initial,
      response: appended.response,
      session: appended.session ?? session,
      sources: [],
    };
  }

  const activeContext: LearningContext = {
    ...initial,
    path: { ...initial.path, currentNodeId },
    currentNode,
  };

  const sources = await searchEnrolledCourseSources({
    curriculumVersionId: initial.enrollment.curriculumVersionId,
    query: request.message?.trim() || currentNode.title,
    topK: 6,
  });

  // Opening a deterministic eligible node is a server-side state transition;
  // no model/client proposal is treated as mastery or completion.
  const existing = initial.progress.find((row) => row.nodeId === currentNodeId);
  if (!existing || existing.status === "available") {
    await repository.upsertProgress(userId, request.enrollmentId, currentNodeId, {
      status: "in_progress",
      startedAt: existing?.startedAt ?? new Date().toISOString(),
    });
  }
  if (initial.enrollment.currentNodeId !== currentNodeId) {
    await repository.updateEnrollmentCurrentNode(userId, request.enrollmentId, currentNodeId);
  }

  const recentMessages = await listRecentLearningMessages(
    userId,
    request.enrollmentId,
    12,
    repository,
  );
  let recentErrors: string[] = [];
  try {
    const assessments = await getAssessmentRepository().listAssessments(
      userId,
      request.enrollmentId,
      currentNodeId,
    );
    recentErrors = assessments
      .filter((assessment) => assessment.score < 0.6)
      .slice(-5)
      .flatMap((assessment) => {
        const evidence = assessment.evidence;
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
        const weaknesses = (evidence as { weaknesses?: unknown }).weaknesses;
        return Array.isArray(weaknesses)
          ? weaknesses.filter((entry): entry is string => typeof entry === "string")
          : [];
      });
  } catch {
    // Recent-error context is advisory; a missing assessment backend must not
    // block a normal Tutor turn.
  }
  const { response, runRecorded } = await runTutorChatWithRunRecord({
    userId,
    request,
    context: activeContext,
    session,
    currentNodeId,
    recentMessages,
    recentErrors,
    sources,
    skill,
  });

  const allowedSourceIds = new Set(sources.map((source) => source.sourceId));
  const safeBlocks = response.blocks.filter(
    (block) => block.type !== "source" || allowedSourceIds.has(block.sourceId),
  );
  const safeResponse: TutorResponse = {
    ...response,
    currentNodeId,
    blocks: safeBlocks.length > 0 ? safeBlocks : [{
      type: "explanation",
      markdown: `我们先从「${currentNode.title}」开始。请告诉我你目前最困惑的部分。`,
    }],
    progressProposal:
      response.progressProposal?.nodeId === currentNodeId
        ? response.progressProposal
        : undefined,
  };

  const appended = await appendTutorTurn(userId, request.enrollmentId, session.id, {
    userMessage: request.message,
    response: safeResponse,
    session,
  }, repository);
  // finishRun already folded the turn's usage into the daily counters when a
  // run was recorded; the degraded (no-run) path keeps the manual increment.
  if (!runRecorded) await recordTutorAgentUsage(userId, appended.response);

  return {
    ...(await readContext(userId, request.enrollmentId, repository)),
    response: appended.response,
    session: appended.session ?? session,
    sources,
  };
}

export function getLearningVersionStatus(
  version: CurriculumVersionContentDto,
): CurriculumVersionStatus {
  return version.version.status;
}
