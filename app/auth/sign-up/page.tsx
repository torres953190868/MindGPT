import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { AuthPageShell } from "@/components/auth/AuthPageShell";

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeAuthNext(getStringParam(params?.next));

  return (
    <AuthPageShell
      mode="sign-up"
      nextPath={nextPath}
      initialAccountName={getStringParam(params?.accountName) ?? ""}
    />
  );
}
