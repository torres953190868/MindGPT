# AGENTS.md — BranchMind

This file is a single source of truth for AI coding agents working in the BranchMind repository. It is current as of the latest project state. For additional context, see `CLAUDE.md` and `README.md`.

---

## Project Overview

**BranchMind** is a visual, branching AI conversation workspace built as a Next.js App Router application. Instead of linear chat, conversations are organized as a tree of nodes on a canvas. Users can:

- **Continue Down** — extend the main thread vertically.
- **Branch Right** — open a sub-topic in a parallel node.

The product also includes a selectable-text PDF reader and a RAG (retrieval-augmented generation) MVP. Users can upload PDFs, extract and index text, ask grounded questions with page citations, and attach indexed PDFs as knowledge context inside BranchMind conversations.

### Core Stack

- **Framework:** Next.js 15 with App Router, React 19, TypeScript 5.
- **Styling:** Tailwind CSS v4 (`@tailwindcss/postcss`), PostCSS, custom CSS themes in `app/globals.css`.
- **Canvas:** `@xyflow/react` (React Flow).
- **State:** Zustand (`store/`).
- **Backend/Auth:** Supabase (`@supabase/ssr`, `@supabase/supabase-js`), with a file-backed fallback for local development.
- **AI Providers:** DeepSeek, OpenCode Go, and Gemini via OpenAI-compatible chat-completions endpoints.
- **Embeddings:** DashScope or Gemini.
- **Queue (production):** Vercel Queues (`@vercel/queue`).
- **Testing:** Vitest for unit/integration tests, Playwright for E2E tests.

### Important Supporting Docs

- `CLAUDE.md` — detailed architecture and conventions.
- `README.md` — local setup, environment variables, PDF reader flow.
- `docs/release-runbook.md` — production release checklist.
- `RAG.md` — original PDF/RAG requirements spec.
- `NeedsDoc.md` — original product requirements spec.

---

## Repository Layout

```text
app/              # Next.js App Router pages and API routes
components/       # React components, grouped by feature
lib/              # Shared business logic and server helpers
  client/         # Browser-side helpers (API client, streaming, pending sync)
  server/         # Server-only modules (auth, projects, AI, RAG, rate limit, validation)
  server/rag/     # PDF/RAG pipeline modules
  supabase/       # Supabase browser/server clients and generated DB types
store/            # Zustand stores
tests/            # Vitest tests (mirrors lib/ structure)
e2e/              # Playwright E2E specs
supabase/migrations/  # SQL migrations
scripts/          # Utility scripts (smoke test, data migration)
data/             # Local file storage (gitignored runtime data)
public/           # Static assets
```

### Key Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Scripts, dependencies, dev dependencies. |
| `next.config.ts` | Next.js config with per-port `distDir` for dev, strict mode, webpack ignore patterns. |
| `tsconfig.json` | Strict TypeScript, `@/*` path alias, includes generated Next.js types. |
| `eslint.config.mjs` | Flat ESLint config extending `next/core-web-vitals` and `next/typescript`. |
| `vitest.config.ts` | Vitest config: Node env, tests in `tests/**/*.test.ts`, `@/` alias. |
| `playwright.config.ts` | E2E config with Chromium + mobile Chrome projects, local web server. |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS plugin. |
| `vercel.json` | Vercel function config for the RAG document-processing queue. |
| `.env.example` | Documented environment variables. |

---

## Build and Test Commands

All commands run from the repository root.

```bash
# Install dependencies
npm install

# Development server (runs on 127.0.0.1:3002)
npm run dev

# Production build
npm run build

# Start production server
npm run start

# Lint with zero warnings allowed
npm run lint

# TypeScript type checking
npm run typecheck

# Unit / integration tests (Vitest)
npm run test

# End-to-end tests (Playwright)
npm run e2e

# Production smoke test
npm run smoke:prod

# Migrate local file-backed data to Supabase
npm run migrate:supabase
```

### Notes on Dev Server

- `npm run dev` hardcodes `PORT=3002`, host `127.0.0.1`.
- `next.config.ts` uses a separate `distDir` per dev port (e.g., `.next-dev-3002`) to avoid build collisions.
- Webpack watch ignores `data/`, `test-results/`, and `playwright-report/`.

---

## Environment and Runtime

Copy `.env.example` to `.env.local` and fill in the providers you intend to use.

### Required for Any Real AI

