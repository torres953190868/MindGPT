import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SettingsLayoutShell } from "@/components/settings/SettingsLayoutShell";

export const metadata: Metadata = {
  title: "Settings",
  description: "管理 BranchMind 账户、外观、语言与用量设置。Manage your BranchMind settings.",
};

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsLayoutShell>{children}</SettingsLayoutShell>;
}
