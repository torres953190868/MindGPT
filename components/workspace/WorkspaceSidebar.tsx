"use client";

import Link from "next/link";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  PanelLeftClose,
  Search,
  Sprout,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { MindNode, Project } from "@/lib/types";

type WorkspaceSidebarProps = {
  footer?: ReactNode;
  project: Project;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onCollapse: () => void;
};

type OutlineRow = {
  node: MindNode;
  depth: number;
};

function matchesQuery(node: MindNode, normalized: string) {
  return (
    node.title.toLowerCase().includes(normalized) ||
    node.summary.toLowerCase().includes(normalized)
  );
}

function getDefaultExpandedNodeIds(project: Project) {
  const expanded = new Set<string>();
  const root = project.nodes[project.rootNodeId];
  if (!root) return expanded;

  if (root.children.length > 0) expanded.add(root.id);
  root.children.forEach((childId) => {
    const child = project.nodes[childId];
    if (child && child.children.length > 0) expanded.add(child.id);
  });

  return expanded;
}

function getAncestorIds(project: Project, nodeId: string | null) {
  const ids: string[] = [];
  let current = nodeId ? project.nodes[nodeId] : null;

  while (current?.parentId) {
    ids.unshift(current.parentId);
    current = project.nodes[current.parentId] ?? null;
  }

  return ids;
}

function getSearchExpandedNodeIds(project: Project, normalized: string) {
  const expanded = new Set<string>();

  Object.values(project.nodes).forEach((node) => {
    if (!matchesQuery(node, normalized)) return;
    getAncestorIds(project, node.id).forEach((ancestorId) => expanded.add(ancestorId));
  });

  return expanded;
}

function getVisibleOutlineRows(
  project: Project,
  expandedNodeIds: Set<string>,
  normalized: string,
) {
  const rows: OutlineRow[] = [];
  const matchingNodeIds = normalized
    ? new Set(
        Object.values(project.nodes)
          .filter((node) => matchesQuery(node, normalized))
          .map((node) => node.id),
      )
    : null;
  const includedNodeIds = new Set<string>();

  if (matchingNodeIds?.size === 0) return rows;

  if (matchingNodeIds) {
    matchingNodeIds.forEach((nodeId) => {
      includedNodeIds.add(nodeId);
      getAncestorIds(project, nodeId).forEach((ancestorId) => includedNodeIds.add(ancestorId));
    });
  }

  function visit(nodeId: string, depth: number) {
    const node = project.nodes[nodeId];
    if (!node) return;
    if (includedNodeIds.size > 0 && !includedNodeIds.has(nodeId)) return;

    rows.push({ node, depth });

    if (!expandedNodeIds.has(nodeId)) return;

    node.children.forEach((childId) => visit(childId, depth + 1));
  }

  visit(project.rootNodeId, 0);
  return rows;
}

