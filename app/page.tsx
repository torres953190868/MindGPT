import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomeDraftWorkspace } from "@/components/workspace/HomeDraftWorkspace";

export const metadata: Metadata = {
  title: "New Workspace",
  description:
    "从一个研究问题开始，创建你的分支学习画布。Start with a research question and create your branching study canvas.",
  alternates: { canonical: "/" },
  robots: { index: false, follow: true },
};

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function appendSearchParam(params: URLSearchParams, key: string, value: string | string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => params.append(key, item));
    return;
  }

  params.set(key, value);
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;

  if (resolvedSearchParams?.code) {
    const callbackParams = new URLSearchParams();
    Object.entries(resolvedSearchParams).forEach(([key, value]) => {
      if (typeof value === "undefined") return;
      appendSearchParam(callbackParams, key, value);
    });
    redirect(`/auth/callback?${callbackParams.toString()}`);
  }

  return <HomeDraftWorkspace />;
}
