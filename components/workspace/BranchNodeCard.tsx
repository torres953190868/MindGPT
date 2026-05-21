"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Sprout, Ribbon } from "lucide-react";
import type { MindNode } from "@/lib/types";

export type BranchNodeData = {
  mindNode: MindNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  onCreate: (nodeId: string, mode: "continue" | "branch") => void;
  onToggle: (nodeId: string) => void;
  isStreaming: boolean;
  creationDisabled: boolean;
};

export function BranchNodeCard({ data }: NodeProps) {
  const nodeData = data as BranchNodeData;
  const { mindNode, selected, onSelect, onCreate, onToggle, isStreaming, creationDisabled } =
    nodeData;
  const nodeTitleId = `branch-node-${mindNode.id}-title`;
  const nodeSummaryId = `branch-node-${mindNode.id}-summary`;
  const hasChildren = mindNode.children.length > 0;

  return (
    <article
      aria-labelledby={nodeTitleId}
      aria-describedby={nodeSummaryId}
      data-testid="branch-node-card"
      data-node-id={mindNode.id}
      data-selected={selected ? "true" : "false"}
      className={`branch-node-edge-hit-area group w-[292px] rounded-2xl border bg-white p-4 text-left shadow-md transition ${
        selected
          ? "border-brand-400 shadow-lg ring-2 ring-brand-300"
          : "border-white/90 shadow-[rgba(44,35,62,0.08)] hover:-translate-y-1 hover:shadow-lg"
      }`}
    >
      <Handle
        id="branch-target"
        type="target"
        position={Position.Left}
        className="nodrag !bg-[#a489c8]"
      />
      <Handle
        id="continue-target"
        type="target"
        position={Position.Top}
        className="nodrag !bg-[#91caa8]"
      />
      <Handle
        id="branch-source"
        type="source"
        position={Position.Right}
        className="nodrag !bg-[#a489c8]"
      />
      <Handle
        id="continue-source"
        type="source"
        position={Position.Bottom}
        className="nodrag !bg-[#91caa8]"
      />

      <div
        role="presentation"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(mindNode.id);
        }}
        data-testid="branch-node-inner-hit-area"
        data-node-id={mindNode.id}
        className="branch-node-inner-hit-area nodrag nopan rounded-[18px]"
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(mindNode.id);
          }}
          aria-label={`Open node ${mindNode.title}`}
          aria-pressed={selected}
          data-testid="open-node-button"
          data-node-id={mindNode.id}
          className="block w-full rounded-[18px] text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[#eadcf7]"
        >
          <span className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                {mindNode.branchType === "root"
                  ? "Root"
                  : mindNode.branchType === "branch"
                    ? "Branch"
                    : "Continue"}
              </span>
              <span
                id={nodeTitleId}
                className="mt-1 line-clamp-2 block text-base font-black text-neutral-900"
              >
                {mindNode.title}
              </span>
            </span>
            <span
              aria-label={`${mindNode.children.length} child nodes`}
              className="grid h-8 min-w-8 place-items-center rounded-full bg-brand-100 px-2 text-sm font-black text-brand-700"
            >
              {mindNode.children.length}
            </span>
          </span>

          <span
            id={nodeSummaryId}
            className="mt-3 line-clamp-3 block text-sm leading-6 text-neutral-600"
          >
            {mindNode.summary}
          </span>
        </button>

        <div className="mt-4 hidden items-center gap-2 sm:flex">
          <button
            type="button"
            disabled={creationDisabled}
            data-testid="continue-down-button"
            data-node-id={mindNode.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
              onCreate(mindNode.id, "continue");
            }}
            aria-label="Continue down"
            title="Continue down"
            className="grid h-9 w-9 place-items-center rounded-full bg-success-100 text-success-700 transition hover:scale-110 hover:bg-success-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sprout size={17} />
          </button>
          <button
            type="button"
            disabled={creationDisabled}
            data-testid="branch-right-button"
            data-node-id={mindNode.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
              onCreate(mindNode.id, "branch");
            }}
            aria-label="Branch right"
            title="Branch right"
            className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-brand-700 transition hover:scale-110 hover:bg-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch size={17} />
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(mindNode.id);
              onToggle(mindNode.id);
            }}
            aria-label={
              hasChildren
                ? mindNode.collapsed
                  ? `Expand children for ${mindNode.title}`
                  : `Collapse children for ${mindNode.title}`
                : `Toggle children for ${mindNode.title}`
            }
            aria-expanded={hasChildren ? !mindNode.collapsed : undefined}
            title="Toggle children"
            data-testid="toggle-children-button"
            data-node-id={mindNode.id}
            className="grid h-9 w-9 place-items-center rounded-full bg-danger-100 text-danger-600 transition hover:scale-110 hover:bg-danger-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Ribbon size={17} />
          </button>
        </div>
      </div>
    </article>
  );
}
