import type { BranchType, ChatMessage, MindNode, Project } from "@/lib/types";

/**
 * Root node anchor preserved regardless of how deep the conversation tree grows,
 * preventing goal drift past 4+ node hops.
 */
export type RootContextAnchor = {
  nodeId: string;
  title: string;
  summary: string;
  initialQuestion: string;
};

/**
 * Compacted representation of a distant ancestor node along the root-to-parent path.
 * Uses the node's already-generated AI title and summary instead of raw transcripts.
 */
export type FoldedAncestorNode = {
  nodeId: string;
  title: string;
  summary: string;
  branchType: BranchType;
  depth: number;
};

/**
 * A single completed user -> assistant exchange from a recent ancestor (or in-node prefix),
 * ready to be emitted as native multi-turn chat messages without JSON.stringify(history).
 */
export type NodeConversationTurn = {
  nodeId: string;
  nodeTitle: string;
  branchType: BranchType;
  depth: number;
  userContent: string;
  /**
   * Canonical JSON string `{ title, summary, content }` matching BranchMind's output
   * schema so historical assistant turns reinforce structured JSON generation and
   * preserve prefix KV cache stability.
   */
  assistantJsonContent: string;
  /** Raw markdown content of the assistant message before JSON wrapping. */
  assistantRawContent: string;
};

/**
 * Extracted ancestor path history before slot budget downgrading (Point 1).
 */
export type ExtractedAncestorHistory = {
  pathNodes: MindNode[];
  contextTitles: string[];
  contextSummaries: string[];
  rootAnchor: RootContextAnchor | null;
  foldedAncestors: FoldedAncestorNode[];
  recentTurns: NodeConversationTurn[];
};

/**
 * Summarized takeaway from a completed `branch` child off the parent or nearby ancestors (Point 2).
 */
export type SideBranchInsight = {
  nodeId: string;
  parentNodeId: string;
  parentTitle: string;
  title: string;
  summary: string;
  /** Optional leaf conclusion summary when the side-branch itself has a downward chain. */
  leafSummary?: string;
};

/**
 * Mode-specific context weighting and behavioral framing for `root` | `continue` | `branch` (Point 3).
 */
export type TreeContextModePolicy = {
  mode: BranchType;
  hasSourceText: boolean;
  /** Maximum number of recent path nodes initially eligible for full multi-turn expansion. */
  maxRecentFullNodes: number;
  /** Ancestor lookback depth when scanning sibling/ancestor side branches. */
  sideBranchLookbackDepth: number;
  /** Maximum number of side-branch insights to surface. */
  maxSideBranches: number;
  /** Whether pinned project notes should be injected for this mode. */
  includeProjectNotes: boolean;
  /** Character budgets per context slot. */
  budgets: {
    recentTurnsChars: number;
    foldedAncestorsChars: number;
    sideBranchesChars: number;
    projectNotesChars: number;
    userMemoryChars: number;
  };
  /** Concise mode-specific instruction injected into the prompt. */
  modeGuidance: string;
};

/**
 * Reserved extension slot for cross-canvas / project User Memory (Point 4).
 * Future memory services only need to populate this structure.
 */
export type UserMemoryConceptItem = {
  concept: string;
  status: "mastered" | "learning" | "struggling";
  note?: string;
};

export type UserMemoryContextSlot = {
  profileSummary?: string;
  preferredStyle?: string;
  concepts?: UserMemoryConceptItem[];
};

/**
 * Assembled tree-aware prompt context passed from project services into `buildMessages`.
 */
export type TreePromptContext = {
  mode: BranchType;
  hasSourceText: boolean;
  contextTitles: string[];
  contextSummaries: string[];
  rootAnchor: RootContextAnchor | null;
  foldedAncestors: FoldedAncestorNode[];
  recentTurns: NodeConversationTurn[];
  sideBranches: SideBranchInsight[];
  pinnedProjectNotes: string;
  userMemory?: UserMemoryContextSlot;
  policy: TreeContextModePolicy;
};

export type BuildTreePromptContextInput = {
  project: Project;
  /** Direct parent node ID when creating/populating a child, or ancestor parentId on regenerate. */
  ancestorNodeId: string | null;
  mode: BranchType;
  hasSourceText?: boolean;
  /** Current node ID to exclude from side-branch rollups (e.g. blank node or node being regenerated). */
  excludeNodeId?: string;
  /** Prior messages within the current node before a regenerated pair, if any. */
  currentNodePrefixMessages?: ChatMessage[];
  /** Node metadata for `currentNodePrefixMessages` if regenerating inside a multi-turn node. */
  currentNode?: Pick<MindNode, "id" | "title" | "summary" | "branchType">;
  /** Optional user memory slot for future memory integration. */
  userMemory?: UserMemoryContextSlot;
};
