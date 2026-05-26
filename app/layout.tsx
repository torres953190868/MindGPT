import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ElementInspectorPlugin } from "@/components/dev/ElementInspectorPlugin";
import { LanguageProvider } from "@/components/language/LanguageProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { getBranchMindLanguage, getHtmlLanguage, LANGUAGE_COOKIE_NAME } from "@/lib/language";
import { getBranchMindTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "BranchMind",
  description: "A visual branching AI conversation workspace.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialTheme = getBranchMindTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const initialLanguage = getBranchMindLanguage(cookieStore.get(LANGUAGE_COOKIE_NAME)?.value);

  return (
    <html
      lang={getHtmlLanguage(initialLanguage)}
      data-language={initialLanguage}
      data-theme={initialTheme}
      suppressHydrationWarning
    >
      <body>
        <LanguageProvider initialLanguage={initialLanguage}>
          <ThemeProvider initialTheme={initialTheme}>
            <ElementInspectorPlugin />
            {children}
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
