import { getNodePath } from "@/lib/graph";
import {
  PENDING_ROOT_SUMMARY,
  PENDING_ROOT_TITLE,
} from "@/lib/server/project-model";
import type { ChatAttachment, ChatMessage, Project } from "@/lib/types";

export const MAX_RETRIEVAL_QUERY_CHARS = 480;
const MAX_SOURCE_TEXT_CHARS = 220;
const MAX_PARENT_SUMMARY_CHARS = 140;
const PRIMARY_LONG_THRESHOLD_CHARS = 360;
const MAX_ANCHOR_TITLE_CHARS = 120;
const MIN_PRIMARY_SOURCE_CHARS = 80;
const MIN_TRUNCATED_SUMMARY_CHARS = 24;

export type CollectInheritedKnowledgeAttachmentsInput = {
  project: Project;
  ancestorNodeId: string | null;
  explicitAttachments?: ChatAttachment[];
  currentNodePrefixMessages?: ChatMessage[];
};

export type BuildContextualizedRetrievalQueryInput = {
  project: Project;
  ancestorNodeId: string | null;
  instruction: string;
  sourceText?: string;
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

function resolveUsableNodeTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || trimmed === PENDING_ROOT_TITLE) return null;
  return compactSingleLine(trimmed, MAX_ANCHOR_TITLE_CHARS);
}

function resolveUsableNodeSummary(summary: string): string | null {
  const trimmed = summary.trim();
  if (!trimmed || trimmed === PENDING_ROOT_SUMMARY) return null;
  return trimmed;
}

function fitPrimaryToBudget(
  instruction: string,
  compactedSource: string,
  budget: number,
): string {
  if (budget <= 0) return "";

  if (instruction && compactedSource) {
    const combined = `${instruction}\n${compactedSource}`;
    if (combined.length <= budget) return combined;

    const remainingForSource = budget - instruction.length - 1;
    if (remainingForSource >= MIN_PRIMARY_SOURCE_CHARS) {
      return `${instruction}\n${compactSingleLine(compactedSource, remainingForSource)}`;
    }

    const sourceBudget = Math.min(
      compactedSource.length,
      Math.max(
        MIN_TRUNCATED_SUMMARY_CHARS,
        Math.min(MIN_PRIMARY_SOURCE_CHARS, Math.floor(budget * 0.25)),
      ),
    );
    const instructionBudget = Math.max(1, budget - sourceBudget - 1);
    return `${compactSingleLine(instruction, instructionBudget)}\n${compactSingleLine(compactedSource, sourceBudget)}`;
  }

  const single = instruction || compactedSource;
  if (!single) return "";
  return single.length <= budget ? single : compactSingleLine(single, budget);
}

/**
 * Collects knowledge attachments (`documentId` / `curriculumId`) from prior
 * turns in the current node and along the ancestor path back to the root,
 * ordered closest-context-first and deduplicated against `explicitAttachments`.
 *
 * Never mutates persisted node messages — inherited attachments are used only
 * for server-side RAG / curriculum context resolution.
 */
export function collectInheritedKnowledgeAttachments(
  input: CollectInheritedKnowledgeAttachmentsInput,
): ChatAttachment[] {
  const seenDocumentIds = new Set<string>();
  const seenCurriculumIds = new Set<string>();

  for (const explicit of input.explicitAttachments ?? []) {
    const documentId = explicit.documentId?.trim();
    if (documentId) seenDocumentIds.add(documentId);
    const curriculumId = explicit.curriculumId?.trim();
    if (curriculumId) seenCurriculumIds.add(curriculumId);
  }

  const inherited: ChatAttachment[] = [];

  function scanMessagesLatestFirst(messages: ChatMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      for (const attachment of message.attachments) {
        const documentId = attachment.documentId?.trim() || undefined;
        const curriculumId = attachment.curriculumId?.trim() || undefined;
        if (!documentId && !curriculumId) continue;

        if (documentId) {
          if (seenDocumentIds.has(documentId)) continue;
          seenDocumentIds.add(documentId);
        }

        if (curriculumId) {
          if (seenCurriculumIds.has(curriculumId)) continue;
          seenCurriculumIds.add(curriculumId);
        }

        inherited.push({ ...attachment });
      }
    }
  }

  if (input.currentNodePrefixMessages && input.currentNodePrefixMessages.length > 0) {
    scanMessagesLatestFirst(input.currentNodePrefixMessages);
  }

  const pathNodes = input.ancestorNodeId
    ? getNodePath(input.project, input.ancestorNodeId)
    : [];

  for (let nodeIndex = pathNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    scanMessagesLatestFirst(pathNodes[nodeIndex].messages);
  }

  return inherited;
}

