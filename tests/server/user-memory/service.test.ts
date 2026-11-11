import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn(() => false));
const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

import { formatTreeSystemBackgroundBlock } from "@/lib/server/tree-context";
import {
  clearUserMemoryForOwner,
  getUserMemoryForOwner,
  getUserMemoryRepository,
  MAX_STORED_CONCEPTS_PER_USER,
  recordCanvasTurnMemoryForOwner,
  resetInMemoryUserMemoryForTests,
  resolveUserMemorySlotForOwner,
  transferUserMemoryOwnerSafe,
  updateUserMemoryForOwner,
} from "@/lib/server/user-memory";
import type { Database } from "@/lib/supabase/database.types";

type ProfileRow =
  Database["public"]["Tables"]["branchmind_user_memory_profiles"]["Row"];
type ConceptRow =
  Database["public"]["Tables"]["branchmind_user_memory_concepts"]["Row"];

function createMockSupabaseMemoryDb() {
  const profiles = new Map<string, ProfileRow>();
  const concepts = new Map<string, ConceptRow>();

  const client = {
    from: vi.fn((table: string) => {
      if (table === "branchmind_user_memory_profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, ownerId: string) => ({
              maybeSingle: vi.fn(async () => ({
                data: profiles.get(ownerId) ?? null,
                error: null,
              })),
            })),
          })),
          upsert: vi.fn(async (payload: ProfileRow) => {
            const existing = profiles.get(payload.owner_id);
            profiles.set(payload.owner_id, {
              owner_id: payload.owner_id,
              profile_summary: payload.profile_summary ?? "",
              preferred_style: payload.preferred_style ?? "",
              created_at:
                payload.created_at ??
                existing?.created_at ??
                new Date().toISOString(),
              updated_at: payload.updated_at ?? new Date().toISOString(),
            });
            return { error: null };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn(async (_col: string, ownerId: string) => {
              profiles.delete(ownerId);
              return { error: null };
            }),
          })),
        };
      }

      if (table === "branchmind_user_memory_concepts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, ownerId: string) => ({
              order: vi.fn(async () => ({
                data: [...concepts.values()].filter(
                  (row) => row.owner_id === ownerId,
                ),
                error: null,
              })),
            })),
          })),
          upsert: vi.fn(async (rows: ConceptRow | ConceptRow[]) => {
            const list = Array.isArray(rows) ? rows : [rows];
            for (const row of list) {
              // Enforce unique (owner_id, concept_key)
              for (const [id, existing] of concepts.entries()) {
                if (
                  existing.owner_id === row.owner_id &&
                  existing.concept_key === row.concept_key &&
                  id !== row.id
                ) {
                  concepts.delete(id);
                }
              }
              concepts.set(row.id, { ...row });
            }
            return { error: null };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn((_col: string, ownerId: string) => {
              const promiseOrChain = {
                in: vi.fn(async (_inCol: string, ids: string[]) => {
                  const idSet = new Set(ids);
                  for (const [id, row] of concepts.entries()) {
                    if (row.owner_id === ownerId && idSet.has(id)) {
                      concepts.delete(id);
                    }
                  }
                  return { error: null };
                }),
                then: (
                  onfulfilled?: ((value: { error: null }) => unknown) | null,
                ) => {
                  for (const [id, row] of concepts.entries()) {
                    if (row.owner_id === ownerId) {
                      concepts.delete(id);
                    }
                  }
                  return Promise.resolve({ error: null }).then(
                    onfulfilled ?? undefined,
                  );
                },
              };
              return promiseOrChain;
            }),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, profiles, concepts };
}

