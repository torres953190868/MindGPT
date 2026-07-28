import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

type ResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNext(getStringParam(params?.next));

  return <AuthPageShell mode="reset-password" nextPath={nextPath} />;
}
