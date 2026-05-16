import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

type ForgotPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNext(getStringParam(params?.next));

  return (
    <AuthPageShell
      mode="forgot-password"
      nextPath={nextPath}
      initialEmail={getStringParam(params?.email) ?? ""}
    />
  );
}
