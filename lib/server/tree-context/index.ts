export type {
  BuildTreePromptContextInput,
  ExtractedAncestorHistory,
  FoldedAncestorNode,
  NodeConversationTurn,
  RootContextAnchor,
  SideBranchInsight,
  TreeContextModePolicy,
  TreePromptContext,
  UserMemoryConceptItem,
  UserMemoryContextSlot,
} from "@/lib/server/tree-context/types";

export {
  buildContextSummariesFromPath,
  extractAncestorHistory,
  extractNodeTurns,
  formatAssistantTurnJson,
  isCompletedMindNode,
  type ExtractAncestorHistoryInput,
  type FormatAssistantTurnJsonInput,
} from "@/lib/server/tree-context/ancestor-history";

export {
  DEFAULT_SIDE_BRANCH_ROLLUP_MAX_CHARS,
  extractSideBranchRollup,
  formatSideBranchRollup,
  type ExtractSideBranchRollupInput,
} from "@/lib/server/tree-context/side-branch-rollup";

export {
  DEFAULT_PINNED_PROJECT_NOTES_MAX_CHARS,
  extractPinnedProjectNotes,
  resolveTreeContextModePolicy,
  type ResolveTreeContextModePolicyOptions,
} from "@/lib/server/tree-context/mode-and-notes";

export {
  allocateRecentTurnsWithDowngrade,
  buildTreePromptContext,
  DEFAULT_USER_MEMORY_MAX_CHARS,
  formatFoldedAncestorsSlot,
  formatTreeSystemBackgroundBlock,
  formatUserMemorySlot,
  type AllocateRecentTurnsWithDowngradeInput,
  type AllocateRecentTurnsWithDowngradeResult,
  type FormatFoldedAncestorsSlotInput,
} from "@/lib/server/tree-context/budget-compiler";

export {
  buildContextualizedRetrievalQuery,
  collectInheritedKnowledgeAttachments,
  MAX_RETRIEVAL_QUERY_CHARS,
  type BuildContextualizedRetrievalQueryInput,
  type CollectInheritedKnowledgeAttachmentsInput,
} from "@/lib/server/tree-context/attachment-inheritance";
