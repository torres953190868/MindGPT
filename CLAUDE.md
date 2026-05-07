# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BranchMind is a visual branching AI conversation workspace. Instead of linear chat, it organizes AI conversations into a tree of connected nodes on a canvas. Users can "Continue Down" (extend the main thread) or "Branch Right" (explore a sub-topic in a side node). Each node maintains its own independent message history.

## Commands

```bash
npm run dev        # Start Next.js dev server
npm run build      # Production build
npm run start      # Start production server
npm run lint       # ESLint (zero warnings allowed)
npm run typecheck  # TypeScript type checking (tsc --noEmit)
```

No test framework is configured.

## Environment

Create `.env.local` with:

- `AI_PROVIDER` - Optional, `deepseek` by default. Set to `opencode-go` to use OpenCode Go.
- `DEEPSEEK_API_KEY` - Required when `AI_PROVIDER=deepseek`
- `DEEPSEEK_MODEL` - Optional for DeepSeek, defaults to `deepseek-v4-flash`
- `OPENCODE_GO_API_KEY` - Required when `AI_PROVIDER=opencode-go`
- `OPENCODE_GO_MODEL` - Optional for OpenCode Go, defaults to `deepseek-v4-flash`
- `NEXT_PUBLIC_SUPABASE_URL` - Required in production for Supabase-backed project storage
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Required in production for Supabase client helpers
- `SUPABASE_SERVICE_ROLE_KEY` - Required in production for server-side project repository access
- `BRANCHMIND_PROJECTS_BACKEND` - Optional, `auto` by default. `auto` uses Supabase when configured and falls back to local file storage only outside production.

## Architecture

**Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + @xyflow/react (React Flow) + Zustand

### Data Flow

All state lives in a single Zustand store (`store/useBranchMindStore.ts`) and is persisted to `localStorage`. The store owns the full `Project[]` array where each `Project` contains a flat `Record<string, MindNode>` map. Nodes reference each other via `parentId` / `children: string[]` forming a tree.

When creating a node, the store calls `requestBranchMindReply()` which POSTs to `/api/chat`. The API route (`app/api/chat/route.ts`) forwards to DeepSeek's chat completions endpoint and expects JSON with `title`, `summary`, and `content` keys.

### Key Types (lib/types.ts)

- `MindNode` - A conversation node with messages, tree relationships, canvas position, branch type, and collapsed state
- `Project` - Container with a `rootNodeId` and flat `nodes` map
- `BranchType` - `"root" | "continue" | "branch"` - determines node layout direction

### Page Structure

- `/` - Landing page with project creation form
- `/projects` - Project list with search and delete
- `/workspace/[projectId]` - Main workspace: 3-column layout (sidebar outline | React Flow canvas | node detail panel)

### Workspace Components (components/workspace/)

- `WorkspaceShell.tsx` - Orchestrates the 3-panel layout, wires store actions to child components
- `MindMap.tsx` - React Flow canvas. Converts `MindNode` map into React Flow nodes/edges. Uses `getVisibleNodeIds()` to respect collapsed state.
- `BranchNodeCard.tsx` - Custom React Flow node type. Renders node card with Continue/Branch/Fold action buttons.
- `NodeDetailPanel.tsx` - Shows selected node's full message history and a form to send new instructions (Continue or Branch mode)
- `WorkspaceSidebar.tsx` - Searchable node outline list

### Graph Layout (lib/graph.ts)

Node positions are calculated deterministically: `branch` children offset right (+390px X), `continue` children offset down (+290px Y). Siblings in the same direction stack with +92px gap. Position is stored on each node and updated on drag.

### Dev Tools

`ElementInspectorPlugin` (dev-only, activated via `Alt+I`) provides a DOM element inspector that copies CSS selectors to clipboard.

## Conventions

- Path alias: `@/*` maps to project root
- All workspace components are `"use client"` - the app is heavily client-side
- Node IDs use `createId(prefix)` with `crypto.randomUUID()` fallback
- The AI system prompt requests JSON output with title/summary/content; the API route parses this with fallback to raw text
- UI style: pastel color palette, large border-radius (16-28px), Nunito font, soft shadows
