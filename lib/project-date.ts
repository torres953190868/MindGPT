import type { BranchMindLanguage } from "@/lib/language";

const PROJECT_DATE_LOCALES: Record<BranchMindLanguage, string> = {
  zh: "zh-CN",
  en: "en-US",
};

export function createProjectDateFormatter(language: BranchMindLanguage) {
  return new Intl.DateTimeFormat(PROJECT_DATE_LOCALES[language], {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

export function formatProjectDate(value: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return formatter.format(date);
}
