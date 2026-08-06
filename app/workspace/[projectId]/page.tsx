import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

type WorkspacePageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { projectId } = await params;
  return <WorkspaceShell projectId={projectId} />;
}
