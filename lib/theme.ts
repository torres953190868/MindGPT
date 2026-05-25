export const THEME_COOKIE_NAME = "branchmind-theme";
export const THEME_STORAGE_KEY = "branchmind-theme";

export const BRANCHMIND_THEMES = [
  {
    id: "mineral",
    name: "Mineral",
    description: "A quiet green and ink interface for everyday work.",
    swatches: ["#2f6f5f", "#f7faf9", "#d8e3df"],
  },
  {
    id: "classic-purple",
    name: "Classic Purple",
    description: "The original soft purple BranchMind look.",
    swatches: ["#7c5fb1", "#fff9fb", "#ebe5f5"],
  },
  {
    id: "warm-limestone",
    name: "Warm Limestone",
    description: "A quiet account-center skin with stone neutrals, porcelain panels, and antique olive accents.",
    swatches: ["#29252f", "#f3f0ea", "#7d6b45"],
  },
] as const;

export type BranchMindTheme = (typeof BRANCHMIND_THEMES)[number]["id"];

export const DEFAULT_THEME: BranchMindTheme = "warm-limestone";

export function isBranchMindTheme(value: unknown): value is BranchMindTheme {
  return (
    typeof value === "string" &&
    BRANCHMIND_THEMES.some((theme) => theme.id === value)
  );
}

export function getBranchMindTheme(value: unknown): BranchMindTheme {
  return isBranchMindTheme(value) ? value : DEFAULT_THEME;
}
