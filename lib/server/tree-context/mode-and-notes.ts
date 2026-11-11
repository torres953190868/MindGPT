import type { BranchType } from "@/lib/types";
import type { TreeContextModePolicy } from "@/lib/server/tree-context/types";

export const DEFAULT_PINNED_PROJECT_NOTES_MAX_CHARS = 1800;

export type ResolveTreeContextModePolicyOptions = {
  hasSourceText?: boolean;
};

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rarr: "→",
  larr: "←",
  harr: "↔",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  times: "×",
  divide: "÷",
  plusmn: "±",
  le: "≤",
  ge: "≥",
  ne: "≠",
  approx: "≈",
  infin: "∞",
  copy: "©",
  reg: "®",
  trade: "™",
};

const VALID_SINGLE_LETTER_HTML_TAGS = new Set(["a", "b", "i", "p", "q", "s", "u"]);

const BLOCK_OPEN_NEWLINE_TAGS = new Set([
  "p",
  "div",
  "pre",
  "tr",
  "ul",
  "ol",
  "li",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "aside",
  "main",
  "nav",
  "details",
  "summary",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
]);

const BLOCK_CLOSE_NEWLINE_TAGS = new Set([
  "p",
  "div",
  "pre",
  "tr",
  "ul",
  "ol",
  "section",
  "article",
  "header",
  "footer",
  "aside",
  "main",
  "nav",
  "details",
  "summary",
  "table",
  "figcaption",
  "dt",
  "dd",
]);

function isTagNameBoundary(ch: string | undefined): boolean {
  return (
    ch === undefined ||
    ch === ">" ||
    ch === "/" ||
    ch === " " ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\r" ||
    ch === "\f"
  );
}

/**
 * Strips `<script>...</script>` or `<style>...</style>` blocks in strict O(N) time
 * without regex backtracking.
 */
