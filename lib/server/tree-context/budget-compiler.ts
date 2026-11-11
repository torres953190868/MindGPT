import {
  extractAncestorHistory,
  formatAssistantTurnJson,
} from "@/lib/server/tree-context/ancestor-history";
import {
  extractPinnedProjectNotes,
  resolveTreeContextModePolicy,
} from "@/lib/server/tree-context/mode-and-notes";
import { extractSideBranchRollup } from "@/lib/server/tree-context/side-branch-rollup";
import type {
  BuildTreePromptContextInput,
  FoldedAncestorNode,
  NodeConversationTurn,
  RootContextAnchor,
  TreePromptContext,
  UserMemoryContextSlot,
} from "@/lib/server/tree-context/types";

export const DEFAULT_USER_MEMORY_MAX_CHARS = 1000;

export type AllocateRecentTurnsWithDowngradeInput = {
  recentTurns: NodeConversationTurn[];
  foldedAncestors: FoldedAncestorNode[];
  recentTurnsBudgetChars: number;
};

export type AllocateRecentTurnsWithDowngradeResult = {
  recentTurns: NodeConversationTurn[];
  foldedAncestors: FoldedAncestorNode[];
};

export type FormatFoldedAncestorsSlotInput = {
  rootAnchor: RootContextAnchor | null;
  foldedAncestors: FoldedAncestorNode[];
  keptRecentTurns: NodeConversationTurn[];
  maxChars: number;
};

function safeSliceUtf16(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = Math.max(0, Math.floor(maxLength));
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  return text.slice(0, end);
}

