import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCurriculumForOwner, createDraftVersionForOwner, deriveVersionForOwner, publishVersionForOwner } from "@/lib/curriculum/curriculum-service";
import { createValidCurriculumDraft } from "../curriculum/fixtures";

const authState = vi.hoisted(() => ({ principalId: "learner-route", sessionId: "learner-route" }));
const rateLimitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: authState.principalId, email: null, authMode: "local" as const },
    session: { id: authState.sessionId, isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: rateLimitMock,
}));

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-learning-routes-"));
  vi.stubEnv("ENABLE_TUTOR_AGENT", "true");
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  vi.stubEnv("BRANCHMIND_LEARNING_DATA_DIR", dataDir);
  // withIdempotency persists replay records through the agent-run repository;
  // keep that store inside the same isolated tmpdir.
  vi.stubEnv("BRANCHMIND_AGENT_RUNS_DATA_DIR", dataDir);
  vi.stubEnv("AI_MOCK_MODE", "true");
  authState.principalId = "learner-route";
  authState.sessionId = "learner-route";
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

function request(url: string, body: unknown, idempotencyKey?: string) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readTutorSse(response: Response) {
  const text = await response.text();
  const events = [...text.matchAll(/event:\s*([^\n]+)\ndata:\s*([^\n]+)\n\n/g)].map((match) => ({
    event: match[1],
    data: JSON.parse(match[2]),
  }));
  return { text, events, payload: events.find((entry) => entry.event === "complete")?.data.payload };
}

async function createPublishedCourse() {
  const curriculum = await createCurriculumForOwner("author-route", {
    title: "Route Course",
    subject: "Testing",
    learningGoal: "Learn route testing.",
  });
  const draft = await createDraftVersionForOwner(
    "author-route",
    curriculum.id,
    createValidCurriculumDraft(),
  );
  const version = await publishVersionForOwner("author-route", curriculum.id, draft.version.id, true);
  return { curriculum, version };
}

// Persisted node ids differ from the fixture draft's clientIds (clientIds
// only exist until persistence), so resolve a real node id from the stored
// version content.
async function firstLearningNodeId(curriculumId: string, versionId: string) {
  const { getCurriculumRepository } = await import("@/lib/curriculum/curriculum-repository");
  const { flattenLearningNodes } = await import("@/lib/learning/learning-path-service");
  const content = await getCurriculumRepository().getVersionWithContentById(
    curriculumId,
    versionId,
  );
  if (!content) throw new Error("Version content was not found in test setup.");
  return flattenLearningNodes(content.draft)[0].clientId;
}

