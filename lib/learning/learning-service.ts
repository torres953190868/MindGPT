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
  LearningPath,
  LearningSession,
  TeachingSkill,
  TutorRequest,
  TutorResponse,
} from "@/lib/learning/learning-types";
import type { EnrollmentMigrationProgressInput } from "@/lib/learning/learning-repository";
import { runTutorAgent } from "@/lib/agents/tutor/tutor-agent";
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
  const response = await runTutorAgent({
    request,
    context: activeContext,
    session,
    recentMessages,
    sources,
    skill,
    recentErrors,
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
  await recordTutorAgentUsage(userId, appended.response);

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
