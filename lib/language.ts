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

export type AccountLanguageResolution = {
  language: BranchMindLanguage;
  shouldSyncAccount: boolean;
};

// The language stored in this browser is the user's latest choice here, so it
// wins over a stale account preference (e.g. when a save raced a page unload)
// and the account is re-synced in the background. With nothing stored, the
// account preference applies.
export function resolveAccountLanguage(
  accountLanguagePreference: unknown,
  storedLocalLanguage: unknown,
): AccountLanguageResolution {
  const localLanguage = isBranchMindLanguage(storedLocalLanguage)
    ? storedLocalLanguage
    : null;
  if (!localLanguage) {
    return {
      language: getBranchMindLanguage(accountLanguagePreference),
      shouldSyncAccount: false,
    };
  }
  const accountLanguage = getBranchMindLanguage(accountLanguagePreference);
  return localLanguage === accountLanguage
    ? { language: accountLanguage, shouldSyncAccount: false }
    : { language: localLanguage, shouldSyncAccount: true };
}
