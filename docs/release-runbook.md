# BranchMind Public Beta Release Runbook

## Required Environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER` (`deepseek` or `gemini`)
- Provider-specific API key/model:
  - `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` when `AI_PROVIDER=deepseek`
  - `GEMINI_API_KEY`, `GEMINI_MODEL` when `AI_PROVIDER=gemini`
- `APP_ORIGIN` or `ALLOWED_ORIGINS`

Use `AI_MOCK_MODE=true` only for local smoke, CI, and E2E. Production must use Supabase-backed storage; file storage is only allowed for CI smoke with `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION=true`.

## Production Environment Must Confirm

- Forbidden in production: `AI_MOCK_MODE=true`, `BRANCHMIND_ENABLE_LOCAL_ADMIN=true`, and `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION=true` must not be set.
- All migrations in `supabase/migrations` must be applied, including `20260711000000_pdf_rag_document_content_hash.sql`.
- Required configuration: `SUPABASE_SERVICE_ROLE_KEY`, `BRANCHMIND_ADMIN_EMAILS`, and `APP_ORIGIN` (or `ALLOWED_ORIGINS`).
- Vercel Queues v2beta must be enabled for the project, and production must explicitly set `BRANCHMIND_RAG_QUEUE_MODE=queue`.
- Error monitoring: set `NEXT_PUBLIC_SENTRY_DSN` (and optionally `SENTRY_DSN`) for the Production environment in Vercel before building, plus `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` for readable stack traces (source map upload). Sentry is inert without a DSN. Configure Sentry alert rules (new issue, error-rate spike) and, if desired, Vercel Log Drains separately.

## Release Checklist

1. Run Supabase migrations from `supabase/migrations`.
2. Confirm Row Level Security policies are enabled.
3. Run `npm ci`.
4. Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run smoke:prod`.
5. Run `npx playwright install chromium` once on the release runner, then `npm run e2e`.
6. Verify dashboard alerts for 5xx, 429, AI provider failures, and database write failures.
7. If Sentry is enabled, confirm a test error appears in Sentry with the correct `environment` and a `request_id` tag (search by the `x-request-id` from a failed response).

## Backup And Rollback

- Before deployment, export or snapshot the Supabase database.
- Keep the previous deploy artifact or Git tag available.
- Rollback target: restore previous deploy within 15 minutes.
- After rollback, run `npm run smoke:prod` against the restored deployment URL.

## Monitoring

Track these metrics during beta:

- project creation success rate
- node creation success rate
- AI provider latency and error rate
- API 4xx/5xx rate
- rate limit hits
- import/export failures
- Supabase write failures