- `AI_PROVIDER` — `deepseek` (default), `opencode-go`, or `gemini`.
- Matching provider API key: `DEEPSEEK_API_KEY`, `OPENCODE_GO_API_KEY`, or `GEMINI_API_KEY`.
- Matching provider model env: `DEEPSEEK_MODEL`, `OPENCODE_GO_MODEL`, `GEMINI_MODEL`.

### Required for Supabase-Backed Production

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ORIGIN` or `ALLOWED_ORIGINS` / `TRUSTED_ORIGINS`

### Storage Backends

| Variable | Values | Behavior |
|----------|--------|----------|
| `BRANCHMIND_PROJECTS_BACKEND` | `auto` (default), `file`, `supabase` | `auto` uses Supabase when configured, otherwise file outside production. |
| `BRANCHMIND_RAG_BACKEND` | `auto` (default), `file`, `supabase` | Same fallback rule. |
| `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION` | `true` | Only for smoke tests; never enable in real production. |

### RAG / PDF Variables

- `BRANCHMIND_RAG_QUEUE_MODE` — `inline` (dev default) or `queue` (production default). Forces Vercel Queues behavior.
- `MAX_PDF_SIZE_MB` — default `50`.
- `EMBEDDING_PROVIDER` — `dashscope` (default) or `gemini`.
- `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` — defaults to DashScope `text-embedding-v4`, `1024`.
- `DASHSCOPE_API_KEY` / `GEMINI_API_KEY` — for embeddings.
- `LLM_PROVIDER` / `LLM_MODEL` — for RAG answer generation; defaults to `AI_PROVIDER`.

### Mock / Test Mode

- `AI_MOCK_MODE=true` — deterministic AI replies for local development, CI, and E2E. Do not use in production.
- Playwright defaults to `AI_MOCK_MODE=true`, file backends, and a local dev web server on port `12741` unless `PLAYWRIGHT_BASE_URL` or `PLAYWRIGHT_WEB_SERVER_COMMAND` is set.

---

## Architecture

### Frontend

- `store/useBranchMindStore.ts` is the client workspace coordinator. It holds hydrated project state, selection, pending sync, optimistic node drafts, streaming status, and UI errors.
- `app/page.tsx` renders a draft workspace before a real project exists (noindex) and forwards `?code` params to `/auth/callback` for Supabase OAuth. `app/new/page.tsx` redirects to `/`. `app/help/page.tsx` is the bilingual (zh/en) help & support page (feature overview, FAQ, contact) with JSON-LD structured data.
- `app/workspace/[projectId]/page.tsx` is the main workspace.
- Components live under `components/workspace/` and include the React Flow canvas (`MindMap.tsx`), node cards (`BranchNodeCard.tsx`), detail panel (`NodeDetailPanel.tsx`), sidebar (`WorkspaceSidebar.tsx`), and notes editor (`ProjectNotesPanel.tsx`, `ProjectNotesEditor.tsx`).
- `components/rag/PdfReader.tsx` is the PDF reader + RAG query UI at `/reader`.
- `components/theme/` and `components/language/` handle theme and language preferences via cookies + localStorage.

### Backend / API Routes

All persistence goes through API routes under `app/api/`:

- `/api/projects` — create/list projects.
- `/api/projects/[projectId]` — read/update/delete a project.
- `/api/projects/[projectId]/sync` — client-server project sync.
- `/api/projects/[projectId]/nodes/stream` — streaming AI node generation.
- `/api/projects/import` — import legacy/local projects.
- `/api/chat` and `/api/chat/models` — chat completions and model catalog.
- `/api/auth/*` — sign-in, sign-up, logout, session, password, Google OAuth.
- `/api/account*` — account and usage; `/api/account` supports DELETE for account deletion.
- `/api/admin/*` — admin summary, LLM config, bug reports.
- `/api/bug-reports` — public bug report submission.
- `/api/documents/*` and `/api/queues/rag-document-processing` — PDF/RAG lifecycle.
- `/api/health` — health check for uptime probes.

### Server Abstractions

- `lib/server/projects-repository.ts` — persistence abstraction for `auto`/`file`/`supabase` backends.
- `lib/server/auth.ts` — resolves `BranchMindAuthContext` (Supabase user or local HTTP-only session cookie).
- `lib/server/admin-auth.ts` — admin access via `BRANCHMIND_ADMIN_EMAILS` or local dev bypass.
- `lib/server/llm-router.ts` — routes chat tasks to providers, supports Supabase-managed LLM config or static env config.
- `lib/server/rate-limit.ts` — rate limiting with Supabase-backed or in-memory storage.
- `lib/server/security.ts` — request origin validation.
- `lib/server/validation.ts` — Zod-based JSON body parsing.
- `lib/server/http.ts` — `jsonWithSession`, `errorWithSession`, `safeErrorWithSession`, request IDs, error logging.
- `lib/server/request.ts` — request ID creation/header helpers.
- `lib/ids.ts` — `createId(prefix)` using `crypto.randomUUID()` fallback.

### AI Flow

- Static defaults live in `lib/server/ai-provider.ts`.
- Runtime routing is handled by `lib/server/llm-router.ts`.
- Streaming is implemented in `lib/server/deepseek-streaming.ts` but is provider-agnostic OpenAI-compatible streaming.
- SSE events emitted: `delta`, `complete`, `error`.
- The AI is asked to return JSON with `title`, `summary`, and `content`.

### RAG Flow

Server modules under `lib/server/rag/`:

- `parser.ts` — extract selectable text with `pdfjs-dist`.
- `cleaner.ts` — normalize page text.
- `headings.ts` — detect outline/heading sections.
- `chunker.ts` — heading-aware recursive chunking.
- `embeddings.ts` — DashScope, Gemini, or deterministic mock embeddings.
- `indexer.ts` — parse, chunk, embed, persist, and record diagnostics.
- `jobs.ts` — Vercel Queue enqueue/callback helpers.
- `retriever.ts` — vector + keyword scoring with diverse final chunks.
- `answer.ts` — grounded answer generation with citations.
- `store.ts` — file or Supabase-backed RAG repository.

---

## Code Style Guidelines

### TypeScript

- Strict mode is enabled. Do not loosen `tsconfig.json` settings.
- Path alias `@/*` maps to the project root. Prefer `import ... from "@/lib/..."` over relative paths.
- Use explicit types for exported functions and complex objects.
- IDs are created with `createId(prefix)` (e.g., `createId("project")`).

### API Route Conventions

1. Parse and validate request bodies with Zod via `parseJsonBody()` in `lib/server/validation.ts`.
2. Call `assertValidRequestOrigin()` on mutating routes.
3. Apply `checkRateLimitAsync()` for AI, project, sync, and expensive mutations.
4. Resolve auth with `getBranchMindAuthContext()`.
5. Return JSON with `jsonWithSession()` / errors with `safeErrorWithSession()` so session cookies are committed and request IDs are attached.
6. Include `x-request-id` in responses.

### React / Components

- Functional components with explicit prop types.
- Use `data-testid` attributes for testable elements.
- UI styling follows the project's soft, pastel, rounded visual language. Three built-in themes exist: `mineral`, `classic-purple`, and `warm-limestone` (default).
- Theme CSS variables and overrides are in `app/globals.css`.

### General

- Prefer server API routes and repository helpers over direct client-side persistence.
- Keep optimistic client updates in sync with the server response shape.
- Do not add speculative abstractions. Match the surrounding code's naming and comment density.
- Avoid new heavy dependencies; confirm a package is already in `package.json` before using it.

---

## Testing Instructions

### Vitest

- Tests live in `tests/`.
- `npm run test` runs all `tests/**/*.test.ts` in a Node environment.
- Tests include client store tests, server route tests, RAG pipeline tests, auth/security tests, and provider-specific tests.
- A synthetic PDF fixture helper exists at `tests/server/rag/pdf-fixtures.ts`.

### Playwright E2E

- Specs are in `e2e/`.
- Default web server runs `next dev` on `127.0.0.1:12741` with mock AI and file backends.
- Two projects: `chromium` and `mobile-chrome` (Pixel 5).
- In CI, retries are 2; locally, 0.
- Run `npx playwright install chromium` once if browsers are missing.

### Pre-Release Verification

The release runbook (`docs/release-runbook.md`) requires:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run smoke:prod
npm run e2e
```

