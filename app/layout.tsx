import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ElementInspectorPlugin } from "@/components/dev/ElementInspectorPlugin";
import { LanguageProvider } from "@/components/language/LanguageProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { getBranchMindLanguage, getHtmlLanguage, LANGUAGE_COOKIE_NAME } from "@/lib/language";
import { getBranchMindTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

const appOrigin = process.env.APP_ORIGIN ?? "https://branchmind.app";

const description =
  "可视化分支式 AI 对话工作区：在画布上延伸主线、向右开分支，并支持可选中文本的 PDF 阅读与 RAG 检索。A visual branching AI conversation workspace with a selectable-text PDF reader and RAG.";

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin),
  title: {
    default: "BranchMind",
    template: "%s | BranchMind",
  },
  description,
  openGraph: {
    siteName: "BranchMind",
    type: "website",
    locale: "zh_CN",
    alternateLocale: "en_US",
    title: "BranchMind",
    description,
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#2d7a4f",
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
