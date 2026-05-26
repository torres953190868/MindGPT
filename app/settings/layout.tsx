import type { ReactNode } from "react";
import { SettingsLayoutShell } from "@/components/settings/SettingsLayoutShell";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsLayoutShell>{children}</SettingsLayoutShell>;
}