---

## Security Considerations

- **Origin validation:** Mutating routes must call `assertValidRequestOrigin()`. Production requires `APP_ORIGIN` or `ALLOWED_ORIGINS`/`TRUSTED_ORIGINS` to be configured.
- **Rate limiting:** Implemented in `lib/server/rate-limit.ts`. Uses Supabase when available; falls back to an in-memory map. Rate-limit keys include session ID, action, and a client fingerprint.
- **Authentication:**
  - Supabase Auth is required in production.
  - BranchMind creates account-name/password users server-side with `SUPABASE_SERVICE_ROLE_KEY`, mapping them to internal emails under `users.branchmind.invalid`.
  - Public email sign-up, magic-link sign-in, and email password recovery are disabled.
  - Existing Supabase email users can sign in by typing their email as the account name.
  - Without Supabase, a local HTTP-only session cookie is used.
- **Session cookie:** `branchmind_session` is `httpOnly`, `sameSite: "lax"`, and `secure` in production.
- **Admin access:** `/admin*` pages and API routes require either a Supabase Auth email in `BRANCHMIND_ADMIN_EMAILS` or `BRANCHMIND_ENABLE_LOCAL_ADMIN=true` in non-production environments.
- **File storage:** File-backed project/RAG storage is blocked in production unless `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION=true` is set (intended only for smoke tests).
- **Security headers:** CSP, HSTS, `X-Content-Type-Options: nosniff`, Referrer-Policy, X-Frame-Options, and Permissions-Policy are configured in the `headers()` function in `next.config.ts`.
- **Secrets:** Do not commit API keys or `SUPABASE_SERVICE_ROLE_KEY`. These are read from `.env.local` only.
- **Request IDs:** Every API response carries an `x-request-id`. Errors log server-side for 5xx responses.
- **PDF uploads:** Size limited by `MAX_PDF_SIZE_MB`. Only selectable-text PDFs are supported; scanned PDFs are rejected with a clear message.

