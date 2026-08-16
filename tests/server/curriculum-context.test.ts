// Workspace curriculum context tests (lib/server/curriculum-context.ts). Runs
// against the real file-backed curriculum repository in an isolated temp data
// directory — no network, no Supabase. searchCourseSources only touches the
// curriculum chunk store here (no projectId is passed), so the RAG service
// import in source-chunk-service stays unused and unmocked.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCurriculumForOwner,
  createDraftVersionForOwner,
  publishVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import { saveSourceChunks } from "@/lib/research/source-chunk-service";
import {
  buildCurriculumOutline,
  getWorkspaceCurriculumContextsForOwner,
} from "@/lib/server/curriculum-context";
import type { ChatAttachment } from "@/lib/types";
import { createValidCurriculumDraft } from "../curriculum/fixtures";

const OWNER = "user_curriculum_context";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-curriculum-context-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  vi.stubEnv("ENABLE_CURRICULUM_AGENT", "true");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

function curriculumAttachment(curriculumId: string): ChatAttachment {
  return {
    id: `att_${curriculumId}`,
    name: "Course material",
    mimeType: "application/x-branchmind-curriculum",
    size: 0,
    createdAt: "2026-08-16T00:00:00.000Z",
    curriculumId,
  };
}

// Creates a curriculum with one published version and returns the ids needed
// to attach it and to seed source excerpts.
async function createPublishedCurriculum(title = "Deep Learning Foundations") {
  const curriculum = await createCurriculumForOwner(OWNER, {
    title,
    subject: "Deep Learning",
    learningGoal: "Understand the core building blocks of deep learning.",
  });
  const content = await createDraftVersionForOwner(
    OWNER,
    curriculum.id,
    createValidCurriculumDraft(),
  );
  await publishVersionForOwner(OWNER, curriculum.id, content.version.id, true);
  return {
    curriculumId: curriculum.id,
    versionId: content.version.id,
    sourceIds: content.draft.sources.map((source) => source.id),
  };
}

describe("buildCurriculumOutline", () => {
  it("renders modules and nodes as an indented outline", () => {
    const outline = buildCurriculumOutline(createValidCurriculumDraft());

    expect(outline).toContain("- Foundations");
    expect(outline).toContain(
      "  - Testing Vocabulary: Units, integration, and end-to-end basics.",
    );
    expect(outline).toContain("- Applied Practice");
  });

  it("caps the outline at 2400 characters", () => {
    const draft = createValidCurriculumDraft();
    for (const courseModule of draft.modules) {
      for (const node of courseModule.nodes) {
        node.summary = "Testing vocabulary and practice. ".repeat(60);
      }
    }

    expect(buildCurriculumOutline(draft).length).toBeLessThanOrEqual(2400);
  });
});

describe("getWorkspaceCurriculumContextsForOwner", () => {
  it("returns no contexts while the curriculum agent flag is off", async () => {
    vi.stubEnv("ENABLE_CURRICULUM_AGENT", "false");
    const { curriculumId } = await createPublishedCurriculum();

    await expect(
      getWorkspaceCurriculumContextsForOwner(
        OWNER,
        [curriculumAttachment(curriculumId)],
        "testing",
      ),
    ).resolves.toEqual([]);
  });

  it("returns no contexts when nothing references a curriculum", async () => {
    await expect(
      getWorkspaceCurriculumContextsForOwner(OWNER, [], "testing"),
    ).resolves.toEqual([]);
  });

  it("rejects unknown curricula with an exposed 404", async () => {
    await expect(
      getWorkspaceCurriculumContextsForOwner(
        OWNER,
        [curriculumAttachment("cur_missing")],
        "testing",
      ),
    ).rejects.toMatchObject({ code: "CURRICULUM_NOT_FOUND", status: 404 });
  });

  it("rejects curricula without a published version with an exposed 409", async () => {
    const curriculum = await createCurriculumForOwner(OWNER, {
      title: "Unpublished Course",
      subject: "Deep Learning",
      learningGoal: "Stay in draft.",
    });
    await createDraftVersionForOwner(
      OWNER,
      curriculum.id,
      createValidCurriculumDraft(),
    );

    await expect(
      getWorkspaceCurriculumContextsForOwner(
        OWNER,
        [curriculumAttachment(curriculum.id)],
        "testing",
      ),
    ).rejects.toMatchObject({
      code: "CURRICULUM_VERSION_NOT_PUBLISHED",
      status: 409,
    });
  });

  it("resolves the published version's outline and matching excerpts", async () => {
    const { curriculumId, versionId, sourceIds } = await createPublishedCurriculum();
    await saveSourceChunks({
      sourceId: sourceIds[0],
      content:
        "Gradient descent optimizes neural networks by following the loss gradient.",
    });

    const contexts = await getWorkspaceCurriculumContextsForOwner(
      OWNER,
      [curriculumAttachment(curriculumId)],
      "gradient descent",
    );

    expect(contexts).toHaveLength(1);
    const [context] = contexts;
    expect(context).toMatchObject({
      curriculumId,
      versionId,
      title: "Deep Learning Foundations",
      versionLabel: "v1",
    });
    expect(context.outline).toContain("- Foundations");
    expect(context.snippets).toHaveLength(1);
    expect(context.snippets[0]).toMatchObject({ sourceId: sourceIds[0] });
  });

  it("caps attachments at two curricula per generation", async () => {
    const first = await createPublishedCurriculum("Course A");
    const second = await createPublishedCurriculum("Course B");
    const third = await createPublishedCurriculum("Course C");

    const contexts = await getWorkspaceCurriculumContextsForOwner(
      OWNER,
      [first, second, third].map(({ curriculumId }) =>
        curriculumAttachment(curriculumId),
      ),
      "testing",
    );

    expect(contexts).toHaveLength(2);
  });
});
