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
  DEFAULT_THEME,
  getBranchMindTheme,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  type BranchMindTheme,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: BranchMindTheme;
  setTheme: (theme: BranchMindTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function persistTheme(theme: BranchMindTheme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Local storage can be unavailable in private or locked-down contexts. */
  }
}

export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME,
}: {
  children: ReactNode;
  initialTheme?: BranchMindTheme;
}) {
  const [theme, setThemeState] = useState<BranchMindTheme>(initialTheme);

  useEffect(() => {
    let storedTheme: string | null = null;

    try {
      storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      storedTheme = null;
    }

    const resolvedTheme = getBranchMindTheme(storedTheme ?? initialTheme);
    setThemeState(resolvedTheme);
    persistTheme(resolvedTheme);
  }, [initialTheme]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = getBranchMindTheme(event.newValue);
      setThemeState(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setTheme = useCallback((nextTheme: BranchMindTheme) => {
    setThemeState(nextTheme);
    persistTheme(nextTheme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
