# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BranchMind is a visual branching AI conversation workspace. Instead of linear chat, it organizes AI conversations into a tree of connected nodes on a canvas. Users can "Continue Down" (extend the main thread) or "Branch Right" (explore a sub-topic in a side node). Each node maintains its own independent message history.

The app also includes a selectable-text PDF reader and RAG MVP. Users can upload PDFs, parse page text, index chunks, ask grounded questions with citations, and attach indexed PDFs as knowledge context inside BranchMind conversations. PDF parsing/indexing is now queued in production through Vercel Queues and runs inline by default in local `next dev`.

## Commands

```bash
npm run dev               # Start Next.js dev server on 127.0.0.1:3002
npm run build             # Production build
npm run start             # Start production server
npm run lint              # ESLint (zero warnings allowed)
npm run typecheck         # TypeScript type checking (tsc --noEmit)
npm run test              # Vitest unit/integration tests
npm run e2e               # Playwright E2E tests
npm run smoke:prod        # Production server smoke test
npm run migrate:supabase  # Migrate local file data to Supabase
```

Playwright uses `AI_MOCK_MODE=true`, file-backed storage, and a test web server by default unless `PLAYWRIGHT_BASE_URL` or `PLAYWRIGHT_WEB_SERVER_COMMAND` is set.

## Environment

Copy `.env.example` to `.env.local` and fill the providers you want to use.

Core chat completion:

- `AI_PROVIDER` - Optional, `deepseek` by default. Set to `opencode-go` or `gemini` to use those providers.
- `AI_MOCK_MODE` - Optional local/CI mock mode for deterministic AI replies.
- `DEEPSEEK_API_KEY` - Required when `AI_PROVIDER=deepseek` unless mock mode is enabled.
- `DEEPSEEK_MODEL` - Optional for DeepSeek, defaults to `deepseek-v4-flash`.
- `DEEPSEEK_ALLOWED_MODELS` - Optional comma-separated allowlist for the model selector.
- `OPENCODE_GO_API_KEY` - Required when `AI_PROVIDER=opencode-go` unless mock mode is enabled.
- `OPENCODE_GO_MODEL` - Optional for OpenCode Go, defaults to `glm-5.1`.
- `OPENCODE_GO_TIMEOUT_MS` - Optional provider timeout, defaults to `90000`.
- `OPENCODE_GO_ALLOWED_MODELS` - Optional comma-separated allowlist for the model selector.
- `GEMINI_API_KEY` - Required when `AI_PROVIDER=gemini` unless mock mode is enabled.
- `GEMINI_MODEL` - Optional for Gemini, defaults to `gemini-3.5-flash`.
- `GEMINI_URL` - Optional OpenAI-compatible Gemini chat completions endpoint override.
- `GEMINI_ALLOWED_MODELS` - Optional comma-separated allowlist for the model selector.
- `AI_PROVIDER_TIMEOUT_MS` - Optional global timeout fallback for chat-completions providers.
- `BRANCHMIND_ADMIN_EMAILS` - Comma-separated Supabase Auth emails allowed to access `/admin`.
- `BRANCHMIND_ENABLE_LOCAL_ADMIN` - Optional local-only admin bypass for development without Supabase Auth.

Auth, origin, and project storage:

- `APP_ORIGIN` - Used to build Supabase Auth OAuth callback URLs.
- `ALLOWED_ORIGINS` or `TRUSTED_ORIGINS` - Optional origin allowlist for production requests.
- `NEXT_PUBLIC_SUPABASE_URL` - Required in production for Supabase-backed auth/storage.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Required for Supabase client helpers.
- `SUPABASE_SERVICE_ROLE_KEY` - Required for server-side Supabase repositories.
- `BRANCHMIND_PROJECTS_BACKEND` - Optional, `auto` by default. Values: `auto`, `file`, `supabase`.
- `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION` - Only for production smoke tests that intentionally use file storage.

PDF Reader + RAG:

- `BRANCHMIND_RAG_BACKEND` - Optional, `auto` by default. Values: `auto`, `file`, `supabase`.
- `BRANCHMIND_RAG_QUEUE_MODE` - Optional, `inline` or `queue`. Defaults to `inline` in development and `queue` elsewhere.
- `MAX_PDF_SIZE_MB` - Optional PDF upload size limit, defaults to `50`.
- `EMBEDDING_PROVIDER` - `dashscope`, `gemini`, or `mock`. Defaults to `dashscope`.
- `EMBEDDING_MODEL` - Defaults to `text-embedding-v4` for DashScope.
- `EMBEDDING_DIMENSIONS` - Defaults to `1024`; Supabase vector storage expects 1024 dimensions.
- `DASHSCOPE_API_KEY` - Required when using DashScope embeddings.
- `GEMINI_API_KEY` - Required when using Gemini embeddings.
- `GEMINI_EMBEDDING_MODEL` / `GEMINI_EMBEDDING_DIMENSIONS` - Optional Gemini-specific overrides.
- `EMBEDDING_RETRY_ATTEMPTS`, `EMBEDDING_RETRY_DELAY_MS`, `EMBEDDING_RETRY_MAX_DELAY_MS` - Optional retry tuning.
- `LLM_PROVIDER` - Optional RAG answer provider, defaults to `AI_PROVIDER` or `deepseek`.
- `LLM_MODEL` - Optional RAG answer model override.

Production requires Supabase configuration. File storage falls back only outside production, except when explicitly allowed for smoke testing. Production PDF processing expects Vercel Queues unless `BRANCHMIND_RAG_QUEUE_MODE=inline` is intentionally set.

## Architecture

**Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + @xyflow/react (React Flow) + Zustand + Supabase + pdfjs-dist + @vercel/queue + Vitest + Playwright

### Data Flow

`store/useBranchMindStore.ts` is the client-side workspace coordinator. It keeps hydrated project state, selection state, pending sync state, optimistic node drafts, streaming status, and UI errors.

Project data is no longer primarily persisted directly from the store to `localStorage`. The store loads and mutates projects through API routes such as `/api/projects`, `/api/projects/[projectId]`, `/api/projects/[projectId]/sync`, and `/api/projects/[projectId]/nodes/stream`. Legacy `localStorage` keys are still read once and imported through `/api/projects/import`. Pending project sync records remain in browser storage so draft project creation can survive a server/API failure.

Server project persistence is abstracted by `lib/server/projects-repository.ts`:

- `auto` uses Supabase when configured and file storage otherwise outside production.
- `supabase` uses `branchmind_projects`, `branchmind_nodes`, and `branchmind_messages`.
- `file` writes local JSON data and is blocked in production unless explicitly allowed.

Auth is resolved by `getBranchMindAuthContext()`:

- With Supabase configured, confirmed Supabase users are required.
- BranchMind account-name/password registration uses Supabase Auth admin user
  creation with internally mapped emails under `users.branchmind.invalid`.
  Existing Supabase email users can still sign in by entering their email as the
  account name. Public email sign-up, magic links, and email password recovery
  are disabled.
- Without Supabase, the app uses an HTTP-only local session cookie.

Mutation routes validate request origins, parse bodies with Zod schemas, and apply rate limits. Rate limiting uses Supabase when possible and falls back to an in-memory map.

### AI Flow

Static chat provider defaults are defined in `lib/server/ai-provider.ts`. Runtime model routing is coordinated by `lib/server/llm-router.ts`, which reads Supabase-backed admin configuration from `branchmind_llm_providers`, `branchmind_llm_models`, and `branchmind_llm_routes` when Supabase is configured, and falls back to static env-based config otherwise.

The supported built-in chat completion providers are DeepSeek, OpenCode Go, and Gemini through Google's OpenAI-compatible endpoint. The model selector is served from `/api/chat/models` and only exposes configured providers/models that support JSON responses. LLM route tasks are `node_generation`, `branch_chat`, and `pdf_qa`, each with default and optional fallback model routing.

Initial project creation creates a pending root node first, then streams the first assistant response through the node regeneration route. Child nodes are created optimistically on the client and finalized by `/api/projects/[projectId]/nodes/stream`.

Streaming node routes call `streamDeepSeekReply()` from `lib/server/deepseek-streaming.ts`. Despite the DeepSeek name, this path sends OpenAI-compatible requests through the LLM router and can use DeepSeek, OpenCode Go, Gemini, or Supabase-configured providers. Routes emit SSE events:

- `delta` - assistant content delta for optimistic UI updates
- `complete` - finalized project/node data after persistence
- `error` - safe error payload with request id

