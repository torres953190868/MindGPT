import type { Metadata } from "next";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

export const metadata: Metadata = {
  title: "登录",
  description: "登录 BranchMind，继续你的分支式 AI 对话。Sign in to BranchMind.",
};

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNext(getStringParam(params?.next));

  return (
    <AuthPageShell
      mode="sign-in"
      nextPath={nextPath}
      initialAccountName={
        getStringParam(params?.accountName) ?? getStringParam(params?.email) ?? ""
      }
    />
  );
}
