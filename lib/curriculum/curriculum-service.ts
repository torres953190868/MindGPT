// CurriculumService (spec §8) — business layer between the API routes and
// CurriculumRepository: owner-scoped curriculum CRUD, draft version creation
// with deterministic validation, and the guarded publish flow (spec §8.4).
//
// HTTP semantics are expressed with HttpError (expose: true) so routes can
// pass them straight to safeErrorWithSession: 404 for missing/foreign-owned
// resources, 400 for malformed requests, 409 for publish state conflicts,
// 422 when deterministic validation blocks a draft or a publish.

import { isCurriculumAgentEnabled } from "@/lib/server/feature-flags";
import { HttpError } from "@/lib/server/http";
import {
  getCurriculumRepository,
  type CreateCurriculumInput,
  type CurriculumDto,
  type CurriculumOverviewDto,
  type CurriculumVersionContentDto,
  type CurriculumVersionDto,
  type UpdateCurriculumPatch,
} from "@/lib/curriculum/curriculum-repository";
import {
  curriculumDraftSchema,
  curriculumVersionPatchSchema,
  type CurriculumDraft,
} from "@/lib/curriculum/curriculum-types";
import {
  validateCurriculumDraft,
  type CurriculumValidationResult,
} from "@/lib/curriculum/curriculum-validation-service";
import {
  applyCurriculumVersionPatch,
  CurriculumVersionPatchError,
} from "@/lib/curriculum/curriculum-version-edit-service";
import {
  diffCurriculumDrafts,
  type CurriculumVersionDiff,
} from "@/lib/curriculum/curriculum-version-diff-service";

// Gate for every curriculum API route while the agent ships disabled
// (ENABLE_CURRICULUM_AGENT). Throws the same 404 the route would produce for
// an unknown path so the endpoints stay invisible when the flag is off.
export function assertCurriculumAgentEnabled(): void {
  if (!isCurriculumAgentEnabled()) {
    throw new HttpError("Resource not found.", {
      code: "NOT_FOUND",
      expose: true,
      status: 404,
    });
  }
}

function notFound(message: string): never {
  throw new HttpError(message, {
    code: "NOT_FOUND",
    expose: true,
    status: 404,
  });
}

function validationFailed(message: string, validation: CurriculumValidationResult): never {
  throw new HttpError(message, {
    code: "CURRICULUM_VALIDATION_FAILED",
    details: {
      blockingCount: validation.blockingCount,
      advisoryCount: validation.advisoryCount,
      warnings: validation.warnings,
    },
    expose: true,
    status: 422,
  });
}

export async function createCurriculumForOwner(
  ownerId: string,
  input: CreateCurriculumInput,
): Promise<CurriculumDto> {
  return getCurriculumRepository().createCurriculum(ownerId, input);
}

export async function listCurriculaForOwner(ownerId: string): Promise<CurriculumDto[]> {
  return getCurriculumRepository().listCurricula(ownerId);
}

export type AttachableCurriculumDto = {
  curriculumId: string;
  title: string;
  subject: string;
  versionId: string;
  versionLabel: string;
};

// Curricula that can be attached as chat knowledge context: not archived and
// with a current published version. The per-curriculum version lookup is an
// intentional N+1 — owner libraries are small and the endpoint is read
// rate-limited.
export async function listAttachableCurriculaForOwner(
  ownerId: string,
): Promise<AttachableCurriculumDto[]> {
  const repository = getCurriculumRepository();
  const curricula = (await repository.listCurricula(ownerId)).filter(
    (curriculum) => curriculum.status !== "archived",
  );

  const attachable: AttachableCurriculumDto[] = [];
  for (const curriculum of curricula) {
    const versions = (await repository.listVersions(ownerId, curriculum.id)) ?? [];
    const published = versions
      .filter((version) => version.status === "published")
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    if (!published) continue;

    attachable.push({
      curriculumId: curriculum.id,
      title: curriculum.title,
      subject: curriculum.subject,
      versionId: published.id,
      versionLabel: published.versionLabel,
    });
  }
  return attachable;
}

export async function getCurriculumForOwner(
  ownerId: string,
  curriculumId: string,
): Promise<CurriculumDto> {
  const curriculum = await getCurriculumRepository().getCurriculum(ownerId, curriculumId);
  if (!curriculum) notFound("Curriculum was not found.");
  return curriculum;
}

