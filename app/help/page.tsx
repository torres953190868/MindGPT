import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Brain,
  FileText,
  FolderKanban,
  GitBranch,
  Layers,
  LogIn,
  Mail,
} from "lucide-react";
import { ResponsiveHeader } from "@/components/ResponsiveHeader";
import { getBranchMindLanguage, LANGUAGE_COOKIE_NAME } from "@/lib/language";
import { LANGUAGE_COPY } from "@/lib/language-copy";
import {
  buildFaqPageJsonLd,
  buildSoftwareApplicationJsonLd,
} from "@/lib/help-structured-data";

const appOrigin = (process.env.APP_ORIGIN ?? "https://branchmind.app").replace(/\/+$/, "");

export const metadata: Metadata = {
  title: "Help & Support",
  description:
    "BranchMind 帮助与支持：功能介绍、使用方式、常见问题与联系支持。BranchMind help & support: feature overview, how it works, FAQ, and how to reach support.",
  alternates: { canonical: "/help" },
};

const featureCardVariants = ["branch-right", "continue-down", "node-context", "pdf-rag"] as const;

const featureCardIcons = [
  <GitBranch key="branch-right" size={20} />,
  <ArrowDown key="continue-down" size={20} />,
  <Layers key="node-context" size={20} />,
  <FileText key="pdf-rag" size={20} />,
];

export default async function HelpPage() {
  const cookieStore = await cookies();
  const language = getBranchMindLanguage(cookieStore.get(LANGUAGE_COOKIE_NAME)?.value);
  const copy = LANGUAGE_COPY[language];

  return (
    <main
      className="min-h-[100svh] px-3 py-4 sm:px-5 sm:py-6"
      aria-labelledby="help-hero-title"
      data-testid="help-page"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildSoftwareApplicationJsonLd(appOrigin)),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildFaqPageJsonLd(copy.help.faq)),
        }}
      />
      <div className="mx-auto flex max-w-4xl flex-col gap-5 sm:gap-8">
        <ResponsiveHeader
          title="BranchMind"
          icon={<Brain size={22} />}
          navLabel="Help navigation"
          navTestId="help-header-navigation"
          links={[
            {
              href: "/reader",
              label: copy.reader.title,
              icon: <FileText size={17} />,
              testId: "help-header-reader-link",
            },
            {
              href: "/projects",
              label: copy.common.projects,
              icon: <FolderKanban size={17} />,
              testId: "help-header-projects-link",
            },
            {
              href: "/auth/sign-in",
              label: copy.common.signIn,
              icon: <LogIn size={17} />,
              testId: "help-header-sign-in-link",
            },
          ]}
        />

        <section
          aria-labelledby="help-hero-title"
          data-testid="help-hero-section"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <p className="text-sm font-extrabold uppercase tracking-[0.08em] text-[#6a5d74]">
            {copy.help.eyebrow}
          </p>
          <h1
            id="help-hero-title"
            data-testid="help-hero-title"
            className="mt-2 text-3xl font-black text-[#312737] sm:text-4xl"
          >
            {copy.help.heroTitle}
          </h1>
          <p
            data-testid="help-hero-lead"
            className="mt-3 max-w-2xl text-base leading-8 text-[#695d72]"
          >
            {copy.help.heroLead}
          </p>
        </section>

        <section
          aria-labelledby="help-features-title"
          data-testid="help-features-section"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <h2 id="help-features-title" className="text-2xl font-black text-[#312737]">
            {copy.help.featuresTitle}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {copy.help.features.map((feature, index) => (
              <article
                key={feature.title}
                data-testid={`help-feature-card-${featureCardVariants[index]}`}
                className="rounded-lg border border-white/85 bg-white/72 p-4 shadow-sm"
              >
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e5f6ee] text-[#3d7558] shadow-sm">
                  {featureCardIcons[index]}
                </div>
                <h3 className="mt-3 text-lg font-extrabold text-[#382f41]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[#695d72]">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="help-steps-title"
          data-testid="help-steps-section"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <h2 id="help-steps-title" className="text-2xl font-black text-[#312737]">
            {copy.help.stepsTitle}
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {copy.help.steps.map((step, index) => (
              <li
                key={step.title}
                data-testid={`help-step-item-${index + 1}`}
                className="rounded-lg border border-white/85 bg-white/72 p-4 shadow-sm"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#f7d8e5] text-sm font-black text-[#7c4e70]">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-base font-extrabold text-[#382f41]">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[#695d72]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="help-faq-title"
          data-testid="help-faq-section"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <h2 id="help-faq-title" className="text-2xl font-black text-[#312737]">
            {copy.help.faqTitle}
          </h2>
          <div className="mt-4 space-y-5">
            {copy.help.faq.map((item, index) => (
              <section key={item.question} data-testid={`help-faq-item-${index + 1}`}>
                <h3 className="text-base font-extrabold text-[#382f41]">{item.question}</h3>
                <p className="mt-2 text-sm leading-7 text-[#695d72]">{item.answer}</p>
              </section>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="help-support-contact-title"
          data-testid="help-support-contact-section"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <h2 id="help-support-contact-title" className="text-2xl font-black text-[#312737]">
            {copy.help.contactTitle}
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="mailto:support@branchmind.app"
              data-testid="help-support-contact-email-link"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-white/90 bg-white/75 px-5 py-2.5 text-sm font-extrabold text-neutral-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
            >
              <Mail size={17} />
              {copy.help.contactEmailLabel}
            </a>
            <p
              data-testid="help-support-contact-bug-note"
              className="text-sm leading-7 text-[#695d72]"
            >
              {copy.help.contactBugNote}
            </p>
          </div>
        </section>

        <section
          aria-labelledby="help-cta-title"
          data-testid="help-cta-section"
          className="rounded-lg border border-white/80 bg-white/78 p-4 shadow-lg shadow-[#e8dcef]/30 sm:p-6 md:p-8"
        >
          <h2 id="help-cta-title" className="text-2xl font-black text-[#312737]">
            {copy.help.ctaTitle}
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              data-testid="help-cta-workspace-button"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[18px] bg-success-600 px-5 py-2.5 text-sm font-black text-white shadow-md transition hover:bg-success-700 focus:outline-none focus:ring-4 focus:ring-success-100"
            >
              {copy.help.ctaWorkspace}
              <ArrowRight size={17} />
            </Link>
            <Link
              href="/auth/sign-in"
              data-testid="help-cta-sign-in-link"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[18px] border border-white/90 bg-white/75 px-5 py-2.5 text-sm font-extrabold text-neutral-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
            >
              {copy.help.ctaSignIn}
            </Link>
          </div>
        </section>

        <footer
          data-testid="help-footer"
          className="flex flex-wrap items-center justify-between gap-3 pb-2 text-sm font-bold text-[#7c7184]"
        >
          <span>BranchMind</span>
          <nav aria-label="Help footer navigation" className="flex items-center gap-4">
            <Link
              href="/privacy"
              data-testid="help-footer-privacy-link"
              className="transition hover:text-[#312737]"
            >
              {copy.help.footerPrivacy}
            </Link>
            <Link
              href="/terms"
              data-testid="help-footer-terms-link"
              className="transition hover:text-[#312737]"
            >
              {copy.help.footerTerms}
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