function stripRawTextElementBlocks(input: string, tagName: "script" | "style"): string {
  if (!input.includes("<")) return input;

  const lower = input.toLowerCase();
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}`;

  let openIdx = lower.indexOf(openToken);
  if (openIdx === -1) return input;

  let out = "";
  let cursor = 0;

  while (openIdx !== -1) {
    if (!isTagNameBoundary(lower[openIdx + openToken.length])) {
      openIdx = lower.indexOf(openToken, openIdx + openToken.length);
      continue;
    }

    const openGt = lower.indexOf(">", openIdx + openToken.length);
    if (openGt === -1) {
      break;
    }

    out += input.slice(cursor, openIdx);

    if (input[openGt - 1] === "/") {
      cursor = openGt + 1;
      openIdx = lower.indexOf(openToken, cursor);
      continue;
    }

    let searchCloseFrom = openGt + 1;
    let closeEnd = -1;
    let closeIdx = lower.indexOf(closeToken, searchCloseFrom);

    while (closeIdx !== -1) {
      let wsIdx = closeIdx + closeToken.length;
      while (wsIdx < lower.length && /\s/.test(lower[wsIdx])) {
        wsIdx++;
      }
      if (lower[wsIdx] === ">") {
        closeEnd = wsIdx;
        break;
      }
      searchCloseFrom = closeIdx + closeToken.length;
      closeIdx = lower.indexOf(closeToken, searchCloseFrom);
    }

    if (closeEnd === -1) {
      // No closing `</script>` or `</style>` exists anywhere in the remainder;
      // drop the opening tag and exit immediately to preserve O(N) time.
      cursor = openGt + 1;
      break;
    }

    cursor = closeEnd + 1;
    openIdx = lower.indexOf(openToken, cursor);
  }

  out += input.slice(cursor);
  return out;
}

/**
 * Strips `<!-- ... -->` HTML comments in strict O(N) time.
 */
function stripHtmlComments(input: string): string {
  let open = input.indexOf("<!--");
  if (open === -1) return input;

  let out = "";
  let cursor = 0;

  while (open !== -1) {
    const close = input.indexOf("-->", open + 4);
    if (close === -1) {
      break;
    }
    out += input.slice(cursor, open);
    cursor = close + 3;
    open = input.indexOf("<!--", cursor);
  }

  out += input.slice(cursor);
  return out;
}

function isValidCodePoint(codePoint: number): boolean {
  if (!Number.isSafeInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff) {
    return false;
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return false;
  }
  if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
    return false;
  }
  return true;
}

function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;

  return input.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (fullMatch, decDigits: string | undefined, hexDigits: string | undefined, named: string | undefined) => {
      if (decDigits !== undefined) {
        if (decDigits.length > 7) return fullMatch;
        const codePoint = Number.parseInt(decDigits, 10);
        return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : fullMatch;
      }

      if (hexDigits !== undefined) {
        if (hexDigits.length > 6) return fullMatch;
        const codePoint = Number.parseInt(hexDigits, 16);
        return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : fullMatch;
      }

      if (named !== undefined) {
        const replacement = NAMED_HTML_ENTITIES[named.toLowerCase()];
        return replacement !== undefined ? replacement : fullMatch;
      }

      return fullMatch;
    },
  );
}

type ParsedHtmlTag = {
  tagName: string;
  isClosing: boolean;
  tail: string;
};

function isValidHtmlTagTail(tail: string, isClosing: boolean): boolean {
  if (tail.length === 0) return true;
  if (isClosing) return /^\s*$/.test(tail);

  const first = tail[0];
  if (first !== "/" && !/\s/.test(first)) {
    return false;
  }

  let i = 0;
  const len = tail.length;

  while (i < len) {
    while (i < len && /\s/.test(tail[i])) i++;
    if (i >= len) return true;

    if (tail[i] === "/") {
      i++;
      while (i < len && /\s/.test(tail[i])) i++;
      return i === len;
    }

    if (!/[a-zA-Z_:@]/.test(tail[i])) {
      return false;
    }
    i++;
    while (i < len && /[a-zA-Z0-9_.:-]/.test(tail[i])) {
      i++;
    }

    while (i < len && /\s/.test(tail[i])) i++;
    if (i < len && tail[i] === "=") {
      i++;
      while (i < len && /\s/.test(tail[i])) i++;
      if (i >= len) return false;

      const quote = tail[i];
      if (quote === '"' || quote === "'") {
        i++;
        while (i < len && tail[i] !== quote) i++;
        if (i >= len) return false;
        i++;
      } else {
        const valueStart = i;
        while (i < len && !/[\s"'=<>`/$]/.test(tail[i])) i++;
        if (i === valueStart) return false;
      }
    }
  }

  return true;
}

/**
 * Parses a `<...>` slice (guaranteed to contain no inner `<` or `>`) if and only if
 * it is a genuine HTML tag, avoiding false positives on math expressions like
 * `$a < b$`, `$x<y$`, or `$x<y + z>0$`.
 */
function parseHtmlTag(rawTag: string): ParsedHtmlTag | null {
  if (rawTag.length < 3 || rawTag[0] !== "<" || rawTag[rawTag.length - 1] !== ">") {
    return null;
  }

  const isClosing = rawTag[1] === "/";
  const nameStart = isClosing ? 2 : 1;
  if (nameStart >= rawTag.length - 1) {
    return null;
  }

  const firstChar = rawTag[nameStart];
  if (!/[a-zA-Z]/.test(firstChar)) {
    return null;
  }

  let nameEnd = nameStart + 1;
  while (nameEnd < rawTag.length - 1 && /[a-zA-Z0-9-]/.test(rawTag[nameEnd])) {
    nameEnd++;
  }

  const tagName = rawTag.slice(nameStart, nameEnd).toLowerCase();
  if (tagName.length === 1 && !VALID_SINGLE_LETTER_HTML_TAGS.has(tagName)) {
    return null;
  }

  const tail = rawTag.slice(nameEnd, rawTag.length - 1);
  if (!isValidHtmlTagTail(tail, isClosing)) {
    return null;
  }

  return { tagName, isClosing, tail };
}

