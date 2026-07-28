export const LANGUAGE_COOKIE_NAME = "branchmind-language";
export const LANGUAGE_STORAGE_KEY = "branchmind-language";

export const BRANCHMIND_LANGUAGES = [
  {
    id: "zh",
    label: "中文",
    shortLabel: "中文",
    description: "使用中文界面。",
    htmlLang: "zh-CN",
  },
  {
    id: "en",
    label: "English",
    shortLabel: "EN",
    description: "Use the English interface.",
    htmlLang: "en",
  },
] as const;

export type BranchMindLanguage = (typeof BRANCHMIND_LANGUAGES)[number]["id"];

export const DEFAULT_LANGUAGE: BranchMindLanguage = "zh";

export function isBranchMindLanguage(value: unknown): value is BranchMindLanguage {
  return (
    typeof value === "string" &&
    BRANCHMIND_LANGUAGES.some((language) => language.id === value)
  );
}

export function getBranchMindLanguage(value: unknown): BranchMindLanguage {
  return isBranchMindLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function getHtmlLanguage(language: BranchMindLanguage) {
  return BRANCHMIND_LANGUAGES.find((item) => item.id === language)?.htmlLang ?? "zh-CN";
}