---

## Database

Supabase migrations are in `supabase/migrations/` and must be applied before using Supabase-backed storage. Key migration groups:

**Project storage**

- `20260504000000_branchmind_foundation.sql`
- `20260508000000_branchmind_project_notes.sql`
- `20260514000000_branchmind_message_attachments.sql`
- `20260519010000_branchmind_node_manual_titles.sql`
- `20260521000000_branchmind_user_plans.sql`
- `20260522000000_branchmind_admin_llm_bug_reports.sql`
- `20260524010000_branchmind_message_citations.sql`
- `20260524020000_branchmind_gemini_llm_provider.sql`
- `20260526000000_branchmind_free_plan_model_access.sql`
- `20260526010000_branchmind_rename_team_plan_to_max.sql`
- `20260526020000_branchmind_language_preference.sql`
- `20260630000000_branchmind_plan_model_access.sql`

**PDF/RAG**

- `20260514010000_pdf_rag_foundation.sql`
- `20260516010000_pdf_rag_diagnostics.sql`
- `20260524000000_pdf_rag_queued_status.sql`
- `20260711000000_pdf_rag_document_content_hash.sql`

Tables include `branchmind_projects`, `branchmind_nodes`, `branchmind_messages`, user/usage/plan tables, admin LLM routing tables, bug reports, plus RAG tables (`documents`, `document_pages`, `document_sections`, `document_chunks`) with `pgvector` `vector(1024)` storage.

---

## Deployment

- The app is configured for **Vercel** (`vercel.json`, `.vercel/`).
- The queue function `app/api/queues/rag-document-processing/route.ts` has `maxDuration: 300` and a Vercel Queue v2beta trigger.
- Production requires Supabase configuration and a configured AI provider.
- See `docs/release-runbook.md` for the full release checklist, backup/rollback steps, and monitoring metrics.

---

## Dev-Only Tools

- `ElementInspectorPlugin` (triggered with `Ctrl+I`) provides a DOM element inspector for development. It loads `public/useElementInspector.js`, which is gitignored and must be re-downloaded on a fresh clone.

---

## Quick Reference for Agents

- **Start working:** `npm install && npm run dev`
- **Run all checks:** `npm run lint && npm run typecheck && npm run test && npm run build`
- **Run E2E:** `npm run e2e` (requires Playwright browsers)
- **Add a backend API route:** validate body, assert origin, rate-limit, resolve auth, use repository helpers, return via `jsonWithSession`/`safeErrorWithSession`.
- **Add a client feature:** update the relevant Zustand store, call API routes, keep optimistic state in sync with server shape.
- **Add RAG logic:** keep modules isolated under `lib/server/rag/` (parser, cleaner, headings, chunker, embeddings, indexer, retriever, answer, store) and add tests under `tests/server/rag/`.
- **Database changes:** add a new migration in `supabase/migrations/` with a UTC-ish timestamp prefix; update `lib/supabase/database.types.ts` if needed.