describe("user-memory service & repositories", () => {
  const originalMemoryBackend = process.env.BRANCHMIND_MEMORY_BACKEND;
  const originalMemoryFile = process.env.BRANCHMIND_USER_MEMORY_FILE;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowFileInProd =
    process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION;
  let tempDir: string | null = null;

  beforeEach(() => {
    resetInMemoryUserMemoryForTests();
    hasSupabaseServerConfigMock.mockReset();
    hasSupabaseServerConfigMock.mockReturnValue(false);
    getSupabaseAdminClientMock.mockReset();
    delete process.env.BRANCHMIND_MEMORY_BACKEND;
    delete process.env.BRANCHMIND_USER_MEMORY_FILE;
  });

  afterEach(async () => {
    if (originalMemoryBackend === undefined) {
      delete process.env.BRANCHMIND_MEMORY_BACKEND;
    } else {
      process.env.BRANCHMIND_MEMORY_BACKEND = originalMemoryBackend;
    }

    if (originalMemoryFile === undefined) {
      delete process.env.BRANCHMIND_USER_MEMORY_FILE;
    } else {
      process.env.BRANCHMIND_USER_MEMORY_FILE = originalMemoryFile;
    }

    (process.env as Record<string, string | undefined>).NODE_ENV =
      originalNodeEnv;

    if (originalAllowFileInProd === undefined) {
      delete process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION;
    } else {
      process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION =
        originalAllowFileInProd;
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("returns undefined slot when an owner has no stored memory", async () => {
    const slot = await resolveUserMemorySlotForOwner("user_empty", "线性代数");
    expect(slot).toBeUndefined();
  });

  it("captures canvas progression end-to-end and ranks relevant concepts across canvases", async () => {
    const ownerId = "learner_cross_canvas";

    // Canvas 1, Turn 1 (root): explicit profile + style + initial concept
    await recordCanvasTurnMemoryForOwner({
      ownerId,
      projectId: "proj_dl",
      nodeId: "node_root",
      mode: "root",
      instruction:
        "我是软件工程大三学生，请用通俗的语言先给直觉，不要跳步。讲讲链式法则。",
      reply: {
        title: "链式法则核心直觉",
        summary: "复合函数变化率等于各层局部导数的乘积。",
      },
    });

    // Canvas 1, Turn 2 (branch with confusion): struggling concept
    await recordCanvasTurnMemoryForOwner({
      ownerId,
      projectId: "proj_dl",
      nodeId: "node_branch_1",
      mode: "branch",
      instruction: "这里的雅可比矩阵维度怎么对齐我还是搞不清，没看懂",
      sourceText: "雅可比矩阵",
      reply: {
        title: "雅可比矩阵维度对齐",
        summary: "m 维输出对 n 维输入求偏导得到 m×n 矩阵。",
      },
      contextSummaries: ["链式法则核心直觉: 复合函数变化率等于各层局部导数的乘积。"],
    });

    // Canvas 1, Turn 3 (continue downward smoothly): promotes parent `链式法则核心直觉` from learning -> mastered
    await recordCanvasTurnMemoryForOwner({
      ownerId,
      projectId: "proj_dl",
      nodeId: "node_cont_1",
      mode: "continue",
      instruction: "继续推导反向传播中的梯度消失现象",
      reply: {
        title: "梯度消失机理",
        summary: "深层网络连乘小于 1 的激活导数导致浅层梯度指数衰减。",
      },
      contextSummaries: ["链式法则核心直觉: 复合函数变化率等于各层局部导数的乘积。"],
    });

    const snapshot = await getUserMemoryForOwner(ownerId);
    expect(snapshot.profileSummary).toContain("软件工程大三学生");
    expect(snapshot.preferredStyle).toContain("先给直觉");
    expect(snapshot.preferredStyle).toContain("不要跳步");

    const byKey = new Map(snapshot.concepts.map((c) => [c.conceptKey, c]));
    expect(byKey.get("链式法则核心直觉")?.status).toBe("mastered");
    expect(byKey.get("雅可比矩阵维度对齐")?.status).toBe("struggling");
    expect(byKey.get("梯度消失机理")?.status).toBe("learning");

    // Canvas 2: query about Jacobian matrices ranks `雅可比矩阵维度对齐` #1
    const slot = await resolveUserMemorySlotForOwner(
      ownerId,
      "在牛顿法里雅可比矩阵和海森矩阵有什么区别？",
      { maxConcepts: 2 },
    );
    expect(slot).toBeDefined();
    expect(slot?.concepts).toHaveLength(2);
    expect(slot?.concepts?.[0]).toMatchObject({
      concept: "雅可比矩阵维度对齐",
      status: "struggling",
    });

    // Compiles directly into TreePromptContext system background block
    const compiledBlock = formatTreeSystemBackgroundBlock(undefined, slot);
    expect(compiledBlock).toContain("User learning memory:");
    expect(compiledBlock).toContain("Profile:");
    expect(compiledBlock).toContain("[struggling] 雅可比矩阵维度对齐");

    // Regression check: if learner later expresses confusion on a mastered concept, it drops back to struggling immediately
    await recordCanvasTurnMemoryForOwner({
      ownerId,
      projectId: "proj_2",
      nodeId: "node_reg",
      mode: "branch",
      instruction: "多变量情况下的链式法则核心直觉我又搞不清了，为什么要求和？",
      reply: {
        title: "链式法则核心直觉",
        summary: "多条依赖路径的偏导贡献需要相加。",
      },
    });

    const afterRegression = await getUserMemoryForOwner(ownerId);
    const regressed = afterRegression.concepts.find(
      (c) => c.conceptKey === "链式法则核心直觉",
    );
    expect(regressed?.status).toBe("struggling");
  });

  it("prunes oldest low-priority concepts at MAX_STORED_CONCEPTS_PER_USER while preserving struggling concepts", async () => {
    const ownerId = "user_cap_test";
    const repo = getUserMemoryRepository();

    // Seed 5 early `struggling` concepts with older timestamps
    await repo.upsertConcepts(
      ownerId,
      Array.from({ length: 5 }, (_, idx) => ({
        concept: `Struggling Topic ${idx + 1}`,
        status: "struggling" as const,
        note: "Needs review",
        lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, idx)).toISOString(),
      })),
    );

    // Seed 60 newer `mastered` and `learning` concepts (total 65 -> capped to 60)
    await repo.upsertConcepts(
      ownerId,
      Array.from({ length: 60 }, (_, idx) => ({
        concept: `Mastered Topic ${idx + 1}`,
        status: idx < 30 ? ("mastered" as const) : ("learning" as const),
        note: "Covered",
        lastSeenAt: new Date(Date.UTC(2026, 1, 1, 0, idx)).toISOString(),
      })),
    );

    const snapshot = await getUserMemoryForOwner(ownerId);
    expect(snapshot.concepts).toHaveLength(MAX_STORED_CONCEPTS_PER_USER);

    const strugglingKept = snapshot.concepts.filter(
      (c) => c.status === "struggling",
    );
    expect(strugglingKept).toHaveLength(5);

    const learningKept = snapshot.concepts.filter(
      (c) => c.status === "learning",
    );
    expect(learningKept).toHaveLength(30);

    // 5 oldest mastered items were pruned, leaving the 25 newest mastered items
    const masteredKept = snapshot.concepts.filter(
      (c) => c.status === "mastered",
    );
    expect(masteredKept).toHaveLength(25);
    expect(
      masteredKept.some((c) => c.concept === "Mastered Topic 1"),
    ).toBe(false);
    expect(
      masteredKept.some((c) => c.concept === "Mastered Topic 30"),
    ).toBe(true);
  });

  it("persists to atomic JSON file when BRANCHMIND_USER_MEMORY_FILE is configured and blocks file store in production", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "branchmind-mem-test-"));
    const memoryFile = path.join(tempDir, "user-memory.json");
    process.env.BRANCHMIND_USER_MEMORY_FILE = memoryFile;
    process.env.BRANCHMIND_MEMORY_BACKEND = "file";

    await updateUserMemoryForOwner("file_owner", {
      profileSummary: "Backend engineer learning Rust",
      preferredStyle: "Use concrete code examples",
      upsertConcepts: [
        {
          concept: "Borrow Checker",
          status: "struggling",
          note: "Lifetime elision rules across struct references",
        },
      ],
    });

    const loaded = await getUserMemoryForOwner("file_owner");
    expect(loaded.profileSummary).toBe("Backend engineer learning Rust");
    expect(loaded.concepts).toHaveLength(1);
    expect(loaded.concepts[0].conceptKey).toBe("borrow checker");

    await clearUserMemoryForOwner("file_owner");
    const cleared = await getUserMemoryForOwner("file_owner");
    expect(cleared.profileSummary).toBe("");
    expect(cleared.concepts).toHaveLength(0);

    // Block file backend in production unless explicitly allowed
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION;
    expect(() => getUserMemoryRepository()).toThrow(/not allowed in production/i);
  });

  it("supports Supabase persistence and merges conflicting concept_keys on owner transfer", async () => {
    const mockDb = createMockSupabaseMemoryDb();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    getSupabaseAdminClientMock.mockReturnValue(mockDb.client);
    process.env.BRANCHMIND_MEMORY_BACKEND = "supabase";

    await updateUserMemoryForOwner("anon_session_1", {
      profileSummary: "大二计算机学生",
      preferredStyle: "先给直觉",
      upsertConcepts: [
        {
          concept: "Dynamic Programming",
          status: "struggling",
          note: "State transition formulation",
        },
        {
          concept: "Binary Search",
          status: "mastered",
          note: "Boundary invariants",
        },
      ],
    });

    await updateUserMemoryForOwner("auth_user_1", {
      profileSummary: "熟悉Python",
      preferredStyle: "不要跳步",
      upsertConcepts: [
        {
          concept: "dynamic programming",
          status: "learning",
          note: "Memoization basics",
        },
      ],
    });

    const transferred = await transferUserMemoryOwnerSafe(
      "anon_session_1",
      "auth_user_1",
    );
    expect(transferred).toBeGreaterThan(0);

    const anonAfter = await getUserMemoryForOwner("anon_session_1");
    expect(anonAfter.profileSummary).toBe("");
    expect(anonAfter.concepts).toHaveLength(0);

    const userAfter = await getUserMemoryForOwner("auth_user_1");
    expect(userAfter.profileSummary).toBe("熟悉Python; 大二计算机学生");
    expect(userAfter.preferredStyle).toBe("不要跳步; 先给直觉");
    expect(userAfter.concepts).toHaveLength(2);

    const dp = userAfter.concepts.find(
      (c) => c.conceptKey === "dynamic programming",
    );
    // Preserves `struggling` over `learning` and sums evidenceCount
    expect(dp?.status).toBe("struggling");
    expect(dp?.evidenceCount).toBe(2);
  });

  it("fails open cleanly and warns at most once when Supabase memory tables are not migrated yet", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    hasSupabaseServerConfigMock.mockReturnValue(true);
    process.env.BRANCHMIND_MEMORY_BACKEND = "supabase";

    const missingTableError = {
      code: "PGRST205",
      message:
        "Could not find the table 'public.branchmind_user_memory_profiles' in the schema cache",
    };

    getSupabaseAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: null,
              error: missingTableError,
            })),
            order: vi.fn(async () => ({
              data: null,
              error: missingTableError,
            })),
          })),
        })),
      })),
    });

    const firstSlot = await resolveUserMemorySlotForOwner("user_1", "test");
    const secondSlot = await resolveUserMemorySlotForOwner("user_1", "test");
    await expect(
      recordCanvasTurnMemoryForOwner({
        ownerId: "user_1",
        mode: "root",
        instruction: "我是大一学生，请用通俗语言讲微积分",
        reply: { title: "极限定义", summary: "ε-δ 定义" },
      }),
    ).resolves.toBeUndefined();

    expect(firstSlot).toBeUndefined();
    expect(secondSlot).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