function cleanSingleLine(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function compactSingleLine(input: string, maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (budget <= 0) return "";
  const normalized = cleanSingleLine(input);
  if (normalized.length <= budget) {
    return normalized;
  }
  if (budget <= 3) {
    return ".".repeat(budget);
  }
  const sliced = safeSliceUtf16(normalized, budget - 3).trimEnd();
  return sliced ? `${sliced}...` : ".".repeat(3);
}

function compactTextPreservingNewlines(input: string, maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (budget <= 0) return "";
  const trimmed = input.trim();
  if (trimmed.length <= budget) {
    return trimmed;
  }
  if (budget <= 3) {
    return ".".repeat(budget);
  }
  const sliced = safeSliceUtf16(trimmed, budget - 3).trimEnd();
  return sliced ? `${sliced}...` : ".".repeat(3);
}

function measureTurnChars(turn: NodeConversationTurn): number {
  return turn.userContent.length + turn.assistantJsonContent.length;
}

function parseAssistantJsonFields(turn: NodeConversationTurn): {
  title: string;
  summary: string;
  content: string;
} {
  try {
    const parsed = JSON.parse(turn.assistantJsonContent) as {
      title?: unknown;
      summary?: unknown;
      content?: unknown;
    };
    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? cleanSingleLine(parsed.title)
        : cleanSingleLine(turn.nodeTitle) || "Assistant response";
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? cleanSingleLine(parsed.summary)
        : compactSingleLine(turn.assistantRawContent || title, 200);
    const content =
      typeof parsed.content === "string" && parsed.content.trim().length > 0
        ? parsed.content
        : turn.assistantRawContent || summary;
    return { title, summary, content };
  } catch {
    const fallbackTitle = cleanSingleLine(turn.nodeTitle) || "Assistant response";
    const fallbackSummary =
      compactSingleLine(turn.assistantRawContent || fallbackTitle, 200) ||
      fallbackTitle;
    return {
      title: fallbackTitle,
      summary: fallbackSummary,
      content: turn.assistantRawContent || fallbackSummary,
    };
  }
}

/**
 * Compacts the single most recent turn so that immediate parent context is preserved
 * instead of completely dropped when a single exchange exceeds `recentTurnsBudgetChars`.
 */
function compactSingleRecentTurnToBudget(
  turn: NodeConversationTurn,
  budgetChars: number,
): NodeConversationTurn {
  const budget = Math.max(1, Math.floor(budgetChars));
  if (measureTurnChars(turn) <= budget) {
    return turn;
  }

  const parsed = parseAssistantJsonFields(turn);
  let titleLimit = Math.max(1, Math.min(80, Math.floor(budget * 0.14)));
  let summaryLimit = Math.max(1, Math.min(180, Math.floor(budget * 0.24)));
  let userLimit = Math.min(
    turn.userContent.length,
    Math.max(1, Math.floor(budget * 0.35)),
  );

  let compactedUser = compactTextPreservingNewlines(turn.userContent, userLimit) ||
    safeSliceUtf16(turn.userContent, 1) ||
    ".";

  let title = compactSingleLine(parsed.title, titleLimit) || "R";
  let summary = compactSingleLine(parsed.summary, summaryLimit) || title;

  const minimalShell = formatAssistantTurnJson({
    title,
    summary,
    content: "x",
  });
  let contentLimit = Math.max(
    1,
    budget - compactedUser.length - (minimalShell.length - 1),
  );
  let compactedRaw =
    compactTextPreservingNewlines(
      turn.assistantRawContent || parsed.content,
      contentLimit,
    ) ||
    safeSliceUtf16(turn.assistantRawContent || parsed.content || summary, 1) ||
    ".";

  let assistantJsonContent = formatAssistantTurnJson({
    title,
    summary,
    content: compactedRaw,
  });

  // Step down limits if JSON string escaping pushed total length slightly over budget.
  for (
    let step = 0;
    step < 8 && compactedUser.length + assistantJsonContent.length > budget;
    step += 1
  ) {
    const overflow = compactedUser.length + assistantJsonContent.length - budget;
    if (contentLimit > 1) {
      contentLimit = Math.max(1, contentLimit - Math.max(overflow, 8));
      compactedRaw =
        compactTextPreservingNewlines(
          turn.assistantRawContent || parsed.content,
          contentLimit,
        ) || ".";
    } else if (summaryLimit > 1) {
      summaryLimit = Math.max(1, Math.floor(summaryLimit * 0.5));
      summary = compactSingleLine(parsed.summary, summaryLimit) || "S";
    } else if (titleLimit > 1) {
      titleLimit = Math.max(1, Math.floor(titleLimit * 0.5));
      title = compactSingleLine(parsed.title, titleLimit) || "T";
    } else if (userLimit > 1) {
      userLimit = Math.max(1, userLimit - Math.max(overflow, 4));
      compactedUser =
        compactTextPreservingNewlines(turn.userContent, userLimit) || ".";
    } else {
      break;
    }

    assistantJsonContent = formatAssistantTurnJson({
      title,
      summary,
      content: compactedRaw,
    });
  }

  return {
    ...turn,
    userContent: compactedUser,
    assistantJsonContent,
    assistantRawContent: compactedRaw,
  };
}

/**
 * Replaces hard `slice(-8)` truncation with smooth budget-aware degradation:
 * - Walks `recentTurns` from newest backward to oldest.
 * - Keeps full `(user, assistant)` pairs while cumulative chars <= `recentTurnsBudgetChars`
 *   (compacting the single most recent turn if it alone exceeds a positive budget).
 * - Downgrades any older turns that do not fit into `foldedAncestors`, deduplicated by
 *   `nodeId` and sorted ascending by `depth`, never leaving orphaned `user` messages.
 */
export function allocateRecentTurnsWithDowngrade(
  input: AllocateRecentTurnsWithDowngradeInput,
): AllocateRecentTurnsWithDowngradeResult {
  const budget = Math.floor(input.recentTurnsBudgetChars);
  const keptReversed: NodeConversationTurn[] = [];
  const downgradedByNodeId = new Map<string, FoldedAncestorNode>();

  let usedChars = 0;
  let stopExpanding = !(budget > 0);

  for (let index = input.recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = input.recentTurns[index];
    const turnCost = measureTurnChars(turn);

    if (!stopExpanding) {
      if (usedChars + turnCost <= budget) {
        keptReversed.push(turn);
        usedChars += turnCost;
        continue;
      }

      if (keptReversed.length === 0 && budget > 0) {
        const compactedTurn = compactSingleRecentTurnToBudget(turn, budget);
        keptReversed.push(compactedTurn);
        usedChars += measureTurnChars(compactedTurn);
        stopExpanding = true;
        continue;
      }

      stopExpanding = true;
    }

    // Smoothly downgrade older overflow turns into foldedAncestors.
    // Because we walk newest-to-oldest, the first downgraded turn seen for a `nodeId`
    // carries that node's latest completed summary (which is the canonical node summary
    // whenever all turns of that node are downgraded).
    if (!downgradedByNodeId.has(turn.nodeId)) {
      const parsed = parseAssistantJsonFields(turn);
      downgradedByNodeId.set(turn.nodeId, {
        nodeId: turn.nodeId,
        title: cleanSingleLine(turn.nodeTitle) || parsed.title,
        summary: parsed.summary,
        branchType: turn.branchType,
        depth: turn.depth,
      });
    }
  }

  const mergedByNodeId = new Map<string, FoldedAncestorNode>();
  for (const existing of input.foldedAncestors) {
    if (!mergedByNodeId.has(existing.nodeId)) {
      mergedByNodeId.set(existing.nodeId, existing);
    }
  }
  for (const [nodeId, downgraded] of downgradedByNodeId) {
    if (!mergedByNodeId.has(nodeId)) {
      mergedByNodeId.set(nodeId, downgraded);
    }
  }

  const foldedAncestors = [...mergedByNodeId.values()].sort(
    (left, right) => left.depth - right.depth,
  );

  return {
    recentTurns: keptReversed.reverse(),
    foldedAncestors,
  };
}

function formatFoldedAncestorBullet(node: FoldedAncestorNode): string {
  const title = cleanSingleLine(node.title) || "Node";
  const summary = cleanSingleLine(node.summary);
  return summary
    ? `- [depth ${node.depth} | ${node.branchType}] ${title}: ${summary}`
    : `- [depth ${node.depth} | ${node.branchType}] ${title}`;
}

/**
 * Formats the Root Context Anchor and folded distant ancestors within `maxChars`.
 * Ensures deep trees (> 4 hops) always retain the root goal while keeping the
 * folded ancestors closest to `keptRecentTurns` when space is tight.
 */
export function formatFoldedAncestorsSlot(
  input: FormatFoldedAncestorsSlotInput,
): string {
  const budget = Math.floor(input.maxChars);
  if (!(budget > 0)) {
    return "";
  }
  if (!input.rootAnchor && input.foldedAncestors.length === 0) {
    return "";
  }

  const rootExpandedInRecent = input.rootAnchor
    ? input.keptRecentTurns.some(
        (turn) => turn.nodeId === input.rootAnchor!.nodeId,
      )
    : false;

  let anchorLine = "";
  if (input.rootAnchor && !rootExpandedInRecent) {
    const rootTitle = cleanSingleLine(input.rootAnchor.title) || "Root";
    const initialQuestion = compactSingleLine(
      input.rootAnchor.initialQuestion,
      240,
    );
    const summary = compactSingleLine(input.rootAnchor.summary, 200);
    anchorLine = `Canvas root goal (${rootTitle}): ${initialQuestion} -> ${summary}`;
  }

  const dedupedFolded = new Map<string, FoldedAncestorNode>();
  for (const ancestor of input.foldedAncestors) {
    if (anchorLine && input.rootAnchor && ancestor.nodeId === input.rootAnchor.nodeId) {
      continue;
    }
    if (!dedupedFolded.has(ancestor.nodeId)) {
      dedupedFolded.set(ancestor.nodeId, ancestor);
    }
  }

  const sortedRemaining = [...dedupedFolded.values()].sort(
    (left, right) => left.depth - right.depth,
  );
  const bulletLines = sortedRemaining.map(formatFoldedAncestorBullet);

  if (!anchorLine && bulletLines.length === 0) {
    return "";
  }

  if (anchorLine && anchorLine.length >= budget) {
    return compactSingleLine(anchorLine, budget);
  }

  if (bulletLines.length === 0) {
    return anchorLine;
  }

  const fullCandidate = anchorLine
    ? `${anchorLine}\n${bulletLines.join("\n")}`
    : bulletLines.join("\n");
  if (fullCandidate.length <= budget) {
    return fullCandidate;
  }

  // Drop older middle entries first, keeping `anchorLine` + `...` + folded ancestors closest to `keptRecentTurns`.
  const keptClosestReversed: string[] = [];
  for (let index = bulletLines.length - 1; index >= 0; index -= 1) {
    const nextChronological = [
      bulletLines[index],
      ...[...keptClosestReversed].reverse(),
    ];
    const candidateParts = [
      ...(anchorLine ? [anchorLine] : []),
      "...",
      ...nextChronological,
    ];
    if (candidateParts.join("\n").length <= budget) {
      keptClosestReversed.push(bulletLines[index]);
    } else {
      break;
    }
  }

  if (keptClosestReversed.length > 0) {
    return [
      ...(anchorLine ? [anchorLine] : []),
      "...",
      ...[...keptClosestReversed].reverse(),
    ].join("\n");
  }

  const closestBullet = bulletLines[bulletLines.length - 1];
  if (anchorLine) {
    const remainingAfterMarker = budget - anchorLine.length - 5; // `\n...\n`
    if (remainingAfterMarker >= 16) {
      return `${anchorLine}\n...\n${compactSingleLine(closestBullet, remainingAfterMarker)}`;
    }
    if (anchorLine.length + 4 <= budget) {
      return `${anchorLine}\n...`;
    }
    return anchorLine;
  }

  return compactSingleLine(closestBullet, budget);
}

function truncateMultilineSlot(lines: string[], maxChars: number): string {
  const budget = Math.floor(maxChars);
  if (lines.length === 0 || !(budget > 0)) {
    return "";
  }

  const joined = lines.join("\n");
  if (joined.length <= budget) {
    return joined;
  }

  if (budget <= 3) {
    return ".".repeat(budget);
  }

  let output = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const candidate = output ? `${output}\n${line}` : line;
    const isLast = index === lines.length - 1;
    const limit = isLast ? budget : budget - 4;

    if (candidate.length > limit) {
      if (output) {
        return `${output}\n...`;
      }
      return compactSingleLine(line, budget);
    }

    output = candidate;
  }

  return output;
}

