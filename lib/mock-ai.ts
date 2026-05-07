import type { MockMode, MockReply } from "./types";

const focusByMode: Record<MockMode, string> = {
  root: "learning path",
  continue: "main thread",
  branch: "focused exploration",
};

function compact(input: string, max = 34) {
  const text = input.trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function generateMockReply(
  input: string,
  mode: MockMode,
  contextTitles: string[] = [],
  sourceText?: string,
): MockReply {
  const subject = compact(input || sourceText || "New question");
  const contextLine = contextTitles.length
    ? `Current path: ${contextTitles.join(" / ")}.`
    : "This is the starting point of the knowledge map.";
  const sourceLine = sourceText ? ` Focus text: "${compact(sourceText, 42)}".` : "";
  const titlePrefix = mode === "branch" ? "Explore" : mode === "continue" ? "Continue" : "Overview";
  const title = `${titlePrefix}: ${subject}`;

  const content = [
    `${contextLine}${sourceLine}`,
    `For "${subject}", start with 3 key points:`,
    "1. Clarify the core concept first so the details stay anchored.",
    "2. Use examples to connect abstract definitions to concrete scenarios.",
    "3. Break the next question into branches that can be explored further.",
    `Use this node as part of the ${focusByMode[mode]}: continue downward to keep the main line, or branch right when a term deserves separate investigation.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    title,
    summary: `Organizes the core concept, examples, and follow-up directions for "${subject}".`,
    content,
  };
}
