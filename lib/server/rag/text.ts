const TOKEN_PATTERN = /[\p{Script=Han}]|[A-Za-z0-9]+|[^\s]/gu;

export function estimateTokenCount(text: string) {
  const matches = text.match(TOKEN_PATTERN);
  return matches?.length ?? 0;
}

export function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function compactText(text: string, maxLength = 240) {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function getKeywordTerms(text: string) {
  return Array.from(
    new Set(
      (text.match(TOKEN_PATTERN) ?? [])
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 1 || /[\p{Script=Han}]/u.test(token)),
    ),
  );
}