/**
 * Formats the reserved cross-canvas / project User Memory slot within `maxChars`.
 */
export function formatUserMemorySlot(
  userMemory: UserMemoryContextSlot | undefined,
  maxChars: number = DEFAULT_USER_MEMORY_MAX_CHARS,
): string {
  const budget = Math.floor(maxChars);
  if (!userMemory || !(budget > 0)) {
    return "";
  }

  const profileSummary = userMemory.profileSummary
    ? cleanSingleLine(userMemory.profileSummary)
    : "";
  const preferredStyle = userMemory.preferredStyle
    ? cleanSingleLine(userMemory.preferredStyle)
    : "";
  const conceptLines = (userMemory.concepts ?? [])
    .filter((item) => item.concept && item.concept.trim().length > 0)
    .map((item) => {
      const concept = cleanSingleLine(item.concept);
      const note = item.note ? cleanSingleLine(item.note) : "";
      return `- [${item.status}] ${concept}${note ? `: ${note}` : ""}`;
    });

  if (!profileSummary && !preferredStyle && conceptLines.length === 0) {
    return "";
  }

  const lines: string[] = [];
  if (profileSummary) {
    lines.push(`Profile: ${profileSummary}`);
  }
  if (preferredStyle) {
    lines.push(`Preferred style: ${preferredStyle}`);
  }
  if (conceptLines.length > 0) {
    lines.push("Concepts:", ...conceptLines);
  }

  return truncateMultilineSlot(lines, budget);
}

