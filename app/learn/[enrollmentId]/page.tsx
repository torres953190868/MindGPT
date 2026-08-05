import { notFound } from "next/navigation";
import TutorClient from "@/components/learning/TutorClient";
import { isTutorAgentEnabled } from "@/lib/server/feature-flags";

type LearnPageProps = { params: Promise<{ enrollmentId: string }> };

export default async function LearnPage({ params }: LearnPageProps) {
  if (!isTutorAgentEnabled()) notFound();
  const { enrollmentId } = await params;
  return <TutorClient enrollmentId={enrollmentId} />;
}

