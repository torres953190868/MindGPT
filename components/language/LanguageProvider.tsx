"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANGUAGE,
  getBranchMindLanguage,
  getHtmlLanguage,
  LANGUAGE_COOKIE_NAME,
  LANGUAGE_STORAGE_KEY,
  resolveAccountLanguage,
  type BranchMindLanguage,
} from "@/lib/language";
import { patchAccountLanguage } from "@/lib/client/language-preference";
import { LANGUAGE_COPY, type LanguageCopy } from "@/lib/language-copy";
import { useAuthStore } from "@/store/useAuthStore";

type LanguageSaveStatus = "idle" | "saving" | "saved" | "error";

type LanguageContextValue = {
  copy: LanguageCopy;
  language: BranchMindLanguage;
  saveStatus: LanguageSaveStatus;
  setLanguage: (language: BranchMindLanguage) => Promise<void>;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function persistLanguage(language: BranchMindLanguage) {
  document.documentElement.lang = getHtmlLanguage(language);
  document.documentElement.dataset.language = language;
  document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=31536000; SameSite=Lax`;

  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* Local storage can be unavailable in private or locked-down contexts. */
  }
}

export function LanguageProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  initialLanguage?: BranchMindLanguage;
}) {
  const ensureSessionLoaded = useAuthStore((state) => state.ensureSessionLoaded);
  const sessionStatus = useAuthStore((state) => state.sessionStatus);
  const account = useAuthStore((state) => state.account);
  const setAccountCache = useAuthStore((state) => state.setAccountCache);
  const [language, setLanguageState] = useState<BranchMindLanguage>(initialLanguage);
  const [saveStatus, setSaveStatus] = useState<LanguageSaveStatus>("idle");

  useEffect(() => {
    let storedLanguage: string | null = null;

    try {
      storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      storedLanguage = null;
    }

    const resolvedLanguage = getBranchMindLanguage(storedLanguage ?? initialLanguage);
    setLanguageState(resolvedLanguage);
    persistLanguage(resolvedLanguage);
    void ensureSessionLoaded();
  }, [ensureSessionLoaded, initialLanguage]);

  useEffect(() => {
    // Only supabase accounts carry a real preference; local and guest accounts
    // always report the default and must not override the local choice.
    if (!account || account.authMode !== "supabase") return;

    let storedLanguage: string | null = null;
    try {
      storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      storedLanguage = null;
    }

    const resolution = resolveAccountLanguage(account.languagePreference, storedLanguage);
    if (resolution.shouldSyncAccount) {
      void patchAccountLanguage(resolution.language)
        .then(setAccountCache)
        .catch(() => undefined);
    }
    setLanguageState(resolution.language);
    persistLanguage(resolution.language);
  }, [account, setAccountCache]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      const nextLanguage = getBranchMindLanguage(event.newValue);
      setLanguageState(nextLanguage);
      document.documentElement.lang = getHtmlLanguage(nextLanguage);
      document.documentElement.dataset.language = nextLanguage;
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setLanguage = useCallback(
    async (nextLanguage: BranchMindLanguage) => {
      setLanguageState(nextLanguage);
      persistLanguage(nextLanguage);
      setSaveStatus("saving");

      if (sessionStatus !== "authenticated") {
        setSaveStatus("saved");
        return;
      }

      try {
        const updatedAccount = await patchAccountLanguage(nextLanguage);
        setAccountCache(updatedAccount);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [sessionStatus, setAccountCache],
  );

  const value = useMemo(
    () => ({
      copy: LANGUAGE_COPY[language],
      language,
      saveStatus,
      setLanguage,
    }),
    [language, saveStatus, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider.");
  return context;
}