function extractBlockMathLatex(tail: string): string | null {
  if (!/data-type\s*=\s*["']block-math["']/i.test(tail)) {
    return null;
  }
  const match = tail.match(/data-latex\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!match) return null;
  const rawLatex = match[1] ?? match[2] ?? "";
  const decoded = decodeHtmlEntities(rawLatex).trim();
  return decoded ? `$$${decoded}$$` : null;
}

function convertHtmlAndEntitiesToPlainText(input: string): string {
  let out = "";
  let lineHasContent = false;
  let headingPrefix = "";
  let listItemNeedsBullet = false;
  let blockquoteDepth = 0;
  let lastTokenWasBlockTag = false;

  const pushNewline = () => {
    out += "\n";
    lineHasContent = false;
  };

  const ensureNewline = () => {
    if (lineHasContent) {
      pushNewline();
    }
  };

  const appendTextSegment = (rawSegment: string) => {
    if (!rawSegment) return;
    const decoded = decodeHtmlEntities(rawSegment);
    const parts = decoded.split("\n");

    for (let idx = 0; idx < parts.length; idx++) {
      if (idx > 0) {
        // Skip leading indentation newlines before the first token of a heading or list item.
        if (!((headingPrefix || listItemNeedsBullet) && !lineHasContent)) {
          pushNewline();
        }
      }

      let part = parts[idx];
      if (!lineHasContent) {
        const hasStructuralPrefix =
          headingPrefix !== "" || listItemNeedsBullet || blockquoteDepth > 0;

        if (hasStructuralPrefix && part.trim() === "") {
          continue;
        }

        if (part.trim() !== "") {
          let prefix = "";
          if (blockquoteDepth > 0) {
            prefix += "> ";
          }
          if (headingPrefix) {
            prefix += headingPrefix;
            headingPrefix = "";
          }
          if (listItemNeedsBullet) {
            prefix += "- ";
            listItemNeedsBullet = false;
          }
          if (prefix) {
            part = part.replace(/^[^\S\n]+/, "");
            out += prefix;
          }
          out += part;
          lineHasContent = true;
        }
      } else {
        out += part;
      }
    }
    lastTokenWasBlockTag = false;
  };

  let cursor = 0;
  const len = input.length;

  while (cursor < len) {
    const ltIdx = input.indexOf("<", cursor);
    if (ltIdx === -1) {
      appendTextSegment(input.slice(cursor));
      break;
    }

    if (ltIdx > cursor) {
      const between = input.slice(cursor, ltIdx);
      // Ignore pure indentation whitespace between consecutive block HTML tags.
      if (!(lastTokenWasBlockTag && between.trim() === "")) {
        appendTextSegment(between);
      }
    }

    // Find the next `<` or `>` after `ltIdx` so candidate tags never span nested `<`.
    let scan = ltIdx + 1;
    while (scan < len && input[scan] !== "<" && input[scan] !== ">") {
      scan++;
    }

    if (scan >= len) {
      appendTextSegment(input.slice(ltIdx));
      break;
    }

    if (input[scan] === "<") {
      appendTextSegment(input.slice(ltIdx, scan));
      cursor = scan;
      continue;
    }

    const rawTag = input.slice(ltIdx, scan + 1);
    const parsed = parseHtmlTag(rawTag);

    if (!parsed) {
      appendTextSegment(rawTag);
      cursor = scan + 1;
      continue;
    }

    const { tagName, isClosing, tail } = parsed;
    let handledAsBlockTag = false;

    if (tagName === "br" || tagName === "hr") {
      pushNewline();
      handledAsBlockTag = true;
    } else if (/^h[1-6]$/.test(tagName)) {
      if (isClosing) {
        headingPrefix = "";
        pushNewline();
      } else {
        ensureNewline();
        const level = Number(tagName[1]);
        headingPrefix = `${"#".repeat(level)} `;
      }
      handledAsBlockTag = true;
    } else if (tagName === "blockquote") {
      if (isClosing) {
        blockquoteDepth = Math.max(0, blockquoteDepth - 1);
        pushNewline();
      } else {
        ensureNewline();
        blockquoteDepth += 1;
      }
      handledAsBlockTag = true;
    } else if (tagName === "li") {
      if (isClosing) {
        listItemNeedsBullet = false;
        ensureNewline();
      } else {
        ensureNewline();
        listItemNeedsBullet = true;
      }
      handledAsBlockTag = true;
    } else if (tagName === "td" || tagName === "th") {
      if (isClosing && lineHasContent && !out.endsWith(" ") && !out.endsWith("\n")) {
        out += " ";
      }
    } else if (!isClosing && tagName === "div") {
      ensureNewline();
      const blockLatex = extractBlockMathLatex(tail);
      // Emit Tiptap block-math `data-latex` when the div itself is empty (`<div ...></div>` or self-closing).
      if (blockLatex) {
        const selfClosing = tail.trimEnd().endsWith("/");
        const immediatelyClosed = /^<\/div\s*>/i.test(input.slice(scan + 1, scan + 16));
        if (selfClosing || immediatelyClosed) {
          appendTextSegment(blockLatex);
          pushNewline();
        }
      }
      handledAsBlockTag = true;
    } else if (!isClosing && BLOCK_OPEN_NEWLINE_TAGS.has(tagName)) {
      ensureNewline();
      handledAsBlockTag = true;
    } else if (isClosing && BLOCK_CLOSE_NEWLINE_TAGS.has(tagName)) {
      pushNewline();
      handledAsBlockTag = true;
    }

    lastTokenWasBlockTag = handledAsBlockTag;
    cursor = scan + 1;
  }

  return out;
}

function truncateToCharBudget(text: string, maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (budget <= 0) return "";
  if (text.length <= budget) return text;

  if (budget <= 3) {
    return ".".repeat(budget);
  }
  if (budget === 4) {
    return `${text[0]}...`;
  }

  const sliceLimit = budget - 4;
  const minBoundary = Math.min(Math.floor(budget * 0.5), Math.floor(sliceLimit * 0.5));
  const candidate = text.slice(0, sliceLimit);

  // If the character right at sliceLimit is already a line break or whitespace, keep the full slice.
  const nextChar = text[sliceLimit];
  if (nextChar === "\n") {
    const clean = candidate.trimEnd();
    return clean ? `${clean}\n...` : "...";
  }

  const lastNewline = candidate.lastIndexOf("\n");
  if (lastNewline >= minBoundary) {
    const clean = candidate.slice(0, lastNewline).trimEnd();
    if (clean) {
      return `${clean}\n...`;
    }
  }

  if (nextChar !== undefined && /\s/.test(nextChar)) {
    const clean = candidate.trimEnd();
    if (clean) {
      return `${clean}...`;
    }
  }

  let lastWhitespace = -1;
  for (let i = candidate.length - 1; i >= minBoundary; i--) {
    if (/\s/.test(candidate[i])) {
      lastWhitespace = i;
      break;
    }
  }

  if (lastWhitespace >= minBoundary) {
    const clean = candidate.slice(0, lastWhitespace).trimEnd();
    if (clean) {
      return `${clean}...`;
    }
  }

  // Fallback for unbroken long tokens: avoid splitting a UTF-16 surrogate pair.
  let hardCut = candidate;
  const lastCodeUnit = hardCut.charCodeAt(hardCut.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff && hardCut.length > 1) {
    hardCut = hardCut.slice(0, -1);
  }

  return `${hardCut}...`;
}

/**
 * Extracts clean, readable plain text from BranchMind `project.notes` (supporting both
 * Tiptap HTML and Markdown with LaTeX math) within a strict character budget.
 */
export function extractPinnedProjectNotes(
  rawNotes: string | undefined | null,
  maxChars: number = DEFAULT_PINNED_PROJECT_NOTES_MAX_CHARS,
): string {
  if (!rawNotes || !(maxChars > 0)) {
    return "";
  }

  let working = rawNotes.replace(/\r\n?/g, "\n");
  working = stripRawTextElementBlocks(working, "script");
  working = stripRawTextElementBlocks(working, "style");
  working = stripHtmlComments(working);

  const plainText = convertHtmlAndEntitiesToPlainText(working);

  const normalized = plainText
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return "";
  }

  return truncateToCharBudget(normalized, maxChars);
}

