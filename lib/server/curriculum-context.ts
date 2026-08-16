// Workspace curriculum context: resolves ChatAttachment.curriculumId
// references into prompt-ready ChatCurriculumContext objects. Mirrors the
// PDF path in lib/server/rag/service.ts (getWorkspaceDocumentContextsForOwner)
// — ownership is enforced per curriculum, the current published version is
// resolved at generation time (so regenerate follows re-publication), and
// retrieval reuses the tutor agent's keyword search over source excerpts
// (searchCourseSources). There are no page semantics here, so curriculum
// snippets are never exposed through the [[cite:N]] citation catalog.

import { getCurriculumRepository } from "@/lib/curriculum/curriculum-repository";
import type { CurriculumDraft } from "@/lib/curriculum/curriculum-types";
import { searchCourseSources } from "@/lib/research/source-chunk-service";
import { isCurriculumAgentEnabled } from "@/lib/server/feature-flags";
import { HttpError } from "@/lib/server/http";
import { compactText } from "@/lib/server/rag/text";
import type { ChatAttachment, ChatCurriculumContext } from "@/lib/types";

const MAX_WORKSPACE_CONTEXT_CURRICULA = 2;
const MAX_CURRICULUM_CONTEXT_SNIPPETS = 6;
const MAX_CURRICULUM_SNIPPET_CHARS = 1400;
const MAX_CURRICULUM_OUTLINE_CHARS = 2400;
const OUTLINE_SUMMARY_CHARS = 80;

// Renders the version's module/node graph as an indented outline the model can
// scan cheaply. The full draft would blow the prompt budget: node summaries
// are compacted, and lines beyond the char budget are dropped in favor of a
// trailing "..." marker (compactText is not used for the whole outline — it
// would collapse the newlines that carry the structure).
export function buildCurriculumOutline(draft: CurriculumDraft): string {
  const lines: string[] = [];
  const sortedModules = [...draft.modules].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const courseModule of sortedModules) {
    lines.push(`- ${courseModule.title}`);
    const nodes = [...courseModule.nodes].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const node of nodes) {
      lines.push(`  - ${node.title}: ${compactText(node.summary, OUTLINE_SUMMARY_CHARS)}`);
    }
  }

  let outline = "";
  for (const line of lines) {
    const candidate = outline ? `${outline}\n${line}` : line;
    // Reserve room for the truncation marker so the result never exceeds the
    // budget, even when the budget is exhausted mid-list.
    if (candidate.length > MAX_CURRICULUM_OUTLINE_CHARS - 4) {
      return outline ? `${outline}\n...` : "...";
    }
    outline = candidate;
  }
  return outline;
}

export async function getWorkspaceCurriculumContextsForOwner(
  userId: string,
  attachments: ChatAttachment[],
  question: string,
): Promise<ChatCurriculumContext[]> {
  // Feature-flag off: silently ignore curriculum attachments so messages
  // created while the flag was on still regenerate cleanly after rollback.
  if (!isCurriculumAgentEnabled()) return [];

  const curriculumIds = Array.from(
    new Set(
      attachments
        .map((attachment) => attachment.curriculumId?.trim())
        .filter((curriculumId): curriculumId is string => Boolean(curriculumId)),
    ),
  ).slice(0, MAX_WORKSPACE_CONTEXT_CURRICULA);

  if (curriculumIds.length === 0) return [];

  const repository = getCurriculumRepository();

  return Promise.all(
    curriculumIds.map(async (curriculumId) => {
      const curriculum = await repository.getCurriculum(userId, curriculumId);
      if (!curriculum) {
        throw new HttpError("Curriculum was not found.", {
          code: "CURRICULUM_NOT_FOUND",
          expose: true,
          status: 404,
        });
      }

      const versions = (await repository.listVersions(userId, curriculumId)) ?? [];
      const version = versions
        .filter((candidate) => candidate.status === "published")
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];
      if (!version) {
        throw new HttpError(
          `Attached curriculum "${curriculum.title}" has no published version yet.`,
          {
            code: "CURRICULUM_VERSION_NOT_PUBLISHED",
            expose: true,
            status: 409,
          },
        );
      }

      const content = await repository.getVersionWithContent(
        userId,
        curriculumId,
        version.id,
      );
      const matches = await searchCourseSources({
        ownerId: userId,
        curriculumVersionId: version.id,
        query: question,
        topK: MAX_CURRICULUM_CONTEXT_SNIPPETS,
      });

      return {
        curriculumId,
        versionId: version.id,
        title: curriculum.title,
        versionLabel: version.versionLabel,
        outline: content ? buildCurriculumOutline(content.draft) : "",
        snippets: matches
          .filter((match) => match.kind === "curriculum_source")
          .map((match) => ({
            chunkId: match.chunkId,
            sourceId: match.sourceId,
            excerpt: compactText(match.excerpt, MAX_CURRICULUM_SNIPPET_CHARS),
            score: match.score,
          })),
      };
    }),
  );
}
