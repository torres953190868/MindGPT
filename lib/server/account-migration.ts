import { transferProjectsOwner } from "@/lib/server/projects-repository";
import { transferRagOwner } from "@/lib/server/rag/store";

export type AccountMigrationResult = {
  ok: boolean;
  projectsUpdated: number;
  documentsUpdated: number;
  skipped: boolean;
};

function cleanId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function migrateAnonymousDataToUser(
  anonymousSessionId: string | null | undefined,
  userId: string | null | undefined,
): Promise<AccountMigrationResult> {
  const fromId = cleanId(anonymousSessionId);
  const toId = cleanId(userId);

  if (!fromId || !toId || fromId === toId) {
    return {
      ok: true,
      projectsUpdated: 0,
      documentsUpdated: 0,
      skipped: true,
    };
  }

  const [projectsUpdated, documentsUpdated] = await Promise.all([
    transferProjectsOwner(fromId, toId),
    transferRagOwner(fromId, toId),
  ]);

  return {
    ok: true,
    projectsUpdated,
    documentsUpdated,
    skipped: false,
  };
}

export async function tryMigrateAnonymousDataToUser(
  anonymousSessionId: string | null | undefined,
  userId: string | null | undefined,
): Promise<AccountMigrationResult> {
  try {
    return await migrateAnonymousDataToUser(anonymousSessionId, userId);
  } catch (error) {
    console.error("BranchMind account data migration failed", error);
    return {
      ok: false,
      projectsUpdated: 0,
      documentsUpdated: 0,
      skipped: false,
    };
  }
}
