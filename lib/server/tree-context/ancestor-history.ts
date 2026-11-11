import { getNodePath } from "@/lib/graph";
import {
  PENDING_ROOT_SUMMARY,
  PENDING_ROOT_TITLE,
} from "@/lib/server/project-model";
import type {
  ExtractedAncestorHistory,
  FoldedAncestorNode,
  NodeConversationTurn,
  RootContextAnchor,
} from "@/lib/server/tree-context/types";
import type { ChatMessage, MindNode, Project } from "@/lib/types";

const MAX_REPLY_TITLE_CHARS = 120;
const MAX_REPLY_SUMMARY_CHARS = 280;
const MAX_REPLY_CONTENT_CHARS = 8_000;
const FALLBACK_TITLE_CHARS = 80;
const FALLBACK_SUMMARY_CHARS = 200;

export type FormatAssistantTurnJsonInput = {
  title: string;
  summary: string;
  content: string;
};

export type ExtractAncestorHistoryInput = {
  project: Project;
  ancestorNodeId: string | null;
  maxRecentFullNodes: number;
  currentNodePrefixMessages?: ChatMessage[];
  currentNode?: Pick<MindNode, "id" | "title" | "summary" | "branchType">;
};

type CompletedMessagePair = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

function safeSliceUtf16(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = Math.max(0, maxLength);
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  return text.slice(0, end);
}

function compactSingleLine(input: string, maxChars: number): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return safeSliceUtf16(normalized, maxChars);
  }
  return `${safeSliceUtf16(normalized, maxChars - 3).trimEnd()}...`;
}

function stripLeadingMarkdownBlockPrefix(line: string): string {
  return line
    .trim()
    .replace(/^(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)+/, "")
    .trim();
}

function extractLeadingMarkdownHeading(content: string): string | null {
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const match = /^#{1,6}\s+(.+)$/.exec(trimmed);
    return match ? match[1].trim() : null;
  }
  return null;
}

function deriveTitleFromContent(content: string): string {
  for (const rawLine of content.split(/\r?\n/)) {
    const cleaned = stripLeadingMarkdownBlockPrefix(rawLine);
    if (cleaned.length > 0) {
      return compactSingleLine(cleaned, FALLBACK_TITLE_CHARS);
    }
  }
  const fallback = compactSingleLine(content, FALLBACK_TITLE_CHARS);
  return fallback || "Assistant response";
}

function deriveSummaryFromContent(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map(stripLeadingMarkdownBlockPrefix)
    .filter((line) => line.length > 0);
  const joined = lines.join(" ");
  const compacted = compactSingleLine(joined || content, FALLBACK_SUMMARY_CHARS);
  return compacted || "Assistant response";
}

function derivePairFallbackTitle(userText: string, assistantContent: string): string {
  const heading = extractLeadingMarkdownHeading(assistantContent);
  if (heading) {
    return compactSingleLine(heading, FALLBACK_TITLE_CHARS);
  }
  const fromUser = compactSingleLine(userText, FALLBACK_TITLE_CHARS);
  if (fromUser) {
    return fromUser;
  }
  return deriveTitleFromContent(assistantContent);
}

function derivePairFallbackSummary(userText: string, assistantContent: string): string {
  const fromAssistant = deriveSummaryFromContent(assistantContent);
  if (fromAssistant && fromAssistant !== "Assistant response") {
    return fromAssistant;
  }
  const fromUser = compactSingleLine(userText, FALLBACK_SUMMARY_CHARS);
  return fromUser || fromAssistant;
}

function formatNodeContextSummary(node: Pick<MindNode, "title" | "summary">): string {
  return node.summary.trim() ? `${node.title}: ${node.summary}` : node.title;
}

function pairCompletedMessages(messages: ChatMessage[]): CompletedMessagePair[] {
  const pairs: CompletedMessagePair[] = [];
  let pendingUser: ChatMessage | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      pendingUser = message.content.trim().length > 0 ? message : null;
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.trim().length === 0) {
        continue;
      }
      if (pendingUser) {
        pairs.push({
          userMessage: pendingUser,
          assistantMessage: message,
        });
        pendingUser = null;
      }
    }
  }

  return pairs;
}

