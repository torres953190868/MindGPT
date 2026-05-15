import type { Metadata } from "next";
import { ArrowLeft, FileText, FolderKanban, ScrollText } from "lucide-react";
import { ResponsiveHeader } from "@/components/ResponsiveHeader";

export const metadata: Metadata = {
  title: "Privacy Policy | BranchMind",
  description: "BranchMind beta privacy policy.",
};

const privacySections = [
  {
    title: "What BranchMind Collects",
    body: [
      "During the beta, BranchMind stores the project titles, prompts, AI responses, node summaries, node positions, timestamps, and related workspace data needed to run the branching conversation experience.",
      "BranchMind may also process basic technical data that your browser and the app send with requests, such as request timing and error context. The beta does not intentionally collect payment details or special category personal data.",
    ],
  },
  {
    title: "AI Provider Processing",
    body: [
      "When you create or continue a project, your prompt, selected source text, and recent conversation context may be sent to the configured AI provider. This beta is configured to use DeepSeek through its chat completions API.",
      "AI outputs can be inaccurate or incomplete. Do not include secrets, credentials, regulated records, or information you are not allowed to submit to third-party AI services.",
    ],
  },
  {
    title: "User Content",
    body: [
      "You keep responsibility for the content you enter into BranchMind. Your projects are used to provide the product experience, restore your workspace, generate AI replies, and support export or deletion workflows.",
      "BranchMind does not claim ownership over your prompts or project content. You are responsible for ensuring that you have the rights and permissions needed to upload or process that content.",
    ],
  },
  {
    title: "Data Export And Deletion",
    body: [
      "The beta includes per-project JSON export so you can keep a local copy of your project data.",
      "Project deletion removes the selected project from the BranchMind project store. Deletion is intended to be permanent for the beta workspace, although operational backups or logs, if any, may take additional time to expire.",
    ],
  },
  {
    title: "Beta Notice",
    body: [
      "This page is a practical beta-stage privacy notice for product testing and store review. It is not legal advice and should be reviewed by qualified counsel before production launch in regulated or commercial environments.",
      "Questions or deletion requests should be directed to the BranchMind operator or project maintainer for the current deployment.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main
      className="min-h-screen px-5 py-6"
      aria-labelledby="privacy-title"
      data-testid="privacy-page"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <ResponsiveHeader
          title="Privacy Policy"
          icon={<FileText size={22} />}
          navLabel="Compliance navigation"
          navTestId="privacy-compliance-navigation"
          links={[
            {
              href: "/",
              label: "Home",
              icon: <ArrowLeft size={18} />,
              testId: "privacy-home-link",
            },
            {
              href: "/projects",
              label: "Projects",
              icon: <FolderKanban size={17} />,
              testId: "privacy-projects-link",
            },
            {
              href: "/terms",
              label: "Terms",
              icon: <ScrollText size={17} />,
              testId: "privacy-terms-link",
            },
          ]}
        />

        <section
          aria-labelledby="privacy-title"
          data-testid="privacy-policy-content"
          className="rounded-[28px] border border-white/80 bg-white/72 p-6 shadow-lg shadow-[#e8dcef]/35 md:p-8"
        >
          <div className="mb-8 flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-[#e5f6ee] text-[#3d7558] shadow-sm">
              <FileText size={23} />
            </div>
            <div className="space-y-3">
              <p className="text-sm font-extrabold uppercase tracking-[0.08em] text-[#6a5d74]">
                Beta notice
              </p>
              <h1 id="privacy-title" className="text-4xl font-black text-[#312737]">
                Privacy Policy
              </h1>
              <p className="text-sm font-bold text-[#7c7184]">Last updated: May 2, 2026</p>
            </div>
          </div>

          <div className="space-y-7">
            {privacySections.map((section, index) => {
              const sectionId = `privacy-section-${index + 1}`;

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