export async function getCurriculumOverviewForOwner(
  ownerId: string,
  curriculumId: string,
): Promise<CurriculumOverviewDto> {
  const overview = await getCurriculumRepository().getCurriculumOverview(ownerId, curriculumId);
  if (!overview) notFound("Curriculum was not found.");
  return overview;
}

export async function updateCurriculumForOwner(
  ownerId: string,
  curriculumId: string,
  patch: UpdateCurriculumPatch,
): Promise<CurriculumDto> {
  if (typeof patch.title !== "string" && typeof patch.learningGoal !== "string") {
    throw new HttpError("No supported curriculum updates provided.", {
      code: "NO_SUPPORTED_UPDATES",
      expose: true,
      status: 400,
    });
  }

  const curriculum = await getCurriculumRepository().updateCurriculum(
    ownerId,
    curriculumId,
    patch,
  );
  if (!curriculum) notFound("Curriculum was not found.");
  return curriculum;
}

// Spec §7.1: a curriculum is only ever archived, never physically deleted.
export async function archiveCurriculumForOwner(
  ownerId: string,
  curriculumId: string,
): Promise<CurriculumDto> {
  const curriculum = await getCurriculumRepository().archiveCurriculum(ownerId, curriculumId);
  if (!curriculum) notFound("Curriculum was not found.");
  return curriculum;
}

// Creates a draft version from a builder-produced draft (spec §8.1/§8.3). The
// draft must pass the zod schema and every deterministic check; a blocking
// warning rejects with 422 and nothing is persisted. The validation report is
// stored in validation_json alongside the version content.
export async function createDraftVersionForOwner(
  ownerId: string,
  curriculumId: string,
  payload: unknown,
  options: { agentRunId?: string | null; validation?: CurriculumValidationResult } = {},
): Promise<CurriculumVersionContentDto> {
  const parsed = curriculumDraftSchema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpError("Curriculum draft failed schema validation.", {
      code: "CURRICULUM_DRAFT_INVALID",
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
          message: issue.message,
        })),
      },
      expose: true,
      status: 400,
    });
  }

  const draft: CurriculumDraft = parsed.data;
  const deterministicValidation = validateCurriculumDraft(draft);
  if (!deterministicValidation.valid) {
    validationFailed("Curriculum draft failed deterministic validation.", deterministicValidation);
  }
  const validation = options.validation
    ? {
        ...options.validation,
        valid: deterministicValidation.valid,
        blockingCount: deterministicValidation.blockingCount,
        advisoryCount: deterministicValidation.advisoryCount,
        warnings: deterministicValidation.warnings,
      }
    : deterministicValidation;

  const created = await getCurriculumRepository().createDraftVersion(ownerId, curriculumId, {
    draft,
    validation,
    createdBy: ownerId,
    agentRunId: options.agentRunId,
  });
  if (!created) notFound("Curriculum was not found.");
  return created;
}

export async function listVersionsForOwner(
  ownerId: string,
  curriculumId: string,
): Promise<CurriculumVersionDto[]> {
  const versions = await getCurriculumRepository().listVersions(ownerId, curriculumId);
  if (!versions) notFound("Curriculum was not found.");
  return versions;
}

export async function getVersionForOwner(
  ownerId: string,
  curriculumId: string,
  versionId: string,
): Promise<CurriculumVersionContentDto> {
  const content = await getCurriculumRepository().getVersionWithContent(
    ownerId,
    curriculumId,
    versionId,
  );
  if (!content) notFound("Curriculum version was not found.");
  return content;
}