function findInitialUserQuestion(messages: ChatMessage[]): string {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  return firstUser ? firstUser.content.trim() : "";
}

function resolveUsableNodeTitle(title: string): string | null {
  if (title === PENDING_ROOT_TITLE) return null;
  return title.trim().length > 0 ? title : null;
}

function resolveUsableNodeSummary(summary: string): string | null {
  if (summary === PENDING_ROOT_SUMMARY) return null;
  return summary.trim().length > 0 ? summary : null;
}

/**
 * Returns `true` only when a node has at least one non-empty assistant reply
 * (excluding blank nodes and unpopulated pending root placeholders).
 */
export function isCompletedMindNode(node: MindNode): boolean {
  return node.messages.some(
    (message) => message.role === "assistant" && message.content.trim().length > 0,
  );
}

/**
 * Builds ordered `title: summary` strings along the exact node-ID path from
 * root to `nodeId`, avoiding title-lookup collisions when multiple nodes share
 * the same title.
 */
export function buildContextSummariesFromPath(
  project: Project,
  nodeId: string,
): string[] {
  return getNodePath(project, nodeId).map(formatNodeContextSummary);
}

/**
 * Formats an assistant turn as canonical `{ title, summary, content }` JSON
 * matching BranchMind's reply schema (`title <= 120`, `summary <= 280`,
 * `content <= 8000`) for native `role: "assistant"` multi-turn history.
 */
export function formatAssistantTurnJson(
  input: FormatAssistantTurnJsonInput,
): string {
  const rawTitle = input.title.trim();
  const rawSummary = input.summary.trim();
  const hasContent = input.content.trim().length > 0;

  const title =
    compactSingleLine(
      rawTitle || deriveTitleFromContent(input.content),
      MAX_REPLY_TITLE_CHARS,
    ) || "Assistant response";

  const summary =
    compactSingleLine(
      rawSummary || deriveSummaryFromContent(input.content) || title,
      MAX_REPLY_SUMMARY_CHARS,
    ) || title;

  let content: string;
  if (!hasContent) {
    content = summary;
  } else if (input.content.length > MAX_REPLY_CONTENT_CHARS) {
    content = `${safeSliceUtf16(input.content, MAX_REPLY_CONTENT_CHARS - 3).trimEnd()}...`;
  } else {
    content = input.content;
  }

  return JSON.stringify({ title, summary, content });
}

/**
 * Extracts completed `user -> assistant` turns from a node's messages,
 * wrapping each assistant reply in deterministic `{ title, summary, content }`
 * JSON while keeping `assistantRawContent` verbatim.
 */
export function extractNodeTurns(
  node: Pick<MindNode, "id" | "title" | "summary" | "branchType">,
  messages: ChatMessage[],
  depth: number,
): NodeConversationTurn[] {
  const pairs = pairCompletedMessages(messages);
  if (pairs.length === 0) return [];

  const usableNodeTitle = resolveUsableNodeTitle(node.title);
  const usableNodeSummary = resolveUsableNodeSummary(node.summary);

  return pairs.map((pair, index) => {
    const isLastPair = index === pairs.length - 1;
    const userContent = pair.userMessage.content;
    const assistantRawContent = pair.assistantMessage.content;

    const fallbackTitle = derivePairFallbackTitle(userContent, assistantRawContent);
    const fallbackSummary = derivePairFallbackSummary(
      userContent,
      assistantRawContent,
    );

    const turnTitle = isLastPair && usableNodeTitle ? usableNodeTitle : fallbackTitle;
    const turnSummary =
      isLastPair && usableNodeSummary ? usableNodeSummary : fallbackSummary;
    const nodeTitle =
      usableNodeTitle ?? compactSingleLine(turnTitle, MAX_REPLY_TITLE_CHARS);

    return {
      nodeId: node.id,
      nodeTitle,
      branchType: node.branchType,
      depth,
      userContent,
      assistantJsonContent: formatAssistantTurnJson({
        title: turnTitle,
        summary: turnSummary,
        content: assistantRawContent,
      }),
      assistantRawContent,
    };
  });
}