/**
 * Builds a concise, high-signal retrieval query (`<= 480` chars) by anchoring
 * the user's `instruction` (and optional `sourceText`) with the immediate
 * parent node's topic/summary and the root node's domain title.
 */
export function buildContextualizedRetrievalQuery(
  input: BuildContextualizedRetrievalQueryInput,
): string {
  const rawInstruction = input.instruction.trim();
  const compactedSource = input.sourceText?.trim()
    ? compactSingleLine(input.sourceText, MAX_SOURCE_TEXT_CHARS)
    : "";
  const rawPrimaryParts = [rawInstruction, compactedSource].filter(
    (part) => part.length > 0,
  );
  const rawPrimaryText = rawPrimaryParts.join("\n");

  const pathNodes = input.ancestorNodeId
    ? getNodePath(input.project, input.ancestorNodeId)
    : [];

  if (pathNodes.length === 0) {
    return fitPrimaryToBudget(
      rawInstruction,
      compactedSource,
      MAX_RETRIEVAL_QUERY_CHARS,
    );
  }

  const parentNode = pathNodes[pathNodes.length - 1];
  const parentTitle = resolveUsableNodeTitle(parentNode.title);
  const parentSummary = resolveUsableNodeSummary(parentNode.summary);

  const rawRootTitle =
    pathNodes.length > 1 ? resolveUsableNodeTitle(pathNodes[0].title) : null;
  const rootTitle =
    rawRootTitle &&
    (!parentTitle || rawRootTitle.toLowerCase() !== parentTitle.toLowerCase())
      ? rawRootTitle
      : null;

  let parentAnchor: string | null = null;
  if (rawPrimaryText.length > PRIMARY_LONG_THRESHOLD_CHARS) {
    parentAnchor = parentTitle;
  } else if (parentTitle && parentSummary) {
    const availableForAnchors =
      rawPrimaryText.length > 0
        ? MAX_RETRIEVAL_QUERY_CHARS - rawPrimaryText.length - 1
        : MAX_RETRIEVAL_QUERY_CHARS;
    const titlesCost =
      parentTitle.length + (rootTitle ? 1 + rootTitle.length : 0);
    const summaryBudget = Math.min(
      MAX_PARENT_SUMMARY_CHARS,
      availableForAnchors - titlesCost - 2,
    );
    parentAnchor =
      summaryBudget >= MIN_TRUNCATED_SUMMARY_CHARS
        ? `${parentTitle}: ${compactSingleLine(parentSummary, summaryBudget)}`
        : parentTitle;
  } else if (parentTitle) {
    parentAnchor = parentTitle;
  } else if (parentSummary) {
    parentAnchor = compactSingleLine(parentSummary, MAX_PARENT_SUMMARY_CHARS);
  }

  const anchorLines = [parentAnchor, rootTitle].filter(
    (line): line is string => Boolean(line),
  );
  if (anchorLines.length === 0) {
    return fitPrimaryToBudget(
      rawInstruction,
      compactedSource,
      MAX_RETRIEVAL_QUERY_CHARS,
    );
  }

  let anchorBlock = anchorLines.join("\n");
  if (anchorBlock.length > 180 && anchorLines.length === 2) {
    const rootBudget = Math.max(
      MIN_TRUNCATED_SUMMARY_CHARS,
      180 - anchorLines[0].length - 1,
    );
    anchorBlock = `${anchorLines[0]}\n${compactSingleLine(anchorLines[1], rootBudget)}`;
  }

  if (rawPrimaryText.length === 0) {
    return anchorBlock.length <= MAX_RETRIEVAL_QUERY_CHARS
      ? anchorBlock
      : compactSingleLine(anchorBlock, MAX_RETRIEVAL_QUERY_CHARS);
  }

  const primaryBudget = MAX_RETRIEVAL_QUERY_CHARS - 1 - anchorBlock.length;
  const fittedPrimary = fitPrimaryToBudget(
    rawInstruction,
    compactedSource,
    primaryBudget,
  );
  return fittedPrimary ? `${fittedPrimary}\n${anchorBlock}` : anchorBlock;
}
