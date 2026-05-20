"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { getVisibleNodeIds } from "@/lib/graph";
import type { Project } from "@/lib/types";
import { BranchNodeCard, type BranchNodeData } from "./BranchNodeCard";

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
        },
      }));
  }, [
    creatingNodeId,
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
              stroke: isBranchChild ? "#b293d8" : "#8cc9a7",
              strokeWidth: 2.5,
              strokeDasharray: "7 6",
            },
          };
        }),
    );
  }, [project.nodes, selectedNodeId, visibleNodeIds]);

  const [nodes, setNodes] = useState(graphNodes);

  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current) as Node<BranchNodeData>[]);

      changes.forEach((change) => {
        if (change.type !== "position" || change.dragging || !change.position) return;
        void onMoveNode(change.id, change.position);
      });
    },
    [onMoveNode],
  );

  if (graphNodes.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Mind map has no visible nodes"
        data-testid="mind-map-empty-state"
        className="branchmind-grid grid h-full min-h-[360px] place-items-center rounded-[28px] text-sm font-black text-[#5c5065] lg:rounded-none"
      >
        No visible nodes
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
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodesChange={handleNodesChange}
        fitView
        minZoom={0.25}
        maxZoom={1.7}
        className="branchmind-grid h-full rounded-[28px] lg:rounded-none"
      >
        <Controls className="!rounded-[18px] !border-white/80 !bg-white/80 !shadow-lg" />
      </ReactFlow>
    </div>
  );
}
