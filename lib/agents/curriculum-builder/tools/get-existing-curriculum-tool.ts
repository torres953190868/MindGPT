// getExistingCurriculum tool for the CurriculumBuilderAgent (spec §3.6).
// Read-only owner-scoped listing of the user's existing curricula (with their
// latest version) so the research plan can avoid duplicating an existing
// course or consciously derive from it. All filtering happens server-side by
// owner; the optional subject filter is a plain case-insensitive substring
// match on subject/title.

import { z } from "zod";
import { toolError, toolOk, type ToolResult } from "@/lib/agents/curriculum-builder/tools/tool-result";
import type {
  CurriculumDto,
  CurriculumVersionDto,
} from "@/lib/curriculum/curriculum-repository";
import {
  listCurriculaForOwner,
  listVersionsForOwner,
} from "@/lib/curriculum/curriculum-service";
import type { CurriculumStatus, CurriculumVersionStatus } from "@/lib/curriculum/curriculum-types";

export const getExistingCurriculumToolInputSchema = z.object({
  ownerId: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200).optional(),
});
export type GetExistingCurriculumToolInput = z.infer<
  typeof getExistingCurriculumToolInputSchema
>;

export const EXISTING_CURRICULUM_TOOL_LIMIT = 10;

export type ExistingCurriculumSummary = {
  curriculumId: string;
  title: string;
  subject: string;
  status: CurriculumStatus;
  latestVersion: {
    versionId: string;
    versionNumber: number;
    status: CurriculumVersionStatus;
  } | null;
};

export type GetExistingCurriculumToolDeps = {
  listCurricula?: (ownerId: string) => Promise<CurriculumDto[]>;
  listVersions?: (
    ownerId: string,
    curriculumId: string,
  ) => Promise<CurriculumVersionDto[] | null>;
};

function pickLatestVersion(versions: CurriculumVersionDto[]): CurriculumVersionDto | null {
  if (versions.length === 0) return null;
  return [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
}

export async function executeGetExistingCurriculumTool(
  rawInput: GetExistingCurriculumToolInput,
  deps: GetExistingCurriculumToolDeps = {},
): Promise<ToolResult<{ curricula: ExistingCurriculumSummary[] }>> {
  const input = getExistingCurriculumToolInputSchema.parse(rawInput);
  const listCurricula = deps.listCurricula ?? listCurriculaForOwner;
  const listVersions = deps.listVersions ?? listVersionsForOwner;

  try {
    const needle = input.subject?.toLowerCase();
    const curricula = (await listCurricula(input.ownerId))
      .filter((curriculum) => curriculum.status !== "archived")
      .filter(
        (curriculum) =>
          !needle ||
          curriculum.subject.toLowerCase().includes(needle) ||
          curriculum.title.toLowerCase().includes(needle),
      )
      .slice(0, EXISTING_CURRICULUM_TOOL_LIMIT);

    const summaries: ExistingCurriculumSummary[] = await Promise.all(
      curricula.map(async (curriculum) => {
        const versions = (await listVersions(input.ownerId, curriculum.id)) ?? [];
        const latest = pickLatestVersion(versions);
        return {
          curriculumId: curriculum.id,
          title: curriculum.title,
          subject: curriculum.subject,
          status: curriculum.status,
          latestVersion: latest
            ? {
                versionId: latest.id,
                versionNumber: latest.versionNumber,
                status: latest.status,
              }
            : null,
        };
      }),
    );

    return toolOk({ curricula: summaries });
  } catch (error) {
    return toolError(
      "EXISTING_CURRICULUM_QUERY_FAILED",
      error instanceof Error ? error.message : "Listing existing curricula failed.",
    );
  }
}
