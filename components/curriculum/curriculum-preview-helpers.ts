import type { CurriculumSource } from "@/lib/curriculum/curriculum-types";
import type {
  CurriculumVersionContentResponse,
  CurriculumVersionDiffEntry,
  CurriculumVersionDiffResponse,
} from "@/lib/client/curriculum-api";

export type CurriculumSourceReference = {
  id: string;
  title: string;
  url: string | null;
};

export function resolveCurriculumSourceReferences(
  sourceIds: string[],
  sources: CurriculumSource[],
): CurriculumSourceReference[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return sourceIds.map((id) => {
    const source = byId.get(id);
    return source
      ? { id, title: source.title, url: source.url }
      : { id, title: id, url: null };
  });
}

export type CurriculumDiffSection = "modules" | "nodes" | "edges" | "sources";

export type CurriculumDiffDisplayEntry = CurriculumVersionDiffEntry & {
  section: CurriculumDiffSection;
};

const DIFF_SECTIONS: CurriculumDiffSection[] = ["modules", "nodes", "edges", "sources"];

export function flattenCurriculumDiff(
  diff: CurriculumVersionDiffResponse["diff"],
): CurriculumDiffDisplayEntry[] {
  return DIFF_SECTIONS.flatMap((section) =>
    diff[section].map((entry) => ({ ...entry, section })),
  );
}

export function getBlockingWarningCount(content: CurriculumVersionContentResponse): number {
  const validation = content.validation;
  if (!validation || typeof validation !== "object") return 0;

  const typedValidation = validation as {
    blockingCount?: unknown;
    warnings?: unknown;
  };
  const warningCount = Array.isArray(typedValidation.warnings)
    ? typedValidation.warnings.filter(
        (warning) =>
          warning &&
          typeof warning === "object" &&
          (warning as { severity?: unknown }).severity === "blocking",
      ).length
    : 0;
  const reportedCount =
    typeof typedValidation.blockingCount === "number" ? typedValidation.blockingCount : 0;
  return Math.max(reportedCount, warningCount);
}
