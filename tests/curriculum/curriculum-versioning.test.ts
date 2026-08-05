// Versioning/publish semantics for the curriculum domain (spec §7.2/§8.4,
// phase scope of §15.3), against the real file-backed repository with an
// isolated temporary data directory per test. Never touches Supabase.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurriculumRepository } from "@/lib/curriculum/curriculum-repository";
import {
  createCurriculumForOwner,
  createDraftVersionForOwner,
  getCurriculumForOwner,
  getVersionForOwner,
  listVersionsForOwner,
  publishVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import { validateCurriculumDraft } from "@/lib/curriculum/curriculum-validation-service";
import { createValidCurriculumDraft } from "./fixtures";

// Arms a one-way failure injection on the atomic rename at the heart of the
// file backend's write path, so the mid-publish write-failure test can prove
// that nothing partial reaches disk. A plain function (not a vi.fn) so
// vitest's restoreMocks never strips the delegation.
const fsControl = vi.hoisted(() => ({ failRename: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) => {
      if (fsControl.failRename) throw new Error("Simulated rename failure.");
      return actual.rename(oldPath, newPath);
    },
  };
});

const OWNER = "user_curriculum_versioning";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-curriculum-versioning-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  fsControl.failRename = false;
});

afterEach(async () => {
  fsControl.failRename = false;
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

async function createCurriculumWithDraft() {
  const curriculum = await createCurriculumForOwner(OWNER, {
    title: "Foundations of Testing",
    subject: "Software Testing",
    learningGoal: "Be able to design and run a reliable test suite.",
  });
  const draft = await createDraftVersionForOwner(
    OWNER,
    curriculum.id,
    createValidCurriculumDraft(),
  );
  return { curriculum, draft };
}

describe("curriculum versioning", () => {
  it("publishes a draft version and activates the curriculum", async () => {
    const { curriculum, draft } = await createCurriculumWithDraft();

    const published = await publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true);

    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeTruthy();
    expect((await getCurriculumForOwner(OWNER, curriculum.id)).status).toBe("active");
  });

  it("supersedes the previously published version when a new one is published", async () => {
    const { curriculum, draft } = await createCurriculumWithDraft();
    const first = await publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true);

    const secondDraft = await createDraftVersionForOwner(
      OWNER,
      curriculum.id,
      createValidCurriculumDraft(),
    );
    expect(secondDraft.version.versionNumber).toBe(2);
    const second = await publishVersionForOwner(
      OWNER,
      curriculum.id,
      secondDraft.version.id,
      true,
    );

    expect(second.status).toBe("published");
    expect(second.publishedAt).toBeTruthy();

    const versions = await listVersionsForOwner(OWNER, curriculum.id);
    const statusById = new Map(versions.map((version) => [version.id, version.status]));
    expect(statusById.get(first.id)).toBe("superseded");
    expect(statusById.get(second.id)).toBe("published");
    expect(versions.filter((version) => version.status === "published")).toHaveLength(1);
  });

  it("rejects publishing a version that is not a draft (409)", async () => {
    const { curriculum, draft } = await createCurriculumWithDraft();
    await publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true);

    // Republishing the same (now published) version conflicts...
    await expect(
      publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true),
    ).rejects.toMatchObject({
      status: 409,
      code: "CURRICULUM_VERSION_NOT_DRAFT",
      details: { status: "published" },
    });

    // ...and so does publishing a superseded one.
    const secondDraft = await createDraftVersionForOwner(
      OWNER,
      curriculum.id,
      createValidCurriculumDraft(),
    );
    await publishVersionForOwner(OWNER, curriculum.id, secondDraft.version.id, true);
    await expect(
      publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true),
    ).rejects.toMatchObject({
      status: 409,
      code: "CURRICULUM_VERSION_NOT_DRAFT",
      details: { status: "superseded" },
    });
  });

  it("rejects publishing without explicit confirmation (400) and leaves the draft untouched", async () => {
    const { curriculum, draft } = await createCurriculumWithDraft();

    await expect(
      publishVersionForOwner(OWNER, curriculum.id, draft.version.id, false),
    ).rejects.toMatchObject({
      status: 400,
      code: "PUBLISH_CONFIRMATION_REQUIRED",
    });

    const version = await getVersionForOwner(OWNER, curriculum.id, draft.version.id);
    expect(version.version.status).toBe("draft");
    expect(version.version.publishedAt).toBeNull();
    expect((await getCurriculumForOwner(OWNER, curriculum.id)).status).toBe("draft");
  });

  it("does not persist anything when publish-time validation fails", async () => {
    const { curriculum, draft } = await createCurriculumWithDraft();
    await publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true);

    // A draft that turned blocking after creation (here: a dependency cycle
    // written straight through the repository, bypassing service validation)
    // must never reach "published" — publish re-runs deterministic validation
    // before any state changes (spec §8.4).
    const cyclic = createValidCurriculumDraft();
    cyclic.modules[0].nodes[0].prerequisiteClientIds = ["n2"];
    cyclic.modules[0].nodes[1].prerequisiteClientIds = ["n1"];
    const storedValidation = validateCurriculumDraft(cyclic);
    expect(storedValidation.valid).toBe(false);

    const repository = getCurriculumRepository();
    const stored = await repository.createDraftVersion(OWNER, curriculum.id, {
      draft: cyclic,
      validation: storedValidation,
      createdBy: OWNER,
    });
    if (!stored) throw new Error("Expected the cyclic draft version to be stored.");

    await expect(
      publishVersionForOwner(OWNER, curriculum.id, stored.version.id, true),
    ).rejects.toMatchObject({
      status: 422,
      code: "CURRICULUM_VALIDATION_FAILED",
    });

    const versions = await listVersionsForOwner(OWNER, curriculum.id);
    const statusById = new Map(versions.map((version) => [version.id, version.status]));
    expect(statusById.get(draft.version.id)).toBe("published");
    expect(statusById.get(stored.version.id)).toBe("draft");
    expect(versions.filter((version) => version.status === "published")).toHaveLength(1);
  });

  it("does not persist partial state when the file write fails mid-publish", async () => {
    const { curriculum, draft } = await createCurriculumWithDraft();

    fsControl.failRename = true;
    try {
      await expect(
        publishVersionForOwner(OWNER, curriculum.id, draft.version.id, true),
      ).rejects.toThrow(/Simulated rename failure/);
    } finally {
      fsControl.failRename = false;
    }

    // The mutation computed the published state in memory, but the atomic
    // write failed: on-disk state must be exactly as before the publish.
    const version = await getVersionForOwner(OWNER, curriculum.id, draft.version.id);
    expect(version.version.status).toBe("draft");
    expect(version.version.publishedAt).toBeNull();
    expect((await getCurriculumForOwner(OWNER, curriculum.id)).status).toBe("draft");
  });

  it("allocates unique sequential version numbers under concurrent creation", async () => {
    const curriculum = await createCurriculumForOwner(OWNER, {
      title: "Concurrent course",
      learningGoal: "Stress version allocation.",
    });

    const created = await Promise.all(
      Array.from({ length: 5 }, () =>
        createDraftVersionForOwner(OWNER, curriculum.id, createValidCurriculumDraft()),
      ),
    );

    const numbers = created.map((entry) => entry.version.versionNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(created.map((entry) => entry.version.id)).size).toBe(5);
  });
});
