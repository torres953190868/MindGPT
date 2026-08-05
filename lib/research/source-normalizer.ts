// Source normalization for the research pipeline (spec §3.9 step 3):
// canonicalize URLs for deduplication, dedupe search results, and infer a
// CurriculumSourceType from the URL. All functions are pure and deterministic.
//
// inferSourceType is an explicit table of HEURISTICS — it produces a first
// guess so the builder agent and the UI have a sensible default; a human (or
// the agent, with justification) may always override the inferred type.

import {
  CURRICULUM_LIMITS,
  type CurriculumSource,
  type CurriculumSourceType,
} from "@/lib/curriculum/curriculum-types";
import { createId } from "@/lib/ids";
import type { WebSearchResult } from "@/lib/research/web-search-provider";

// Tracking parameters stripped during canonicalization. utm_* is matched by
// prefix; the rest are exact (lower-cased) parameter names.
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "spm",
  "ref_src",
]);

// Canonical form used for deduplication: no fragment, no tracking params,
// lower-cased host, no default port, no trailing slash on non-root paths
// (the root path keeps its "/" so origin-only URLs stay valid). Returns null
// for malformed or non-http(s) URLs.
export function canonicalizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }

  const keysToDelete: string[] = [];
  parsed.searchParams.forEach((_, key) => {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_PARAMETERS.has(normalized)) {
      keysToDelete.push(key);
    }
  });
  for (const key of keysToDelete) parsed.searchParams.delete(key);

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

// Dedupes by canonical URL, keeping the first occurrence (search providers
// return results in relevance order, so the first hit is the best-ranked).
export function dedupeSearchResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const deduped: WebSearchResult[] = [];
  for (const result of results) {
    const key = canonicalizeUrl(result.url) ?? result.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Source-type heuristics. First matching rule wins, so rules are ordered from
// most to least specific. Each rule documents what it recognizes.
// ---------------------------------------------------------------------------

type SourceTypeRule = {
  type: CurriculumSourceType;
  matches: (url: URL) => boolean;
  note: string;
};

const ACADEMIC_HOST_PATTERN = /(^|\.)edu$|\.(edu|ac)\.[a-z]{2,3}$/i;

const SOURCE_TYPE_RULES: SourceTypeRule[] = [
  {
    // Preprint servers, DOI resolvers and scholarly indexes.
    type: "research_paper",
    matches: (url) =>
      /(^|\.)(arxiv|biorxiv|medrxiv|doi|semanticscholar)\.org$/i.test(url.hostname) ||
      /(^|\.)scholar\.google\.[a-z.]+$/i.test(url.hostname) ||
      /(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/i.test(url.hostname),
    note: "preprint server, DOI resolver or scholarly index",
  },
  {
    // Standards bodies and RFC repositories.
    type: "standard",
    matches: (url) =>
      /(^|\.)(iso|ietf|w3|ecma-international|ansi|rfc-editor)\.org$/i.test(url.hostname) ||
      /(^|\.)nist\.gov$/i.test(url.hostname),
    note: "standards body or RFC repository",
  },
  {
    // Academic domains: *.edu, *.edu.<cc>, *.ac.<cc> (ac.cn, ac.uk, ...).
    type: "university_course",
    matches: (url) => ACADEMIC_HOST_PATTERN.test(url.hostname),
    note: "academic domain",
  },
  {
    // Official documentation hosts and conventional docs paths.
    type: "official_documentation",
    matches: (url) =>
      /^(docs|developer|devdocs|reference|learn|api)\./i.test(url.hostname) ||
      /(^|\.)readthedocs\.io$/i.test(url.hostname) ||
      /^\/(docs|documentation|reference|manual)(\/|$)/i.test(url.pathname),
    note: "documentation host or docs path",
  },
  {
    // Book publishers and ISBN-shaped paths.
    type: "textbook",
    matches: (url) =>
      /(^|\.)(oreilly|springer|wiley|pearson|manning|pragprog|cambridge|routledge)\.com$/i.test(
        url.hostname,
      ) ||
      /(^|\.)(oup|mitpress)\.(com|org)$/i.test(url.hostname) ||
      /\/isbn[/-]/i.test(url.pathname),
    note: "publisher domain or ISBN path",
  },
  {
    // Practitioner write-ups: blogs and newsletter platforms. Deliberately
    // ranked below institutional sources but above "other".
    type: "industry_guide",
    matches: (url) =>
      /(^|\.)(medium|substack)\.com$/i.test(url.hostname) ||
      /(^|\.)dev\.to$/i.test(url.hostname) ||
      /(^|\.)hashnode\.dev$/i.test(url.hostname) ||
      /(^|\.)wordpress\.com$/i.test(url.hostname) ||
      /(^|\.)blogspot\.com$/i.test(url.hostname) ||
      /(^|[./])blog([./]|$)/i.test(url.hostname) ||
      /^\/blog(\/|$)/i.test(url.pathname),
    note: "blog or newsletter platform",
  },
];

// Heuristic guess at the CurriculumSourceType for a URL; "other" when no rule
// matches or the URL is unparseable. See the module header: overridable.
export function inferSourceType(url: string): CurriculumSourceType {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "other";
  }
  for (const rule of SOURCE_TYPE_RULES) {
    if (rule.matches(parsed)) return rule.type;
  }
  return "other";
}

function clampQualityScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

// Maps a (deduped) search result onto the CurriculumSource draft shape. The
// url is canonicalized; retrievedAt is the fetch timestamp supplied by the
// caller. The id is a clientId placeholder — persistence assigns server ids.
export function toCurriculumSourceCandidate(
  result: WebSearchResult,
  options: { fetchedAt: string; qualityScore: number; id?: string; notes?: string },
): CurriculumSource {
  const canonicalUrl = canonicalizeUrl(result.url) ?? result.url.trim();
  const title = result.title.trim();
  return {
    id: options.id ?? createId("csrc"),
    url: canonicalUrl.slice(0, CURRICULUM_LIMITS.maxSourceUrlLength),
    title: (title || result.domain || canonicalUrl).slice(
      0,
      CURRICULUM_LIMITS.maxSourceTitleLength,
    ),
    publisher: result.domain
      ? result.domain.slice(0, CURRICULUM_LIMITS.maxSourcePublisherLength)
      : undefined,
    sourceType: inferSourceType(result.url),
    retrievedAt: options.fetchedAt,
    qualityScore: clampQualityScore(options.qualityScore),
    notes: options.notes?.trim() || undefined,
  };
}