/** Update a draft with a structured patch and persist its latest validation. */
export async function updateDraftVersionForOwner(
  ownerId: string,
  curriculumId: string,
  versionId: string,
  payload: unknown,
): Promise<CurriculumVersionContentDto> {
  const parsedPatch = curriculumVersionPatchSchema.safeParse(payload);
  if (!parsedPatch.success) {
    throw new HttpError("Curriculum version patch failed validation.", {
      code: "CURRICULUM_VERSION_PATCH_INVALID",
      details: {
        issues: parsedPatch.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
          message: issue.message,
        })),
      },
      expose: true,
      status: 400,
    });
  }

  const repository = getCurriculumRepository();
  const current = await repository.getVersionWithContent(ownerId, curriculumId, versionId);
  if (!current) notFound("Curriculum version was not found.");
  if (current.version.status !== "draft") {
    throw new HttpError("Only draft versions can be edited.", {
      code: "CURRICULUM_VERSION_NOT_DRAFT",
      details: { status: current.version.status },
      expose: true,
      status: 409,
    });
  }

  let nextDraft: CurriculumDraft;
  try {
    nextDraft = applyCurriculumVersionPatch(current.draft, parsedPatch.data);
  } catch (error) {
    if (error instanceof CurriculumVersionPatchError) {
      throw new HttpError(error.message, {
        code: error.code,
        expose: true,
        status: error.status,
      });
    }
    throw error;
  }

  const parsedDraft = curriculumDraftSchema.safeParse(nextDraft);
  if (!parsedDraft.success) {
    throw new HttpError("Curriculum version patch produced an invalid draft.", {
      code: "CURRICULUM_DRAFT_INVALID",
      details: {
        issues: parsedDraft.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
          message: issue.message,
        })),
      },
      expose: true,
      status: 400,
    });
  }

  // A schema-valid draft may still contain blocking business warnings. Keep
  // it editable so the user can repair the draft; publish revalidates and
  // rejects blocking warnings atomically.
  const validation = validateCurriculumDraft(parsedDraft.data);
  const saved = await repository.saveDraftVersion(ownerId, curriculumId, versionId, {
    draft: parsedDraft.data,
    validation,
  });
  if (saved.kind === "not-found") notFound("Curriculum version was not found.");
  if (saved.kind === "not-draft") {
    throw new HttpError("Only draft versions can be edited.", {
      code: "CURRICULUM_VERSION_NOT_DRAFT",
      details: { status: saved.status },
      expose: true,
      status: 409,
    });
  }
  return saved.content;
}

/** Copy any existing version into a new immutable-numbered draft. */
export async function deriveVersionForOwner(
  ownerId: string,
  curriculumId: string,
  versionId: string,
): Promise<CurriculumVersionContentDto> {
  const source = await getVersionForOwner(ownerId, curriculumId, versionId);
  const validation = validateCurriculumDraft(source.draft);
  const created = await getCurriculumRepository().createDraftVersion(ownerId, curriculumId, {
    draft: source.draft,
    validation,
    buildRequest: source.version.buildRequest,
    createdBy: ownerId,
  });
  if (!created) notFound("Curriculum was not found.");
  return created;
}

export async function diffVersionsForOwner(
  ownerId: string,
  curriculumId: string,
  versionId: string,
  againstVersionId: string,
): Promise<CurriculumVersionDiff> {
  if (!againstVersionId.trim()) {
    throw new HttpError("The against version is required.", {
      code: "AGAINST_VERSION_REQUIRED",
      expose: true,
      status: 400,
    });
  }

  const [version, against] = await Promise.all([
    getVersionForOwner(ownerId, curriculumId, versionId),
    getVersionForOwner(ownerId, curriculumId, againstVersionId),
  ]);
  return diffCurriculumDrafts(
    against.draft,
    version.draft,
    against.version.id,
    version.version.id,
  );
}

// Publishes a draft version (spec §8.4). Publishing is irreversible and
// supersedes the current published version, so it requires explicit
// confirmation, the version must still be a draft, and deterministic
// validation runs again at publish time — a draft that became blocking since
// creation (e.g. rules tightened) is rejected with 422 before any state
// changes.
export async function publishVersionForOwner(
  ownerId: string,
  curriculumId: string,
  versionId: string,
  confirmation: boolean,
): Promise<CurriculumVersionDto> {
  if (confirmation !== true) {
    throw new HttpError("Publishing a curriculum version requires explicit confirmation.", {
      code: "PUBLISH_CONFIRMATION_REQUIRED",
      expose: true,
      status: 400,
    });
  }

  const repository = getCurriculumRepository();
  const content = await repository.getVersionWithContent(ownerId, curriculumId, versionId);
  if (!content) notFound("Curriculum version was not found.");
  if (content.version.status !== "draft") {
    throw new HttpError("Only draft versions can be published.", {
      code: "CURRICULUM_VERSION_NOT_DRAFT",
      details: { status: content.version.status },
      expose: true,
      status: 409,
    });
  }

  const validation = validateCurriculumDraft(content.draft);
  if (!validation.valid) {
    validationFailed(
      "Curriculum version failed deterministic validation at publish time.",
      validation,
    );
  }

  const result = await repository.publishVersion(ownerId, curriculumId, versionId);
  if (result.kind === "not-found") notFound("Curriculum version was not found.");
  if (result.kind === "not-draft") {
    throw new HttpError("Only draft versions can be published.", {
      code: "CURRICULUM_VERSION_NOT_DRAFT",
      details: { status: result.status },
      expose: true,
      status: 409,
    });
  }

  return result.version;
}