/**
 * Orchestrates end-to-end tree prompt context assembly:
 * 1. Resolves mode policy & slot budgets (`root` | `continue` | `branch` +/- `sourceText`).
 * 2. Extracts root anchor, folded ancestors, and recent multi-turn exchanges.
 * 3. Smoothly downgrades overflow recent turns into `foldedAncestors` under budget.
 * 4. Rolls up completed side-branch insights.
 * 5. Extracts clean plain-text `project.notes` when enabled by mode policy.
 */
export function buildTreePromptContext(
  input: BuildTreePromptContextInput,
): TreePromptContext {
  const hasSourceText = Boolean(input.hasSourceText);
  const policy = resolveTreeContextModePolicy(input.mode, { hasSourceText });

  const extracted = extractAncestorHistory({
    project: input.project,
    ancestorNodeId: input.ancestorNodeId,
    maxRecentFullNodes: policy.maxRecentFullNodes,
    currentNodePrefixMessages: input.currentNodePrefixMessages,
    currentNode: input.currentNode,
  });

  const allocated = allocateRecentTurnsWithDowngrade({
    recentTurns: extracted.recentTurns,
    foldedAncestors: extracted.foldedAncestors,
    recentTurnsBudgetChars: policy.budgets.recentTurnsChars,
  });

  const sideBranches =
    policy.budgets.sideBranchesChars > 0 &&
    policy.maxSideBranches > 0 &&
    policy.sideBranchLookbackDepth > 0
      ? extractSideBranchRollup({
          project: input.project,
          ancestorNodeId: input.ancestorNodeId,
          excludeNodeId: input.excludeNodeId,
          lookbackDepth: policy.sideBranchLookbackDepth,
          maxBranches: policy.maxSideBranches,
        })
      : [];

  const pinnedProjectNotes =
    policy.includeProjectNotes && policy.budgets.projectNotesChars > 0
      ? extractPinnedProjectNotes(
          input.project.notes,
          policy.budgets.projectNotesChars,
        )
      : "";

  return {
    mode: policy.mode,
    hasSourceText,
    contextTitles: extracted.contextTitles,
    contextSummaries: extracted.contextSummaries,
    rootAnchor: extracted.rootAnchor,
    foldedAncestors: allocated.foldedAncestors,
    recentTurns: allocated.recentTurns,
    sideBranches,
    pinnedProjectNotes,
    ...(input.userMemory ? { userMemory: input.userMemory } : {}),
    policy,
  };
}

