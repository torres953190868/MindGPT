"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff } from "lucide-react";
import {
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type NodeTypes,
} from "@xyflow/react";
import { getVisibleNodeIds } from "@/lib/graph";
import type { Project } from "@/lib/types";
import {
  BranchNodeCard,
  type BranchNodeData,
  type InlineNodeComposerData,
} from "./BranchNodeCard";

const nodeTypes: NodeTypes = {
  branchNode: BranchNodeCard,
};

type MindMapProps = {
  project: Project;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onCreateNode: (nodeId: string, mode: "continue" | "branch") => void;
  onToggleNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  inlineNodeComposer?: InlineNodeComposerData;
};

export function MindMap({
  project,
  selectedNodeId,
  onSelectNode,
  onCreateNode,
  onToggleNode,
  onMoveNode,
  creatingNodeId,
  streamingNodeId,
  inlineNodeComposer,
}: MindMapProps) {
  const visibleNodeIds = useMemo(() => getVisibleNodeIds(project), [project]);

  const graphNodes = useMemo<Node<BranchNodeData>[]>(() => {
    return Object.values(project.nodes)
      .filter((node) => visibleNodeIds.has(node.id))
      .map((node) => ({
        id: node.id,
        type: "branchNode",
        position: node.position,
        selected: selectedNodeId === node.id,
        dragHandle: ".branch-node-edge-hit-area",
        data: {
          mindNode: node,
          selected: selectedNodeId === node.id,
          onSelect: onSelectNode,
          onCreate: onCreateNode,
          onToggle: onToggleNode,
          isStreaming: streamingNodeId === node.id,
          creationDisabled: Boolean(creatingNodeId),
          inlineComposer:
            inlineNodeComposer?.nodeId === node.id ? inlineNodeComposer : undefined,
        },
      }));
  }, [
    creatingNodeId,
    inlineNodeComposer,
    onCreateNode,
    onSelectNode,
    onToggleNode,
    project.nodes,
    selectedNodeId,
    streamingNodeId,
    visibleNodeIds,
  ]);

  const graphEdges = useMemo<Edge[]>(() => {
    return Object.values(project.nodes).flatMap((node) =>
      node.children
        .filter((childId) => visibleNodeIds.has(node.id) && visibleNodeIds.has(childId))
        .map((childId) => {
          const child = project.nodes[childId];
          const isBranchChild = child?.branchType === "branch";
          return {
            id: `${node.id}-${childId}`,
            source: node.id,
            target: childId,
            sourceHandle: isBranchChild ? "branch-source" : "continue-source",
            targetHandle: isBranchChild ? "branch-target" : "continue-target",
            animated: selectedNodeId === node.id || selectedNodeId === childId,
            style: {
              stroke: isBranchChild ? "#c4ade6" : "#9bd8c6",
              strokeWidth: 2,
              strokeDasharray: "6 5",
            },
          };
        }),
    );
  }, [project.nodes, selectedNodeId, visibleNodeIds]);

  const [nodes, setNodes] = useState(graphNodes);
  const dragDisabled = Boolean(creatingNodeId || streamingNodeId);
  const fitViewOptions = useMemo(
    () => ({
      maxZoom: inlineNodeComposer ? 1 : 1.7,
    }),
    [inlineNodeComposer],
  );

  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current) as Node<BranchNodeData>[]);
    },
    [],
  );

  const handleNodeDragStop: OnNodeDrag<Node<BranchNodeData>> = useCallback(
    (_, node) => {
      if (dragDisabled) return;
      void onMoveNode(node.id, node.position);
    },
    [dragDisabled, onMoveNode],
  );

  if (graphNodes.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Mind map has no visible nodes"
        data-testid="mind-map-empty-state"
        className="branchmind-grid grid h-full min-h-[360px] place-items-center rounded-2xl lg:rounded-none"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <EyeOff size={28} className="text-neutral-400" />
          <span className="text-sm font-black text-neutral-600">No visible nodes</span>
        </div>
      </div>
    );
  }

  return (
    <div
      id="mind-map"
      role="region"
      aria-label="Mind map"
      data-testid="mind-map"
      className="h-full min-h-[360px]"
    >
      <ReactFlow
        aria-label="Interactive mind map canvas"
        data-testid="mind-map-react-flow"
        nodes={nodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={!dragDisabled}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.25}
        maxZoom={1.7}
        className="branchmind-grid h-full rounded-[28px] lg:rounded-none"
      >
        <Controls className="!rounded-[18px] !border-white/80 !bg-white/80 !shadow-lg" />
      </ReactFlow>
    </div>
  );
}
