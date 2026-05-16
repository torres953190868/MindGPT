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
      className={`group w-[292px] rounded-[24px] border bg-white p-4 text-left shadow-lg transition ${
        selected
          ? "border-[#9d75cf] shadow-[#cab2e5]/60 ring-4 ring-[#eadcf7]"
          : "border-white/90 shadow-[#e2d9ee]/45 hover:-translate-y-1 hover:shadow-xl"
      }`}
    >
      <Handle id="branch-target" type="target" position={Position.Left} className="!bg-[#a489c8]" />
      <Handle id="continue-target" type="target" position={Position.Top} className="!bg-[#91caa8]" />
      <Handle id="branch-source" type="source" position={Position.Right} className="!bg-[#a489c8]" />
      <Handle id="continue-source" type="source" position={Position.Bottom} className="!bg-[#91caa8]" />

      <button
        type="button"
        onClick={() => onSelect(mindNode.id)}
        aria-label={`Open node ${mindNode.title}`}
        aria-pressed={selected}
        data-testid="open-node-button"
        data-node-id={mindNode.id}
        className="nodrag block w-full rounded-[18px] text-left outline-none transition focus:ring-4 focus:ring-[#eadcf7]"
      >
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="block text-xs font-black uppercase tracking-[0.16em] text-[#74687c]">
              {mindNode.branchType === "root"
                ? "Root"
                : mindNode.branchType === "branch"
                  ? "Branch"
                  : "Continue"}
            </span>
            <span
              id={nodeTitleId}
              className="mt-1 line-clamp-2 block text-base font-black text-[#352b3c]"
            >
              {mindNode.title}
            </span>
          </span>
          <span
            aria-label={`${mindNode.children.length} child nodes`}
            className="grid h-9 min-w-9 place-items-center rounded-full bg-[#fff0b8] px-2 text-sm font-black text-[#755816]"
          >
            {mindNode.children.length}
          </span>
        </span>

        <span
          id={nodeSummaryId}
          className="mt-3 line-clamp-3 block text-sm leading-6 text-[#5f5368]"
        >
          {mindNode.summary}
        </span>
      </button>

      <div className="nodrag mt-4 hidden items-center gap-2 sm:flex">
        <button
          type="button"
          disabled={creationDisabled}
          data-testid="continue-down-button"
          data-node-id={mindNode.id}
          onClick={(event) => {
            event.stopPropagation();
            onCreate(mindNode.id, "continue");
          }}
          aria-label="Continue down"
          title="Continue down"
          className="grid h-9 w-9 place-items-center rounded-full bg-[#dff5ea] text-[#376f51] transition hover:bg-[#ccefdc] disabled:cursor-not-allowed disabled:opacity-50"
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
            onCreate(mindNode.id, "branch");
          }}
          aria-label="Branch right"
          title="Branch right"
          className="grid h-9 w-9 place-items-center rounded-full bg-[#eadcf7] text-[#6e4ca0] transition hover:bg-[#dfc9f3] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GitBranch size={17} />
        </button>
        <button
          type="button"
          disabled={isStreaming}
          onClick={(event) => {
            event.stopPropagation();
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
          className="grid h-9 w-9 place-items-center rounded-full bg-[#ffe4ec] text-[#a64e68] transition hover:bg-[#ffd2df] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Ribbon size={17} />
        </button>
      </div>
    </article>
  );
}
