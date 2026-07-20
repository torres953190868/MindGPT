import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AdminNav } from "@/components/admin/AdminNav";
import { getAdminAccess } from "@/lib/server/admin-auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await getAdminAccess();

  if (!access.allowed && access.reason === "auth_required") {
    redirect("/auth/sign-in?next=/admin");
  }

  if (!access.allowed) {
    return (
      <main className="grid min-h-[100svh] place-items-center bg-[#f7f5f0] px-4 text-[#25222b]">
        <section className="max-w-md rounded-lg border border-[#e4ddd4] bg-[#fffdf9] p-6 text-center shadow-[0_14px_34px_rgba(35,31,26,0.06)]">
          <h1 className="text-2xl font-black">Admin access required</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#7b717f]">
            This account doesn&apos;t have admin access.
          </p>
          <p className="mt-1 text-xs leading-5 text-[#9a909f]">
            It is not listed in BRANCHMIND_ADMIN_EMAILS.
          </p>
          <Link
            href="/projects"
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#25222b] px-4 text-sm font-black text-white shadow-[0_12px_26px_rgba(37,34,43,0.2)] transition hover:-translate-y-0.5 hover:bg-[#17151b]"
          >
            Back to projects
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[100svh] bg-[#f7f5f0] text-[#25222b]">
      <div className="mx-auto flex min-h-[100svh] max-w-7xl flex-col px-3 py-5 sm:px-4 sm:py-7 lg:px-6 lg:py-10">
        <header className="mb-5 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/projects"
              aria-label="Back to projects"
              className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-full border border-[#ddd5cb] bg-[#fffdf9] px-3.5 text-sm font-bold text-[#4f4650] shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-[#cfc5b8] hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#d9cdbd]/35"
            >
              <ArrowLeft size={16} />
              Back
            </Link>
            <h1 className="text-2xl font-black tracking-normal text-[#25222b] sm:text-3xl">BranchMind Admin</h1>
            <p className="mt-1.5 text-sm font-semibold text-[#7b717f]">
              Models, routing, and user-reported bugs.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d6e4dc] bg-[#edf3ef] px-3.5 py-2 text-xs font-black text-[#2f6651] shadow-[0_8px_24px_rgba(35,31,26,0.05)]">
            <ShieldCheck size={14} />
            {access.email}
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-5 lg:flex-row lg:gap-8">
          <AdminNav />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </main>
  );
}
