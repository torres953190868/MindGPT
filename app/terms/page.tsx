import type { Metadata } from "next";
import { ArrowLeft, FileCheck, FolderKanban, ShieldCheck } from "lucide-react";
import { ResponsiveHeader } from "@/components/ResponsiveHeader";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "BranchMind beta terms of use.",
  alternates: { canonical: "/terms" },
};

const termsSections = [
  {
    title: "Beta Service",
    body: [
      "BranchMind is a beta visual AI workspace for organizing branching conversations into project maps. Features, storage behavior, model behavior, and availability may change during the beta.",
      "These are the current beta-stage terms of use for product review and testing. They are not legal advice and should be reviewed by qualified counsel before production launch.",
    ],
  },
  {
    title: "Your Content",
    body: [
      "You are responsible for the prompts, source text, project titles, and other content you submit. Do not submit content you do not have the right to use or content that violates applicable law or third-party rights.",
      "You retain your rights in user content. BranchMind may process that content to provide the workspace, generate AI responses, save project state, support export, and perform deletion.",
    ],
  },
  {
    title: "AI Provider and Outputs",
    body: [
      "BranchMind may send your prompts, selected source text, and recent conversation context to the configured AI provider. The current beta integration routes requests to the configured AI provider(s) for chat completions.",
      "AI-generated content may be wrong, incomplete, or unsuitable for your use case. You must review outputs before relying on them, especially for academic, legal, medical, financial, safety, or compliance decisions.",
    ],
  },
  {
    title: "Acceptable Use",
    body: [
      "Do not use BranchMind to upload malware, request harmful instructions, violate others' rights, process secrets without authorization, or attempt to disrupt the service.",
      "Do not rely on BranchMind as a system of record for critical data during the beta. Export important projects when you need an independent copy.",
    ],
  },
  {
    title: "Deletion and Availability",
    body: [
      "Project deletion is designed to remove the selected project from the beta project store after confirmation. Export a project before deleting it if you need a copy.",
      "The beta is provided as-is without a guarantee of uninterrupted availability, perfect accuracy, or suitability for a specific purpose.",
    ],
  },
];

export default function TermsPage() {
  return (
    <main
      className="min-h-[100svh] px-3 py-4 sm:px-5 sm:py-6"
      aria-labelledby="terms-title"
      data-testid="terms-page"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5 sm:gap-8">
        <ResponsiveHeader
          title="Terms of Use"
          icon={<FileCheck size={22} />}
          navLabel="Compliance navigation"
          navTestId="terms-compliance-navigation"
          links={[
            {
              href: "/",
              label: "Home",
              icon: <ArrowLeft size={18} />,
              testId: "terms-home-link",
            },
            {
              href: "/privacy",
              label: "Privacy",
              icon: <ShieldCheck size={17} />,
              testId: "terms-privacy-link",
            },
            {
              href: "/projects",
              label: "Projects",
              icon: <FolderKanban size={17} />,
              testId: "terms-projects-link",
            },
          ]}
        />

        <section
          aria-labelledby="terms-title"
          data-testid="terms-content"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <div className="mb-6 flex items-start gap-3 sm:mb-8 sm:gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#f7d8e5] text-[#7c4e70] shadow-sm sm:h-12 sm:w-12">
              <FileCheck size={23} />
            </div>
            <div className="space-y-2 sm:space-y-3">
              <p className="text-sm font-extrabold uppercase tracking-[0.08em] text-[#6a5d74]">
                Beta terms
              </p>
              <h1 id="terms-title" className="text-3xl font-black text-[#312737] sm:text-4xl">
                Terms of Use
              </h1>
              <p className="text-sm font-bold text-[#7c7184]">Last updated: July 17, 2026</p>
            </div>
          </div>

          <div className="space-y-7">
            {termsSections.map((section, index) => {
              const sectionId = `terms-section-${index + 1}`;

              return (
                <section key={section.title} aria-labelledby={sectionId}>
                  <h2
                    id={sectionId}
                    className="text-xl font-extrabold text-[#382f41]"
                  >
                    {section.title}
                  </h2>
                  <div className="mt-3 space-y-3 text-base leading-8 text-[#695d72]">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
