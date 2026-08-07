// Service-layer tests for the curriculum domain, running against the real
// file-backed repository (BRANCHMIND_CURRICULUM_BACKEND=file) with an
// isolated temporary data directory per test. Never touches Supabase.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveCurriculumForOwner,
  createCurriculumForOwner,
  createDraftVersionForOwner,
  getCurriculumForOwner,
  getCurriculumOverviewForOwner,
  getVersionForOwner,
  listCurriculaForOwner,
  listVersionsForOwner,
  updateCurriculumForOwner,
} from "@/lib/curriculum/curriculum-service";
import { createValidCurriculumDraft } from "./fixtures";

const OWNER = "user_curriculum_service";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-curriculum-service-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

describe("curriculum service: curricula", () => {
  it("creates, reads, updates, lists, and archives a curriculum", async () => {
    const created = await createCurriculumForOwner(OWNER, {
      title: "Linear Algebra",
      learningGoal: "Pass the final exam.",
    });

    expect(created.id).toMatch(/^curriculum_/);
    expect(created.ownerUserId).toBe(OWNER);
    expect(created.status).toBe("draft");
    // subject omitted: falls back to the title.
    expect(created.subject).toBe("Linear Algebra");

    const fetched = await getCurriculumForOwner(OWNER, created.id);
    expect(fetched).toEqual(created);

    const updated = await updateCurriculumForOwner(OWNER, created.id, {
      title: "Linear Algebra II",
      learningGoal: "Pass the advanced exam.",
    });
    expect(updated.title).toBe("Linear Algebra II");
    expect(updated.learningGoal).toBe("Pass the advanced exam.");

    const curricula = await listCurriculaForOwner(OWNER);
    expect(curricula.map((curriculum) => curriculum.id)).toEqual([created.id]);

    const archived = await archiveCurriculumForOwner(OWNER, created.id);
    expect(archived.status).toBe("archived");
    expect((await getCurriculumForOwner(OWNER, created.id)).status).toBe("archived");
  });

  it("stores an explicit subject instead of falling back to the title", async () => {
    const created = await createCurriculumForOwner(OWNER, {
      title: "ML 101",
      subject: "Machine Learning",
      learningGoal: "Understand the fundamentals.",
      projectId: "project_123",
    });

    expect(created.subject).toBe("Machine Learning");
    expect(created.projectId).toBe("project_123");
  });

  it("returns curriculum metadata, version summaries, and the newest version content together", async () => {
    const created = await createCurriculumForOwner(OWNER, {
      title: "Overview Course",
      learningGoal: "Load the first screen efficiently.",
    });
    const version = await createDraftVersionForOwner(
      OWNER,
      created.id,
      createValidCurriculumDraft(),
    );

    const overview = await getCurriculumOverviewForOwner(OWNER, created.id);

    expect(overview.curriculum.id).toBe(created.id);
    expect(overview.versions.map((entry) => entry.id)).toEqual([version.version.id]);
    expect(overview.defaultVersion?.version.id).toBe(version.version.id);
    expect(overview.defaultVersion?.draft.modules).toHaveLength(2);
  });

  it("scopes curricula to their owner", async () => {
    const created = await createCurriculumForOwner("user_a", {
      title: "Private course",
      learningGoal: "Stay hidden.",
    });

    await expect(getCurriculumForOwner("user_b", created.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await listCurriculaForOwner("user_b")).toEqual([]);
    await expect(
      updateCurriculumForOwner("user_b", created.id, { title: "Hijack" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(archiveCurriculumForOwner("user_b", created.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects unknown curricula and empty patches", async () => {
    await expect(getCurriculumForOwner(OWNER, "curriculum_missing")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      updateCurriculumForOwner(OWNER, "curriculum_missing", { title: "x" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(archiveCurriculumForOwner(OWNER, "curriculum_missing")).rejects.toMatchObject(
      { status: 404 },
    );

    const created = await createCurriculumForOwner(OWNER, {
      title: "Course",
      learningGoal: "Learn.",
    });
    await expect(updateCurriculumForOwner(OWNER, created.id, {})).rejects.toMatchObject({
      status: 400,
      code: "NO_SUPPORTED_UPDATES",
    });
  });
});

describe("curriculum service: draft versions", () => {
  async function createCurriculum(owner = OWNER) {
    return createCurriculumForOwner(owner, {
      title: "Foundations of Testing",
      subject: "Software Testing",
      learningGoal: "Be able to design and run a reliable test suite.",
    });
  }

  it("creates a draft version with server-assigned ids and a stored validation report", async () => {
    const curriculum = await createCurriculum();
    const draft = createValidCurriculumDraft();

    const created = await createDraftVersionForOwner(OWNER, curriculum.id, draft);

    expect(created.version.versionNumber).toBe(1);
    expect(created.version.status).toBe("draft");
    expect(created.version.versionLabel).toBe(draft.versionLabel);
    expect(created.version.createdBy).toBe(OWNER);
    expect(created.version.publishedAt).toBeNull();

    // The reassembled draft uses persisted server ids as clientIds.
    const reassembled = created.draft;
    expect(reassembled.title).toBe(curriculum.title);
    expect(reassembled.subject).toBe(curriculum.subject);
    expect(reassembled.learningGoal).toBe(curriculum.learningGoal);
    expect(reassembled.modules).toHaveLength(2);

    const [foundations, applied] = reassembled.modules;
    expect(foundations.clientId).toMatch(/^cmod_/);
    expect(foundations.title).toBe("Foundations");
    expect(applied.title).toBe("Applied Practice");

    const [vocabulary, unitTest] = foundations.nodes;
    expect(vocabulary.clientId).toMatch(/^cnode_/);
    expect(vocabulary.title).toBe("Testing Vocabulary");
    // Prerequisite edges are materialized as rows and reassembled from them.
    expect(vocabulary.prerequisiteClientIds).toEqual([]);
    expect(unitTest.prerequisiteClientIds).toEqual([vocabulary.clientId]);
    expect(applied.nodes[0].prerequisiteClientIds).toEqual([unitTest.clientId]);

    // Node-source bindings round-trip through curriculum_node_sources rows.
    const courseSource = reassembled.sources.find(
      (source) => source.url === "https://example.edu/course",
    );
    const textbookSource = reassembled.sources.find(
      (source) => source.url === "https://example.com/textbook",
    );
    expect(courseSource?.id).toMatch(/^csrc_/);
    expect(vocabulary.sourceIds).toEqual([courseSource!.id, textbookSource!.id].sort());
    expect(unitTest.sourceIds).toEqual([textbookSource!.id]);

    const validation = created.validation as {
      valid?: boolean;
      blockingCount?: number;
      advisoryCount?: number;
      warnings?: unknown[];
    };
    expect(validation.valid).toBe(true);
    expect(validation.blockingCount).toBe(0);

    // The detail read path assembles the same content.
    const fetched = await getVersionForOwner(OWNER, curriculum.id, created.version.id);
    expect(fetched.version).toEqual(created.version);
    expect(fetched.draft).toEqual(created.draft);
    expect(fetched.validation).toEqual(created.validation);
  });

  it("lists versions newest first", async () => {
    const curriculum = await createCurriculum();
    const first = await createDraftVersionForOwner(
      OWNER,
      curriculum.id,
      createValidCurriculumDraft(),
    );
    const second = await createDraftVersionForOwner(
      OWNER,
      curriculum.id,
      createValidCurriculumDraft(),
    );

    const versions = await listVersionsForOwner(OWNER, curriculum.id);
    expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);
    expect(versions.map((version) => version.id)).toEqual([
      second.version.id,
      first.version.id,
    ]);
  });

  it("reuses the same draft when an agent run id is repeated", async () => {
    const curriculum = await createCurriculum();
    const draft = createValidCurriculumDraft();
    const first = await createDraftVersionForOwner(OWNER, curriculum.id, draft, {
      agentRunId: "run_t13_same",
    });
    const second = await createDraftVersionForOwner(OWNER, curriculum.id, draft, {
      agentRunId: "run_t13_same",
    });

    expect(second.version.id).toBe(first.version.id);
    expect(await listVersionsForOwner(OWNER, curriculum.id)).toHaveLength(1);
  });

  it("keeps manual drafts independent when no agent run id is supplied", async () => {
    const curriculum = await createCurriculum();
    const first = await createDraftVersionForOwner(OWNER, curriculum.id, createValidCurriculumDraft());
    const second = await createDraftVersionForOwner(OWNER, curriculum.id, createValidCurriculumDraft());

    expect(second.version.id).not.toBe(first.version.id);
    expect(await listVersionsForOwner(OWNER, curriculum.id)).toHaveLength(2);
  });

  it("rejects a blocking draft with 422 and persists nothing", async () => {
    const curriculum = await createCurriculum();
    const draft = createValidCurriculumDraft();
    // A core node without any supporting source is a blocking warning.
    draft.modules[0].nodes[0].sourceIds = [];

    await expect(
      createDraftVersionForOwner(OWNER, curriculum.id, draft),
    ).rejects.toMatchObject({
      status: 422,
      code: "CURRICULUM_VALIDATION_FAILED",
    });

    expect(await listVersionsForOwner(OWNER, curriculum.id)).toEqual([]);
  });

  it("rejects a payload that fails the draft schema with 400", async () => {
    const curriculum = await createCurriculum();

    await expect(
      createDraftVersionForOwner(OWNER, curriculum.id, { title: "not a draft" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "CURRICULUM_DRAFT_INVALID",
    });

    expect(await listVersionsForOwner(OWNER, curriculum.id)).toEqual([]);
  });

  it("returns 404 for version operations on unknown curricula or versions", async () => {
    const curriculum = await createCurriculum();

    await expect(
      createDraftVersionForOwner(OWNER, "curriculum_missing", createValidCurriculumDraft()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(listVersionsForOwner(OWNER, "curriculum_missing")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      getVersionForOwner(OWNER, curriculum.id, "cver_missing"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getVersionForOwner("user_b", curriculum.id, "cver_missing"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