describe("learning routes", () => {
  it("enrolls idempotently and returns a structured tutor response", async () => {
    const { curriculum, version } = await createPublishedCourse();
    const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");

    const firstResponse = await enroll(
      request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    const first = await firstResponse.json();
    const secondResponse = await enroll(
      request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    const second = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(second.enrollment.id).toBe(first.enrollment.id);

    const { POST: tutor } = await import("@/app/api/tutor/chat/route");
    const tutorResponse = await tutor(
      request("/api/tutor/chat", {
        enrollmentId: first.enrollment.id,
        message: "Explain the first concept.",
      }),
    );
    const tutorStream = await readTutorSse(tutorResponse);
    const tutorBody = tutorStream.payload;
    expect(tutorResponse.status).toBe(200);
    expect(tutorResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(tutorStream.events.map((entry) => entry.event)).toEqual([
      "lesson-block",
      "lesson-block",
      "lesson-block",
      "exercise",
      "progress-proposal",
      "complete",
    ]);
    expect(tutorBody.response.currentNodeId).toBeTruthy();
    expect(tutorBody.response.blocks.length).toBeGreaterThan(0);
    expect(tutorBody.response.progressProposal.proposedStatus).toBe("in_progress");

    const { POST: assess } = await import("@/app/api/tutor/assessments/route");
    const assessmentResponse = await assess(
      request("/api/tutor/assessments", {
        enrollmentId: first.enrollment.id,
        nodeId: tutorBody.response.currentNodeId,
        answer: { text: "A unit test checks one behavior." },
        status: "completed",
      }),
    );
    expect(assessmentResponse.status).toBe(400);

    const validAssessmentResponse = await assess(
      request("/api/tutor/assessments", {
        enrollmentId: first.enrollment.id,
        nodeId: tutorBody.response.currentNodeId,
        answer: { text: "A unit test checks one behavior." },
      }),
    );
    const assessmentBody = await validAssessmentResponse.json();
    expect(validAssessmentResponse.status).toBe(200);
    expect(assessmentBody.assessment.score).toBeGreaterThan(0);
    expect(assessmentBody.progress.status).toBe("in_progress");
  });

  it("accepts versionId as the enrollment compatibility alias", async () => {
    const { curriculum, version } = await createPublishedCourse();
    const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");
    const response = await enroll(
      request(`/api/curricula/${curriculum.id}/enroll`, { versionId: version.id }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).enrollment.curriculumVersionId).toBe(version.id);
  });

  it("hides both endpoints when the tutor flag is disabled", async () => {
    vi.stubEnv("ENABLE_TUTOR_AGENT", "");
    const { curriculum, version } = await createPublishedCourse();
    const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");

    const response = await enroll(
      request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    expect(response.status).toBe(404);
  });

  describe("idempotent replay (spec §11.5)", () => {
    it("replays the first assessment response for a repeated Idempotency-Key", async () => {
      const { curriculum, version } = await createPublishedCourse();
      const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");
      const enrollResponse = await enroll(
        request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      const { enrollment } = await enrollResponse.json();
      const nodeId = await firstLearningNodeId(curriculum.id, version.id);

      const { POST: assess } = await import("@/app/api/tutor/assessments/route");
      const key = "assessment-idem-1";
      const submission = {
        enrollmentId: enrollment.id,
        nodeId,
        answer: { text: "A unit test checks one behavior." },
      };

      const firstResponse = await assess(request("/api/tutor/assessments", submission, key));
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json();
      expect(first.created).toBe(true);

      const secondResponse = await assess(request("/api/tutor/assessments", submission, key));
      expect(secondResponse.status).toBe(200);
      const second = await secondResponse.json();
      // Served from the 24h idempotency store: the body is the exact first
      // response. A re-executed handler would instead report created:false
      // through the service-level answer-hash dedup.
      expect(second).toEqual(first);

      // The handler ran exactly once: only one assessment record exists.
      const { getAssessmentRepository } = await import("@/lib/learning/assessment-repository");
      const assessments = await getAssessmentRepository().listAssessments(
        "learner-route",
        enrollment.id,
        nodeId,
      );
      expect(assessments).toHaveLength(1);
      expect(assessments[0].id).toBe(first.assessment.id);
    });

    it("replays the first migration response for a repeated Idempotency-Key", async () => {
      const { curriculum, version } = await createPublishedCourse();
      const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");
      const enrollResponse = await enroll(
        request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      const { enrollment } = await enrollResponse.json();

      // The author publishes a successor version; the enrollment stays on the
      // superseded one until migrated.
      const derived = await deriveVersionForOwner("author-route", curriculum.id, version.id);
      const target = await publishVersionForOwner(
        "author-route",
        curriculum.id,
        derived.version.id,
        true,
      );

      const { POST: migrate } = await import(
        "@/app/api/curricula/[curriculumId]/enrollments/[enrollmentId]/migrate/route"
      );
      const key = "migration-idem-1";
      const migration = { targetVersionId: target.id, confirmation: true };
      const url = `/api/curricula/${curriculum.id}/enrollments/${enrollment.id}/migrate`;
      const routeContext = {
        params: Promise.resolve({ curriculumId: curriculum.id, enrollmentId: enrollment.id }),
      };

      const firstResponse = await migrate(request(url, migration, key), routeContext);
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json();
      expect(first.migrated).toBe(true);
      expect(first.enrollment.curriculumVersionId).toBe(target.id);

      const secondResponse = await migrate(request(url, migration, key), routeContext);
      expect(secondResponse.status).toBe(200);
      const second = await secondResponse.json();
      // A re-executed migration would find the enrollment already on the
      // target version and report migrated:false/idempotent:true; the replay
      // returns the exact first response instead.
      expect(second).toEqual(first);
    });
  });

  it("returns 404 when another user chats with someone else's enrollment", async () => {
    const { curriculum, version } = await createPublishedCourse();
    const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");
    const enrollResponse = await enroll(
      request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    const { enrollment } = await enrollResponse.json();

    authState.principalId = "intruder-route";
    authState.sessionId = "intruder-route";
    const { POST: tutor } = await import("@/app/api/tutor/chat/route");
    const response = await tutor(
      request("/api/tutor/chat", {
        enrollmentId: enrollment.id,
        message: "Explain the first concept.",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects a forged masteryScore field and leaves progress untouched", async () => {
    const { curriculum, version } = await createPublishedCourse();
    const { POST: enroll } = await import("@/app/api/curricula/[curriculumId]/enroll/route");
    const enrollResponse = await enroll(
      request(`/api/curricula/${curriculum.id}/enroll`, { curriculumVersionId: version.id }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    const { enrollment } = await enrollResponse.json();
    const nodeId = await firstLearningNodeId(curriculum.id, version.id);

    // Establish real server-scored progress first.
    const { POST: assess } = await import("@/app/api/tutor/assessments/route");
    const validResponse = await assess(
      request("/api/tutor/assessments", {
        enrollmentId: enrollment.id,
        nodeId,
        answer: { text: "A unit test checks one behavior." },
      }),
    );
    expect(validResponse.status).toBe(200);

    const { getLearningRepository } = await import("@/lib/learning/learning-repository");
    const progressBefore = await getLearningRepository().listProgress(
      "learner-route",
      enrollment.id,
    );
    expect(progressBefore).toHaveLength(1);

    const forgedResponse = await assess(
      request("/api/tutor/assessments", {
        enrollmentId: enrollment.id,
        nodeId,
        answer: { text: "A unit test checks one behavior." },
        masteryScore: 0.99,
      }),
    );
    expect(forgedResponse.status).toBe(400);
    const forgedBody = await forgedResponse.json();
    expect(forgedBody.error.code).toBe("VALIDATION_FAILED");

    const progressAfter = await getLearningRepository().listProgress(
      "learner-route",
      enrollment.id,
    );
    expect(progressAfter).toEqual(progressBefore);
  });
});
