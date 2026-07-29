import type { AccountDto } from "@/app/api/account/route";
import type { BranchMindLanguage } from "@/lib/language";

export async function patchAccountLanguage(language: BranchMindLanguage) {
  const response = await fetch("/api/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ languagePreference: language }),
    // keepalive lets the save finish even when the page unloads right after
    // the user switches language.
    keepalive: true,
  });
  const data = (await response.json().catch(() => null)) as AccountDto | null;
  if (!response.ok || !data) throw new Error("Language preference could not be saved.");
  return data;
}
