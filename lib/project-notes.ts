import type { MindNode } from "@/lib/types";

export const PROJECT_NOTES_MAX_LENGTH = 60_000;

const NOTES_SEARCH_SNIPPET_CONTEXT_CHARS = 40;

// Titles from the project root down to the given node, used for the source
// line when appending the latest AI reply to the project notes.
export function getNodeTitlePath(
  nodes: Record<string, MindNode>,
  nodeId: string,
  untitledLabel: string,
): string[] {
  const titles: string[] = [];
  let current: MindNode | null = nodes[nodeId] ?? null;

  while (current) {
    titles.unshift(current.title.trim() || untitledLabel);
    current = current.parentId ? nodes[current.parentId] ?? null : null;
  }

  return titles;
}

export function formatLatestReplyNoteSection({
  content,
  sourceLabel,
  title,
}: {
  content: string;
  sourceLabel: string;
  title: string;
}) {
  return `## ${title}\n> ${sourceLabel}\n\n${content.trim()}`;
}

// Returns a short context window around the first query match inside the
// project notes, or null when the notes do not match. `normalizedQuery` must
// already be trimmed and lowercased, matching the sidebar node search.
export function getNotesSearchSnippet(
  notes: string,
  normalizedQuery: string,
): string | null {
  if (!normalizedQuery) return null;

  const matchIndex = notes.toLowerCase().indexOf(normalizedQuery);
  if (matchIndex === -1) return null;

  const start = Math.max(0, matchIndex - NOTES_SEARCH_SNIPPET_CONTEXT_CHARS);
  const end = Math.min(
    notes.length,
    matchIndex + normalizedQuery.length + NOTES_SEARCH_SNIPPET_CONTEXT_CHARS,
  );
  const snippet = notes.slice(start, end).replace(/\s+/g, " ").trim();

  return `${start > 0 ? "…" : ""}${snippet}${end < notes.length ? "…" : ""}`;
}
