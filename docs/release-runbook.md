# BranchMind Public Beta Release Runbook

## Required Environment

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER` (`deepseek` or `opencode-go`)
- Provider-specific API key/model:
  - `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` when `AI_PROVIDER=deepseek`
  - `OPENCODE_GO_API_KEY`, `OPENCODE_GO_MODEL` when `AI_PROVIDER=opencode-go`
- `APP_ORIGIN` or `ALLOWED_ORIGINS`

Use `AI_MOCK_MODE=true` only for local smoke, CI, and E2E. Production must use Supabase-backed storage; file storage is only allowed for CI smoke with `BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION=true`.

## Release Checklist

1. Run Supabase migrations from `supabase/migrations`.
2. Confirm Row Level Security policies are enabled.
3. Run `npm ci`.
4. Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run smoke:prod`.
5. Run `npx playwright install chromium` once on the release runner, then `npm run e2e`.
6. Verify dashboard alerts for 5xx, 429, AI provider failures, and database write failures.

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