The AI system prompt requests JSON output with `title`, `summary`, and `content`. Non-streaming calls parse with a raw-text fallback; streaming calls require valid JSON after the stream completes. When PDF document context is attached, providers must use the supplied `[[cite:N]]` markers; stored assistant messages may include normalized citation metadata.

Admin LLM management lives under `/admin` and `/admin/models`, with API support in `/api/admin/llm-config` and summary data in `/api/admin/summary`.

### PDF Reader + RAG Flow

The PDF reader lives at `/reader` and uses `components/rag/PdfReader.tsx`.

RAG modules live under `lib/server/rag/`:

- `parser.ts` - extracts selectable text with pdfjs-dist
- `cleaner.ts` - normalizes page text
- `headings.ts` - detects outline/heading sections
- `chunker.ts` - heading-aware recursive chunking
- `embeddings.ts` - DashScope, Gemini, or deterministic mock embeddings
- `indexer.ts` - parse, chunk, embed, persist, and record diagnostics
- `jobs.ts` - Vercel Queue enqueue/callback helpers for parse and index jobs
- `retriever.ts` - vector + keyword scoring with diverse final chunks
- `answer.ts` - grounded answer generation with citations
- `store.ts` - file or Supabase-backed RAG repository

PDF API routes include:

- `GET /api/documents`
- `POST /api/documents/upload` - creates the uploaded document and enqueues indexing
- `POST /api/documents/[documentId]/parse` - enqueues a parse job and returns `202`
- `POST /api/documents/[documentId]/index` - enqueues an index job and returns `202`
- `POST /api/documents/[documentId]/query`
- `GET /api/documents/[documentId]`
- `PATCH /api/documents/[documentId]`
- `DELETE /api/documents/[documentId]`
- `GET /api/documents/[documentId]/file`
- `GET /api/documents/[documentId]/pages/[pageNumber]`
- `GET /api/documents/[documentId]/chunks`
- `POST /api/queues/rag-document-processing`

Indexed PDFs can also be attached from the BranchMind composer. Attached documents retrieve relevant chunks and pass those snippets into the chat prompt as PDF context.

### Key Types (lib/types.ts)

- `MindNode` - A conversation node with messages, tree relationships, canvas position, branch type, collapsed state, and manual title edit state.
- `Project` - Container with an optional owner session id, notes, root node id, and flat `Record<string, MindNode>` map.
- `ChatMessage` - A user or assistant message with content, attachments, and creation timestamp.
- `ChatCitation` - Stored citation metadata rendered from `[[cite:N]]` markers in assistant replies.
- `ChatAttachment` - File or indexed knowledge attachment metadata.
- `ChatDocumentContext` - Retrieved PDF snippets passed to the chat provider.
- `ChatModelSelection` - Explicit provider/model selection from the composer.
- `LlmProviderConfig`, `LlmModelConfig`, `LlmRouteConfig` - Admin-managed LLM routing metadata.
- `BugReportDto` / `AdminBugReportDto` - Public and admin bug report payloads.
- `BranchType` - `"root" | "continue" | "branch"` - determines node layout direction.

### Page Structure

- `/` - Draft workspace first screen. Users start a workspace directly from the canvas/detail composer.
- `/projects` - Project list with search, delete, import/export, and account entry points.
- `/workspace/[projectId]` - Main BranchMind workspace.
- `/reader` - PDF reader and RAG query UI.
- `/auth/sign-in`, `/auth/sign-up`, `/auth/reset-password` - Supabase Auth UI.
- `/auth/forgot-password` - Redirects to sign-in because email recovery is disabled.
- `/auth/callback` - Supabase Auth callback route.
- `/settings/account`, `/settings/appearance`, `/settings/usage`, `/settings/billing` - Account, theme, usage, and billing-plan UI.
- `/admin` - Admin summary dashboard.
- `/admin/models` - Admin LLM provider/model/route management.
- `/admin/bugs` - Admin bug report review queue.
- `/privacy`, `/terms` - Beta policy pages.

### Workspace Components (components/workspace/)