/**
 * Resolves mode-specific context budgets, ancestor/side-branch lookbacks, and
 * prompt framing for `root`, `continue`, and `branch` nodes.
 */
export function resolveTreeContextModePolicy(
  mode: BranchType,
  options: ResolveTreeContextModePolicyOptions = {},
): TreeContextModePolicy {
  const hasSourceText = Boolean(options.hasSourceText);

  if (mode === "continue") {
    return {
      mode: "continue",
      hasSourceText,
      maxRecentFullNodes: 3,
      sideBranchLookbackDepth: 3,
      maxSideBranches: 5,
      includeProjectNotes: true,
      budgets: {
        recentTurnsChars: 6000,
        foldedAncestorsChars: 2200,
        sideBranchesChars: 1400,
        projectNotesChars: 1800,
        userMemoryChars: 1000,
      },
      modeGuidance:
        "Mode: Continue Down (mainline progression). Advance the main thread vertically from the parent node while maintaining continuity with the root goal and ancestor trajectory. Leverage clarified side-branch takeaways and pinned project notes without re-explaining them from scratch, and carry the reasoning forward.",
    };
  }

  if (mode === "branch") {
    if (hasSourceText) {
      return {
        mode: "branch",
        hasSourceText: true,
        maxRecentFullNodes: 1,
        sideBranchLookbackDepth: 1,
        maxSideBranches: 2,
        includeProjectNotes: false,
        budgets: {
          recentTurnsChars: 2800,
          foldedAncestorsChars: 900,
          sideBranchesChars: 700,
          projectNotesChars: 0,
          userMemoryChars: 800,
        },
        modeGuidance:
          "Mode: Branch Right on selected source text (inline deep dive). Focus sharply on explaining and analyzing the selected source text in the immediate context of its parent node without re-summarizing the entire main thread.",
      };
    }

    return {
      mode: "branch",
      hasSourceText: false,
      maxRecentFullNodes: 2,
      sideBranchLookbackDepth: 2,
      maxSideBranches: 3,
      includeProjectNotes: true,
      budgets: {
        recentTurnsChars: 4200,
        foldedAncestorsChars: 1400,
        sideBranchesChars: 900,
        projectNotesChars: 900,
        userMemoryChars: 800,
      },
      modeGuidance:
        "Mode: Branch Right (sub-topic deep dive). Explore this sub-topic thoroughly in an isolated side branch anchored to its parent context, without derailing the main thread or repeating the full mainline overview.",
    };
  }

  return {
    mode: "root",
    hasSourceText,
    maxRecentFullNodes: 1,
    sideBranchLookbackDepth: 0,
    maxSideBranches: 0,
    includeProjectNotes: true,
    budgets: {
      recentTurnsChars: 3000,
      foldedAncestorsChars: 0,
      sideBranchesChars: 0,
      projectNotesChars: 1500,
      userMemoryChars: 1000,
    },
    modeGuidance:
      "Mode: Root node (canvas entry). Establish a clear, well-structured foundation for the topic that frames core concepts and sets up clean directions for subsequent exploration.",
  };
}
