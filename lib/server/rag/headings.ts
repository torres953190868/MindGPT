import type {
  ParsedPage,
  ParsedSection,
  SectionSource,
} from "@/lib/server/rag/types";

type HeadingCandidate = {
  title: string;
  level: number;
  pageNumber: number;
  source: SectionSource;
};

const chapterPattern =
  /^(?:chapter|CHAPTER)\s+([0-9IVXLC]+|[A-Za-z]+)(?:\b|[:：\s-])(.*)$/;
const chineseChapterPattern = /^第[零一二三四五六七八九十百千万两0-9]+章\s*(.*)$/;
const chineseSectionPattern = /^第[零一二三四五六七八九十百千万两0-9]+节\s*(.*)$/;
const decimalHeadingPattern = /^(\d+(?:\.\d+){0,4})[、.\s]+(.{2,})$/;
const chineseListHeadingPattern = /^[一二三四五六七八九十]+、\s*(.{2,})$/;
const terminalPunctuationPattern = /[。！？；，,.!?;:]$/;

function cleanHeadingTitle(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function decimalHeadingLevel(prefix: string) {
  return Math.min(5, prefix.split(".").length + 1);
}

export function detectHeadingLine(line: string): Omit<HeadingCandidate, "pageNumber"> | null {
  const title = cleanHeadingTitle(line);
  if (title.length < 2 || title.length > 120) return null;

  if (chapterPattern.test(title)) {
    return { title, level: 1, source: "regex" };
  }

  if (chineseChapterPattern.test(title)) {
    return { title, level: 1, source: "regex" };
  }

  if (chineseSectionPattern.test(title)) {
    return { title, level: 2, source: "regex" };
  }

  const decimal = title.match(decimalHeadingPattern);
  if (decimal) {
    return {
      title,
      level: decimalHeadingLevel(decimal[1]),
      source: "regex",
    };
  }

  if (chineseListHeadingPattern.test(title)) {
    return { title, level: 2, source: "regex" };
  }

  if (
    title.length <= 60 &&
    !terminalPunctuationPattern.test(title) &&
    !/\s{2,}/.test(title) &&
    /[A-Za-z\u4e00-\u9fff]/.test(title)
  ) {
    return { title, level: 2, source: "font_heuristic" };
  }

  return null;
}

function candidatesFromPages(pages: ParsedPage[]) {
  const candidates: HeadingCandidate[] = [];

  for (const page of pages) {
    for (const line of page.cleanText.split("\n")) {
      const heading = detectHeadingLine(line);
      if (!heading) continue;

      const duplicateOnSamePage = candidates.some(
        (candidate) =>
          candidate.pageNumber === page.pageNumber && candidate.title === heading.title,
      );
      if (!duplicateOnSamePage) {
        candidates.push({ ...heading, pageNumber: page.pageNumber });
      }
    }
  }

  return candidates;
}

function pathForCandidate(stack: string[], candidate: HeadingCandidate) {
  const next = stack.slice(0, Math.max(0, candidate.level - 1));
  next[candidate.level - 1] = candidate.title;
  return next.filter(Boolean);
}

export function createFallbackSections(pageCount: number, groupSize = 8): ParsedSection[] {
  const sections: ParsedSection[] = [];
  for (let start = 1; start <= pageCount; start += groupSize) {
    const end = Math.min(pageCount, start + groupSize - 1);
    sections.push({
      title: `Pages ${start}-${end}`,
      headingPath: [`Pages ${start}-${end}`],
      level: 1,
      pageStart: start,
      pageEnd: end,
      source: "fallback",
    });
  }
  return sections;
}

export function normalizeSectionRanges(
  sections: ParsedSection[],
  pageCount: number,
) {
  return sections
    .filter((section) => section.pageStart >= 1 && section.pageStart <= pageCount)
    .sort((left, right) => left.pageStart - right.pageStart || left.level - right.level)
    .map((section, index, sorted) => {
      const next = sorted
        .slice(index + 1)
        .find((candidate) => candidate.pageStart > section.pageStart);
      const pageEnd = next
        ? Math.max(section.pageStart, next.pageStart - 1)
        : pageCount;

      return {
        ...section,
        pageEnd: Math.min(pageCount, Math.max(section.pageStart, pageEnd)),
      };
    });
}

export function detectSectionsFromPages(pages: ParsedPage[], pageCount = pages.length) {
  const candidates = candidatesFromPages(pages);
  if (candidates.length === 0) return createFallbackSections(pageCount);

  const stack: string[] = [];
  const sections = candidates.map((candidate): ParsedSection => {
    const headingPath = pathForCandidate(stack, candidate);
    stack.length = 0;
    stack.push(...headingPath);

    return {
      title: candidate.title,
      level: candidate.level,
      headingPath,
      pageStart: candidate.pageNumber,
      pageEnd: candidate.pageNumber,
      source: candidate.source,
    };
  });

  return normalizeSectionRanges(sections, pageCount);
}
