"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  GitBranch,
  PanelLeftClose,
  Search,
  Sprout,
  Tags,
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
      className="flex min-h-[220px] w-full flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm lg:min-h-0 lg:rounded-none lg:border-0 lg:shadow-none"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/projects"
            className="inline-flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-xs font-bold text-[#5f556b] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
            aria-label="Back to projects"
            data-testid="project-list-link"
          >
            <ArrowLeft size={15} />
            <span className="truncate">Back to projects</span>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse workspace sidebar"
            aria-controls="conversation-outline"
            aria-expanded="true"
            data-testid="collapse-workspace-sidebar-button"
            className="grid h-8 w-8 place-items-center rounded-md text-[#6b6077] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

        <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search project nodes"
          data-testid="node-search-input"
          placeholder="Search nodes"
          className="h-9 w-full rounded-md border border-neutral-200 bg-white pl-9 pr-11 text-xs font-medium text-neutral-900 outline-none placeholder:text-neutral-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-500">
          ⌘K
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Workspace sidebar views"
        className="grid grid-cols-2 border-b border-neutral-200 text-xs font-bold"
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="relative h-9 text-brand-700 after:absolute after:bottom-[-1px] after:left-1/2 after:h-0.5 after:w-10 after:-translate-x-1/2 after:rounded-full after:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200/40"
        >
          Outline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-neutral-600 transition hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200/40"
        >
          <Tags size={13} />
          Tags
        </button>
      </div>

      <nav
        id="conversation-outline"
        aria-label="Conversation outline"
        data-testid="conversation-outline"
        className="min-h-[96px] flex-1 space-y-1 overflow-auto pr-1 lg:min-h-0"
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
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-brand-600 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 lg:mt-1"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span aria-hidden="true" className="h-5 w-5 shrink-0 lg:mt-1 lg:w-3.5" />
      )}
      <button
        type="button"
        onClick={() => onSelectNode(node.id)}
        aria-label={`Open conversation node ${node.title}`}
        aria-current={selected ? "true" : undefined}
        data-testid="conversation-outline-item"
        data-node-id={node.id}
        className="flex min-h-10 min-w-0 flex-1 items-start gap-1.5 rounded-xl p-0.5 text-left outline-none transition focus:ring-2 focus:ring-brand-200 lg:min-h-0"
      >
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${selected ? "bg-brand-100 text-brand-700" : "bg-white/80 text-neutral-500"}`}
        >
          <Icon size={13} />
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