/**
 * Compiles slow-changing workspace background context (Root Anchor + Folded Ancestors,
 * Pinned Project Notes, and User Memory) into a single block appended after the static
 * system prompt prefix, preserving offset-0 KV cache prefix stability.
 */
export function formatTreeSystemBackgroundBlock(
  treeContext: TreePromptContext | undefined,
  fallbackUserMemory?: UserMemoryContextSlot,
): string {
  const sections: string[] = [];

  if (treeContext) {
    const foldedBlock = formatFoldedAncestorsSlot({
      rootAnchor: treeContext.rootAnchor,
      foldedAncestors: treeContext.foldedAncestors,
      keptRecentTurns: treeContext.recentTurns,
      maxChars: treeContext.policy.budgets.foldedAncestorsChars,
    });
    if (foldedBlock) {
      sections.push(`Ancestor trajectory:\n${foldedBlock}`);
    }

    if (
      treeContext.policy.includeProjectNotes &&
      treeContext.policy.budgets.projectNotesChars > 0
    ) {
      const notes = treeContext.pinnedProjectNotes.trim();
      if (notes) {
        const cappedNotes =
          notes.length <= treeContext.policy.budgets.projectNotesChars
            ? notes
            : compactTextPreservingNewlines(
                notes,
                treeContext.policy.budgets.projectNotesChars,
              );
        if (cappedNotes) {
          sections.push(`Pinned project notes:\n${cappedNotes}`);
        }
      }
    }
  }

  const effectiveUserMemory = treeContext?.userMemory ?? fallbackUserMemory;
  const userMemoryBudget = treeContext
    ? treeContext.policy.budgets.userMemoryChars
    : DEFAULT_USER_MEMORY_MAX_CHARS;
  const memoryBlock = formatUserMemorySlot(effectiveUserMemory, userMemoryBudget);
  if (memoryBlock) {
    sections.push(`User learning memory:\n${memoryBlock}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return `Workspace context:\n${sections.join("\n\n")}`;
}