/**
 * Extracts tree-aware ancestor history along the root-to-ancestor path:
 * - Preserves `rootAnchor` regardless of tree depth.
 * - Folds distant completed ancestors into `foldedAncestors` (`title` + `summary`).
 * - Expands the last `maxRecentFullNodes` completed nodes (plus any completed
 *   `currentNodePrefixMessages`) into native multi-turn `recentTurns`.
 */
export function extractAncestorHistory(
  input: ExtractAncestorHistoryInput,
): ExtractedAncestorHistory {
  const pathNodes = input.ancestorNodeId
    ? getNodePath(input.project, input.ancestorNodeId)
    : [];

  const contextTitles = pathNodes.map((node) => node.title);
  const contextSummaries = pathNodes.map(formatNodeContextSummary);

  const firstPathNode = pathNodes[0];
  const rootAnchor: RootContextAnchor | null =
    firstPathNode && isCompletedMindNode(firstPathNode)
      ? {
          nodeId: firstPathNode.id,
          title:
            resolveUsableNodeTitle(firstPathNode.title) ??
            deriveTitleFromContent(
              firstPathNode.messages.find(
                (m) => m.role === "assistant" && m.content.trim().length > 0,
              )?.content ?? "",
            ),
          summary:
            firstPathNode.summary === PENDING_ROOT_SUMMARY
              ? deriveSummaryFromContent(
                  firstPathNode.messages.find(
                    (m) => m.role === "assistant" && m.content.trim().length > 0,
                  )?.content ?? "",
                )
              : firstPathNode.summary,
          initialQuestion: findInitialUserQuestion(firstPathNode.messages),
        }
      : null;

  const completedWithDepth = pathNodes
    .map((node, depth) => ({ node, depth }))
    .filter(({ node }) => isCompletedMindNode(node));

  const recentNodeCount = Math.max(0, Math.floor(input.maxRecentFullNodes));
  const splitIndex = Math.max(0, completedWithDepth.length - recentNodeCount);

  const foldedAncestors: FoldedAncestorNode[] = completedWithDepth
    .slice(0, splitIndex)
    .map(({ node, depth }) => ({
      nodeId: node.id,
      title:
        resolveUsableNodeTitle(node.title) ??
        deriveTitleFromContent(
          node.messages.find(
            (m) => m.role === "assistant" && m.content.trim().length > 0,
          )?.content ?? "",
        ),
      summary:
        node.summary === PENDING_ROOT_SUMMARY
          ? deriveSummaryFromContent(
              node.messages.find(
                (m) => m.role === "assistant" && m.content.trim().length > 0,
              )?.content ?? "",
            )
          : node.summary,
      branchType: node.branchType,
      depth,
    }));

  const recentTurns: NodeConversationTurn[] = completedWithDepth
    .slice(splitIndex)
    .flatMap(({ node, depth }) => extractNodeTurns(node, node.messages, depth));

  if (input.currentNodePrefixMessages && input.currentNodePrefixMessages.length > 0) {
    const prefixNodeMeta: Pick<MindNode, "id" | "title" | "summary" | "branchType"> =
      input.currentNode ?? {
        id: "current_node",
        title: "",
        summary: "",
        branchType: pathNodes.length === 0 ? "root" : "continue",
      };

    recentTurns.push(
      ...extractNodeTurns(
        prefixNodeMeta,
        input.currentNodePrefixMessages,
        pathNodes.length,
      ),
    );
  }

  return {
    pathNodes,
    contextTitles,
    contextSummaries,
    rootAnchor,
    foldedAncestors,
    recentTurns,
  };
}
