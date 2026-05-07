import type { Metadata } from "next";
import { ElementInspectorPlugin } from "@/components/dev/ElementInspectorPlugin";
import "./globals.css";

export const metadata: Metadata = {
  title: "BranchMind",
  description: "A visual branching AI conversation workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ElementInspectorPlugin />
        {children}
      </body>
    </html>
  );
}
