"use client";

import Link from "next/link";
import { ArrowLeft, GitBranch, PanelLeftClose, PanelLeftOpen, Search, Sprout } from "lucide-react";
import { useMemo, useState } from "react";
import type { MindNode, Project } from "@/lib/types";

type WorkspaceSidebarProps = {
  project: Project;
  selectedNodeId: string | null;
  isCollapsed: boolean;
  onSelectNode: (nodeId: string) => void;
  onCollapse: () => void;
  onExpand: () => void;
};

export function WorkspaceSidebar({
  project,
  selectedNodeId,
  isCollapsed,
  onSelectNode,
  onCollapse,
  onExpand,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const nodes = useMemo(() => Object.values(project.nodes), [project.nodes]);
  const visibleNodes = normalized
    ? nodes.filter(
        (node) =>
          node.title.toLowerCase().includes(normalized) ||
          node.summary.toLowerCase().includes(normalized),
      )
    : nodes;

  if (isCollapsed) {
    return (
      <aside
        aria-label="Workspace sidebar"
        data-testid="workspace-sidebar"
        className="flex min-h-[76px] w-full items-center justify-center rounded-[28px] border border-white/80 bg-white/72 p-3 shadow-lg shadow-[#e4d6ef]/40 lg:min-h-0"
      >
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand workspace sidebar"
          aria-expanded="false"
          data-testid="expand-workspace-sidebar-button"
          className="grid h-11 w-11 place-items-center rounded-full bg-[#f1e8fb] text-[#6c538d] transition hover:bg-[#e4d5f6] focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
        >
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Workspace sidebar"
      data-testid="workspace-sidebar"
      className="flex min-h-[220px] w-full flex-col gap-5 rounded-[28px] border border-white/80 bg-white/72 p-4 shadow-lg shadow-[#e4d6ef]/40 lg:min-h-0 lg:w-[292px]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/projects"
            className="grid h-10 w-10 place-items-center rounded-full bg-[#f1e8fb] text-[#6c538d] transition hover:bg-[#e4d5f6] focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
            aria-label="Project list"
            data-testid="project-list-link"
          >
            <ArrowLeft size={18} />
          </Link>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse workspace sidebar"
            aria-controls="conversation-outline"
            aria-expanded="true"
            data-testid="collapse-workspace-sidebar-button"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/75 text-[#6c538d] transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#eadcf7]"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-black text-[#382d41]">{project.title}</p>
          <p className="text-xs font-bold text-[#665a70]">{nodes.length} nodes</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8299]" size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search project nodes"
          data-testid="node-search-input"
          placeholder="Search nodes"
          className="h-11 w-full rounded-[18px] border border-white bg-white/82 pl-10 pr-3 text-sm outline-none focus:border-[#b696d4] focus:ring-4 focus:ring-[#eadcf7]"
        />
      </div>

      <nav
        id="conversation-outline"
        aria-label="Conversation outline"
        data-testid="conversation-outline"
        className="min-h-[96px] flex-1 space-y-2 overflow-auto pr-1 lg:min-h-0"
      >
        {visibleNodes.length === 0 ? (
          <p
            role="status"
            data-testid="conversation-outline-empty-state"
            className="rounded-[18px] bg-white/65 p-3 text-sm font-bold text-[#665a70]"
          >
            No matching nodes
          </p>
        ) : (
          visibleNodes.map((node) => (
            <OutlineItem
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              onSelectNode={onSelectNode}
            />
          ))
        )}
      </nav>
    </aside>
  );
}

function OutlineItem({
  node,
  selected,
  onSelectNode,
}: {
  node: MindNode;
  selected: boolean;
  onSelectNode: (nodeId: string) => void;
}) {
  const Icon = node.branchType === "branch" ? GitBranch : Sprout;

  return (
    <button
      type="button"
      onClick={() => onSelectNode(node.id)}
      aria-label={`Open conversation node ${node.title}`}
      aria-current={selected ? "true" : undefined}
      data-testid="conversation-outline-item"
      data-node-id={node.id}
      className={`flex w-full items-start gap-3 rounded-[18px] p-3 text-left transition ${
        selected ? "bg-[#eadcf7] text-[#49315f]" : "bg-white/65 text-[#655a6d] hover:bg-white"
      }`}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80"
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-sm font-black">{node.title}</span>
        <span className="mt-1 block text-xs font-semibold opacity-75">
          {node.children.length} children
        </span>
      </span>
    </button>
  );
}