- `WorkspaceShell.tsx` - Loads project state, selects the active project, wires store actions to the workspace shell.
- `WorkspaceCanvasShell.tsx` - Responsive workspace layout with collapsible/resizable outline, map, node detail, and notes panels.
- `HomeDraftWorkspace.tsx` - Draft version of the workspace used on `/` before a real project exists.
- `MindMap.tsx` - React Flow canvas. Converts the `MindNode` map into React Flow nodes/edges and respects collapsed nodes via `getVisibleNodeIds()`.
- `BranchNodeCard.tsx` - Custom React Flow node type with quick Continue/Branch/Fold actions.
- `NodeDetailPanel.tsx` - Shows selected node history, selected-text branching, title editing, message editing/retry, attachments, model selection, and composer controls.
- `WorkspaceSidebar.tsx` - Searchable node outline list.
- `ProjectNotesPanel.tsx` - Autosaved project notes with helper actions for appending the latest AI reply.
- `ProjectNotesEditor.tsx` - Tiptap-backed rich notes editor.

### Account, Settings, And Admin

- `components/AuthPanel.tsx` - Account menu, sign-in/sign-up entry points, usage/billing/settings links, and beta feature callouts.
- `components/settings/SettingsNav.tsx` - Shared settings navigation.
- `components/theme/ThemeProvider.tsx` and `components/theme/ThemeSwitcher.tsx` - Theme cookie/localStorage synchronization and appearance controls. Theme definitions live in `lib/theme.ts`.
- `components/admin/AdminModelsClient.tsx` - Admin UI for LLM providers, models, and route defaults/fallbacks.
- `components/admin/AdminBugReportsClient.tsx` - Admin bug report triage UI.

Account APIs include `/api/account`, `/api/account/usage`, `/api/auth/update-password`, and the existing sign-in/sign-up/logout/session routes. Bug reports are submitted through `/api/bug-reports`; admin review uses `/api/admin/bug-reports`.

### Graph Layout (lib/graph.ts)

Node positions are calculated deterministically: `branch` children offset right (+390px X), `continue` children offset down (+290px Y). Siblings in the same direction stack with +92px gap. Position is stored on each node and updated on drag.

### Database

Supabase migrations live in `supabase/migrations`.

Project storage migrations:

- `20260504000000_branchmind_foundation.sql`
- `20260508000000_branchmind_project_notes.sql`
- `20260514000000_branchmind_message_attachments.sql`
- `20260519010000_branchmind_node_manual_titles.sql`
- `20260521000000_branchmind_user_plans.sql`
- `20260522000000_branchmind_admin_llm_bug_reports.sql`
- `20260524010000_branchmind_message_citations.sql`
- `20260524020000_branchmind_gemini_llm_provider.sql`

PDF/RAG migrations:

- `20260514010000_pdf_rag_foundation.sql`
- `20260516010000_pdf_rag_diagnostics.sql`
- `20260524000000_pdf_rag_queued_status.sql`

Run all migrations before using Supabase-backed storage in production. The later migrations add user plans/usage tables, admin LLM routing tables, bug report storage and the `branchmind-bug-attachments` bucket, queued PDF statuses, message citations, and Gemini LLM seed data.

### Dev Tools

`ElementInspectorPlugin` (dev-only, activated via `Ctrl+I`) provides a DOM element inspector that copies CSS selectors to clipboard. It loads the vendored helper `public/useElementInspector.js` (from `torres953190868/element-inspector-helper`), which is gitignored, so a fresh clone needs to re-download it before the inspector works in dev. Note: the trigger uses `Ctrl` rather than `Alt`, because on macOS `Option + <letter>` yields a dead key so `event.key` is never the base letter.

## Conventions

- Path alias: `@/*` maps to the project root.
- Prefer server API routes and repository helpers over direct client-side persistence.
- Keep optimistic client updates in sync with the server response shape.
- Use `jsonWithSession()` / `safeErrorWithSession()` for API responses that need session cookies.
- Validate request bodies with Zod schemas and `parseJsonBody()`.
- Use `assertValidRequestOrigin()` on mutating routes.
- Use `checkRateLimitAsync()` for AI, project, sync, and expensive mutation routes.
- Node IDs and other IDs use `createId(prefix)` with `crypto.randomUUID()` fallback.
- The AI response contract is JSON with `title`, `summary`, and `content`.
- RAG answers must use retrieved context only and include page citations.
- UI style is soft, pastel, rounded, and canvas-oriented, but newer workspace panels are denser and more app-like than the original landing page concept.
