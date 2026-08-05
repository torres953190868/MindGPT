import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { isCurriculumAgentEnabled } from "@/lib/server/feature-flags";

type WorkspacePageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { projectId } = await params;
  return <WorkspaceShell projectId={projectId} showCurriculumLink={isCurriculumAgentEnabled()} />;
}
