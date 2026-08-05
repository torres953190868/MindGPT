// Deterministic source-quality scoring for source screening (spec §3.9 step
// 3). Table-driven: a base score per CurriculumSourceType plus small explicit
// adjustments (domain reputation, publication recency, snippet presence),
// clamped to [0, 1]. Pure and unit-testable; `now` is injectable so recency
// tests are stable. The returned reasons explain the score to the UI.

import type { CurriculumSourceType } from "@/lib/curriculum/curriculum-types";

export type SourceQualityInput = {
  url: string;
  sourceType: CurriculumSourceType;
  publishedAt?: string;
  snippet?: string;
};

export type SourceQualityResult = {
  score: number;
  reasons: string[];
};

// Base trust per source type (spec §3.9 step 3 ranking: institutional and
// vetted sources above practitioner write-ups).
const SOURCE_TYPE_BASE_SCORES: Record<CurriculumSourceType, number> = {
  university_course: 0.85,
  textbook: 0.85,
  official_documentation: 0.8,
  standard: 0.75,
  research_paper: 0.7,
  industry_guide: 0.5,
  other: 0.35,
};

const DOMAIN_REPUTATION_RULES: Array<{
  pattern: RegExp;
  delta: number;
  reason: string;
}> = [
  {
    pattern: /(^|\.)edu$|\.(edu|ac)\.[a-z]{2,3}$/i,
    delta: 0.05,
    reason: "academic domain",
  },
  {
    pattern: /(^|\.)[a-z0-9-]+\.gov(\.[a-z]{2})?$/i,
    delta: 0.05,
    reason: "government domain",
  },
  {
    pattern: /(^|\.)(medium|substack)\.com$|(^|\.)dev\.to$|(^|\.)blogspot\.com$/i,
    delta: -0.05,
    reason: "self-published platform",
  },
];

// Publication dates newer than this many days get a small freshness bump.
const RECENCY_THRESHOLD_DAYS = 365 * 3;
const RECENCY_BONUS = 0.05;
const SNIPPET_BONUS = 0.05;

function extractHostname(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function scoreSource(
  input: SourceQualityInput,
  options: { now?: Date } = {},
): SourceQualityResult {
  const reasons: string[] = [];
  let score = SOURCE_TYPE_BASE_SCORES[input.sourceType];
  reasons.push(
    `source type "${input.sourceType}" has base score ${SOURCE_TYPE_BASE_SCORES[input.sourceType].toFixed(2)}`,
  );

  const hostname = extractHostname(input.url);
  if (hostname) {
    for (const rule of DOMAIN_REPUTATION_RULES) {
      if (rule.pattern.test(hostname)) {
        score += rule.delta;
        reasons.push(
          `${rule.reason} (${rule.delta > 0 ? "+" : ""}${rule.delta.toFixed(2)})`,
        );
        break; // One domain adjustment at most.
      }
    }
  }

  if (input.publishedAt) {
    const publishedMs = Date.parse(input.publishedAt);
    if (Number.isNaN(publishedMs)) {
      reasons.push("publication date is unparseable (+0.00)");
    } else {
      const now = options.now ?? new Date();
      const ageDays = (now.getTime() - publishedMs) / 86_400_000;
      if (ageDays >= 0 && ageDays <= RECENCY_THRESHOLD_DAYS) {
        score += RECENCY_BONUS;
        reasons.push(
          `published within the last ${RECENCY_THRESHOLD_DAYS} days (+${RECENCY_BONUS.toFixed(2)})`,
        );
      } else {
        reasons.push("publication date is older than the freshness threshold (+0.00)");
      }
    }
  }

  if (input.snippet?.trim()) {
    score += SNIPPET_BONUS;
    reasons.push(`search snippet is available (+${SNIPPET_BONUS.toFixed(2)})`);
  }

  // Round to 2 decimals so scores are stable to compare and display.
  const clamped = Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
  return { score: clamped, reasons };
}
