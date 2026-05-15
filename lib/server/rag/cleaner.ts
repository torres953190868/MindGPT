import type { ParsedPage } from "@/lib/server/rag/types";
import { normalizeWhitespace } from "./text";

function cleanLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function isBlank(line: string) {
  return line.trim().length === 0;
}

export function cleanPageText(rawText: string) {
  const normalized = normalizeWhitespace(rawText);
  const lines = normalized.split("\n");
  const cleanedLines: string[] = [];
  let lastWasBlank = false;

  for (const line of lines) {
    if (isBlank(line)) {
      if (!lastWasBlank && cleanedLines.length > 0) {
        cleanedLines.push("");
      }
      lastWasBlank = true;
      continue;
    }

    const cleaned = cleanLine(line);
    if (!cleaned) continue;

    const previous = cleanedLines.at(-1);
    if (previous && previous.endsWith("-") && /^[a-z]/.test(cleaned)) {
      cleanedLines[cleanedLines.length - 1] = `${previous.slice(0, -1)}${cleaned}`;
    } else {
      cleanedLines.push(cleaned);
    }
    lastWasBlank = false;
  }

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function edgeLine(text: string, edge: "first" | "last") {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return edge === "first" ? lines[0] : lines.at(-1);
}

function repeatedEdgeLines(pages: ParsedPage[], edge: "first" | "last") {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const line = edgeLine(page.cleanText, edge);
    if (!line || line.length > 90 || /^\d+$/.test(line)) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line),
  );
}

function removeEdgeLine(text: string, repeated: Set<string>, edge: "first" | "last") {
  if (repeated.size === 0) return text;

  const lines = text.split("\n");
  const index =
    edge === "first"
      ? lines.findIndex((line) => line.trim())
      : (() => {
          for (let i = lines.length - 1; i >= 0; i -= 1) {
            if (lines[i].trim()) return i;
          }
          return -1;
        })();

  if (index < 0 || !repeated.has(lines[index].trim())) return text;
  return lines
    .filter((_, lineIndex) => lineIndex !== index)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeRepeatedHeadersAndFooters(pages: ParsedPage[]) {
  const headers = repeatedEdgeLines(pages, "first");
  const footers = repeatedEdgeLines(pages, "last");

  return pages.map((page) => ({
    ...page,
    cleanText: removeEdgeLine(
      removeEdgeLine(page.cleanText, headers, "first"),
      footers,
      "last",
    ),
  }));
}