export function WorkspaceSidebar({
  footer,
  project,
  selectedNodeId,
  onSelectNode,
  onCollapse,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() =>
    getDefaultExpandedNodeIds(project),
  );
  const previousProjectId = useRef(project.id);
  const previousSelectedNodeId = useRef(selectedNodeId);
  const normalized = query.trim().toLowerCase();
  const effectiveExpandedNodeIds = useMemo(() => {
    if (!normalized) return expandedNodeIds;
    return new Set([...expandedNodeIds, ...getSearchExpandedNodeIds(project, normalized)]);
  }, [expandedNodeIds, normalized, project]);
  const outlineRows = useMemo(
    () => getVisibleOutlineRows(project, effectiveExpandedNodeIds, normalized),
    [effectiveExpandedNodeIds, normalized, project],
  );
  const hasMatches = outlineRows.length > 0;

  useEffect(() => {
    if (previousProjectId.current === project.id) return;
    previousProjectId.current = project.id;
    setExpandedNodeIds(getDefaultExpandedNodeIds(project));
  }, [project]);

  useEffect(() => {
    if (previousSelectedNodeId.current === selectedNodeId) return;
    previousSelectedNodeId.current = selectedNodeId;
    if (!selectedNodeId) return;

    const ancestorIds = getAncestorIds(project, selectedNodeId);
    if (ancestorIds.length === 0) return;

    setExpandedNodeIds((current) => {
      const next = new Set(current);
      let changed = false;
      ancestorIds.forEach((ancestorId) => {
        if (next.has(ancestorId)) return;
        next.add(ancestorId);
        changed = true;
      });
      if (!changed) return current;
      return next;
    });
  }, [project, selectedNodeId]);

  function toggleOutlineNode(nodeId: string) {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  return (
    <aside
      aria-label="Workspace sidebar"
      data-testid="workspace-sidebar"
      className="flex min-h-[220px] w-full flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:min-h-0 lg:rounded-none lg:border-0 lg:shadow-none"
    >
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Link
          href="/"
          aria-label="BranchMind home"
          className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-neutral-900 transition hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-brand-200 bg-brand-50 text-brand-600">
            <Brain size={18} />
          </span>
          <span className="truncate text-base font-extrabold">BranchMind</span>
        </Link>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse workspace sidebar"
          aria-controls="conversation-outline"
          aria-expanded="true"
          data-testid="collapse-workspace-sidebar-button"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search project nodes"
          data-testid="node-search-input"
          placeholder="Search nodes"
          className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-14 text-sm font-bold text-neutral-900 outline-none placeholder:text-neutral-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-black text-neutral-500">
          ⌘K
        </span>
      </div>

      <nav
        aria-label="Workspace sidebar navigation"
        className="grid grid-cols-2 gap-2 text-sm font-black"
      >
        <button
          type="button"
          aria-current="page"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-100 text-brand-800 transition hover:bg-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          Outline
        </button>
        <Link
          href="/projects"
          data-testid="workspace-sidebar-projects-link"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          <Folder size={16} />
          Projects
        </Link>
      </nav>

      <nav
        id="conversation-outline"
        aria-label="Conversation outline"
        data-testid="conversation-outline"
        className="min-h-[96px] flex-1 space-y-2 overflow-auto pr-1 lg:min-h-0"
      >
        {!hasMatches ? (
          <div
            role="status"
            data-testid="conversation-outline-empty-state"
            className="flex flex-col items-center rounded-lg bg-neutral-50 p-4 text-center"
          >
            <Search size={20} className="text-neutral-300" />
            <p className="mt-2 text-sm font-bold text-neutral-600">No matching nodes</p>
          </div>
        ) : (
          outlineRows.map(({ node, depth }) => (
            <OutlineItem
              key={node.id}
              node={node}
              depth={depth}
              expanded={effectiveExpandedNodeIds.has(node.id)}
              selected={selectedNodeId === node.id}
              onSelectNode={onSelectNode}
              onToggleNode={toggleOutlineNode}
            />
          ))
        )}
      </nav>
      {footer && (
        <div
          data-testid="workspace-sidebar-footer"
          className="mt-auto border-t border-[#ebe7f1] pt-3"
        >
          {footer}
        </div>
      )}
    </aside>
  );
}

function OutlineItem({
  node,
  depth,
  expanded,
  selected,
  onSelectNode,
  onToggleNode,
}: {
  node: MindNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onSelectNode: (nodeId: string) => void;
  onToggleNode: (nodeId: string) => void;
}) {
  const Icon = node.branchType === "branch" ? GitBranch : Sprout;
  const hasChildren = node.children.length > 0;

  return (
    <div
      data-testid="conversation-outline-row"
      data-node-id={node.id}
      data-depth={depth}
      className={`relative flex w-full items-start gap-1 rounded-xl px-1.5 py-1 text-left transition ${
        selected ? "bg-brand-50 text-brand-800" : "bg-white/65 text-neutral-700 hover:bg-white"
      }`}
      style={{ paddingLeft: `${Math.min(depth, 4) * 6 + 6}px` }}
    >
      {selected && (
        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500" />
      )}
      {hasChildren ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleNode(node.id);
          }}
          aria-label={`${expanded ? "Collapse" : "Expand"} children for ${node.title}`}
          aria-expanded={expanded}
          data-testid="conversation-outline-toggle"
          data-node-id={node.id}
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/75 text-brand-600 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 lg:mt-1"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span aria-hidden="true" className="h-7 w-7 shrink-0 lg:mt-1" />
      )}
      <button
        type="button"
        onClick={() => onSelectNode(node.id)}
        aria-label={`Open conversation node ${node.title}`}
        aria-current={selected ? "true" : undefined}
        data-testid="conversation-outline-item"
        data-node-id={node.id}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-xl p-0.5 text-left outline-none transition focus:ring-2 focus:ring-brand-200 lg:min-h-0"
      >
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${selected ? "bg-brand-100 text-brand-700" : "bg-white/80 text-neutral-500"}`}
        >
          <Icon size={14} />
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm font-black leading-5">{node.title}</span>
          <span className="mt-0.5 block text-xs font-semibold leading-4 opacity-75">
            {node.children.length} children
          </span>
        </span>
      </button>
    </div>
  );
}
