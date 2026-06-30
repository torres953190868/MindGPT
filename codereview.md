# Agent Tasklist: Fix Code Review Findings

Date: 2026-06-26
Repository: MindGPT
Scope: Findings from `codex/chat-message-actions` review

## Execution Rules

- Work in small commits or clearly separated file changes.
- Do not refactor unrelated code while fixing these tasks.
- Preserve existing user/worktree changes unless explicitly told otherwise.
- Add or update tests for every behavior-changing fix.
- After each task, run the narrowest relevant tests first. Before final handoff, run the full relevant server/client test set listed below.

## Recommended Final Verification

Run these after all required tasks are complete:

```bash
npm run type-check
npx vitest run tests/server/account-route.test.ts tests/server/llm-router.test.ts tests/server/rag/query-route.test.ts tests/client/auth-store.test.ts
npm test
```

If any command is unavailable or fails for an environment reason, document the exact command, failure, and why it is not caused by the code change.

---

## Required Fixes

### Task 1: Add CSRF Origin Guard To `PATCH /api/account`

Priority: P0 security

Files:

- `app/api/account/route.ts`
- Tests under `tests/server/` as appropriate

Problem:

`PATCH /api/account` writes account data but does not call `assertValidRequestOrigin(request)`. Other mutating routes validate request origin before mutation.

Implementation:

- Import and call `assertValidRequestOrigin(request, { allowMissingOrigin: process.env.NODE_ENV !== "production" })` at the start of the PATCH try block, before parsing or writing data.
- Keep local development behavior consistent with other routes.
- Do not add this guard to `GET /api/account`.

Acceptance Criteria:

- Cross-origin PATCH requests are rejected with 403.
- Same-origin PATCH requests still work.
- Missing-origin PATCH requests are allowed outside production and rejected in production, matching existing mutating route behavior.
- A regression test covers rejected cross-origin PATCH.

Suggested Tests:

```bash
npx vitest run tests/server/account-route.test.ts tests/server/security.test.ts
```

---

### Task 2: Add Rate Limiting To `PATCH /api/account`

Priority: P0 security

Files:

- `app/api/account/route.ts`
- Tests under `tests/server/` as appropriate

Problem:

`PATCH /api/account` performs a Supabase upsert with no `checkRateLimitAsync()` guard.

Implementation:

- Import `checkRateLimitAsync`.
- Add constants near the route, for example:
  - `PATCH_ACCOUNT_LIMIT = 120`
  - `PATCH_ACCOUNT_WINDOW_MS = 60_000`
- After authentication succeeds and before the Supabase upsert, call `checkRateLimitAsync(request, { action: "patch-account", sessionId: user.id, limit: PATCH_ACCOUNT_LIMIT, windowMs: PATCH_ACCOUNT_WINDOW_MS })`.
- If not allowed, return a 429 JSON response with `Retry-After`, using the existing `jsonWithSession` pattern.
- Make sure both display-name and language-preference updates are covered by the same limit.

Acceptance Criteria:

- PATCH requests over the configured limit return 429.
- The response includes `Retry-After`.
- Under-limit PATCH requests still update account data.
- A regression test verifies that the rate limiter is called with the authenticated user id and expected action.

Suggested Tests:

```bash
npx vitest run tests/server/account-route.test.ts tests/server/rate-limit.test.ts
```

---

### Task 3: Return Plan Restriction Error Instead Of Generic 500 When No Allowed LLM Candidate Exists

Priority: P0 product bug

Files:

- `lib/server/llm-router.ts`
- `tests/server/llm-router.test.ts`

Problem:

When a free-plan user's default and fallback route candidates are all filtered out by model access restrictions, `resolveLlmCandidatesFromConfig()` falls through to:

```ts
LLM_ROUTE_NOT_AVAILABLE, status: 500
```

Clients cannot distinguish this from an internal routing/configuration failure.

Implementation:

- When `isAccountPlanModelRestricted(options.accountPlan)` is true and no candidate remains because of plan filtering, throw an exposed `HttpError` with:
  - `code: "PLAN_MODEL_NOT_ALLOWED"`
  - `status: 403`
  - message suitable for UI display, for example `"No AI model for this task is available on the free plan."`
- Keep genuine no-model/no-provider configuration failures as 500 `LLM_ROUTE_NOT_AVAILABLE`.
- Ensure explicit model selection that is not allowed for the plan also uses `PLAN_MODEL_NOT_ALLOWED` and an appropriate non-500 status. Prefer 403 for consistency.
- Add tests for:
  - free-plan route where all configured candidates are disallowed
  - unrestricted/local plan route still falling back normally
  - genuine missing route/config failure still returns `LLM_ROUTE_NOT_AVAILABLE` 500

Acceptance Criteria:

- Free-plan model access denial never returns `LLM_ROUTE_NOT_AVAILABLE` 500.
- The thrown error exposes `PLAN_MODEL_NOT_ALLOWED` and status 403.
- Existing catalog filtering behavior for free users still returns only allowed DeepSeek models.
- Existing fallback behavior for unrestricted users is unchanged.

Suggested Tests:

```bash
npx vitest run tests/server/llm-router.test.ts
```

---

### Task 4: Preserve Plan Restriction Context In PDF RAG Query Errors

Priority: P1 product bug

Files:

- `lib/server/rag/answer.ts`
- `app/api/documents/[documentId]/query/route.ts`
- Tests under `tests/server/rag/`

Problem:

`requestAnswer()` calls `resolveLlmCandidates()` before its provider retry/catch loop. If candidate resolution throws a plan restriction error, the API route catch-all may convert it to a generic `"Request failed."`, especially while the router still emits a 500.

Implementation:

- Ensure plan restriction errors from `resolveLlmCandidates()` are preserved through the RAG query route.
- Preferred approach:
  - Fix Task 3 first so plan restriction errors are exposed 403 `HttpError`s.
  - In `requestAnswer()`, catch `HttpError` from candidate resolution and rethrow a `RagError` preserving `message`, `code`, `status`, `details`, and `expose`.
- Do not swallow provider retry behavior for actual provider request failures.

Acceptance Criteria:

- A free-plan RAG query with no allowed model returns an API error containing:
  - status 403
  - `error.code === "PLAN_MODEL_NOT_ALLOWED"`
  - a non-generic message that can drive an upgrade prompt
- Provider/network retry behavior in RAG remains unchanged.
- Existing successful RAG query tests still pass.

Suggested Tests:

```bash
npx vitest run tests/server/rag/query-route.test.ts tests/server/rag/rag-core.test.ts
```

---

### Task 5: Show Upgrade Link Safely When Account Fetch Fails For Authenticated Users

Priority: P1 product bug

Files:

- `components/AuthPanel.tsx`
- `store/useAuthStore.ts` if needed
- Client tests under `tests/client/` if existing patterns fit

Problem:

When `/api/account` fails, `account` becomes `null`. `AuthPanel` computes:

```ts
const plan = account?.plan ?? null;
const isFreePlan = plan === "free";
```

For authenticated users with failed account fetch, the Upgrade link disappears even though the default server-side plan is free.

Implementation:

- Adjust plan fallback so an authenticated user with unavailable account data does not permanently hide the upgrade path.
- Suggested behavior:
  - If `account` exists, use `account.plan`.
  - If `sessionStatus === "authenticated"` and `accountStatus === "error"`, treat plan as `"free"` for upgrade-link visibility only.
  - If account is still loading, keep the current loading skeleton.
- Avoid falsely showing a free badge while the account request is merely loading.

Acceptance Criteria:

- Authenticated + loaded free account shows Upgrade link.
- Authenticated + account fetch error shows Upgrade link.
- Authenticated + loaded pro/max account does not show Upgrade link.
- Loading state still shows the skeleton instead of a misleading badge.

Suggested Tests:

```bash
npx vitest run tests/client/auth-store.test.ts
```

If there is no suitable component test harness, document manual verification steps and add the smallest feasible unit test around the plan fallback logic.

---

## Recommended Fixes

### Task 6: Revisit PDF Cache Duration

Priority: P2 behavior risk

Files:

- `app/api/documents/[documentId]/file/route.ts`
- Related PDF/RAG file route tests

Problem:

PDF file responses changed from `private, max-age=300` to `private, max-age=3600`. Updated or deleted PDFs can remain cached for up to one hour in browser tabs.

Implementation Options:

- Preferred: use revalidation-friendly caching, for example `private, max-age=300, stale-while-revalidate=3600`.
- Alternative: restore `private, max-age=300`.
- If keeping one-hour cache, add ETag or Last-Modified support and document the product rationale.

Acceptance Criteria:

- The chosen cache policy is explicit and covered by a route test.
- Updated/deleted document behavior is not worse than the previous five-minute cache unless explicitly documented.
- Range requests and redirects still include the same cache policy.

Suggested Tests:

```bash
npx vitest run tests/server/rag/file-route.test.ts
```

---

### Task 7: Restore Mobile Viewport Safety Cap In `NodeDetailPanel`

Priority: P2 UI regression risk

Files:

- `components/workspace/NodeDetailPanel.tsx`
- UI/screenshot tests if available

Problem:

Mobile `max-h-[calc(100svh-1rem)]` / `sm:max-h-[calc(100svh-2rem)]` constraints were replaced by `max-h-full`. The panel now relies on its parent chain for viewport containment.

Implementation:

- Restore a self-contained mobile viewport cap on both empty and populated panel states.
- Keep the current desktop `lg:max-h-[calc(100dvh-6rem)]`.
- Confirm composer, header, and scrollable body still fit without overflow on mobile.

Acceptance Criteria:

- Empty and populated `NodeDetailPanel` both include a mobile viewport max-height guard.
- The panel does not overflow a mobile viewport in normal workspace layout.
- Existing desktop layout remains unchanged.

Suggested Verification:

```bash
npm run type-check
```

If browser tooling is available, verify the workspace at a mobile viewport such as 390x844.

---

## Hardening / Follow-Up Tasks

These are not required to resolve the most urgent regressions, but should be considered before the feature is considered production-hardened.

### Task 8: Normalize `null` And `undefined` Plan Semantics

Priority: P3 latent bug

Files:

- `lib/server/account-plan.ts`
- `tests/server/llm-router.test.ts` or a new account-plan test

Problem:

`isAccountPlanModelRestricted()` treats `null` as restricted/free but `undefined` as unrestricted:

```ts
return plan !== undefined && normalizeAccountPlan(plan) === "free";
```

Implementation:

- Decide and document the intended meaning:
  - Recommended: `undefined` and `null` both mean "no plan context; do not apply free-plan restriction".
  - Concrete plan strings, including unknown strings normalized to `"free"`, should still apply restrictions.
- Implement with `plan != null && normalizeAccountPlan(plan) === "free"` if following the recommended behavior.

Acceptance Criteria:

- `undefined` and `null` have identical tested behavior.
- `"free"` remains restricted.
- `"pro"` and `"max"` remain unrestricted.
- Unknown non-empty plan values still normalize to the default plan according to existing product policy.

Suggested Tests:

```bash
npx vitest run tests/server/llm-router.test.ts
```

---

### Task 9: Make Account Plan Lookup Fallback Visible To Operators

Priority: P3 deployment hardening

Files:

- `lib/server/account-plan.ts`
- Optional admin/health surface if one exists

Problem:

If `branchmind_user_plans` lookup fails, the code logs an error and falls back to the default free plan. Users can be restricted without a clear product/admin indication that a migration or database query failed.

Implementation:

- Keep the existing safe fallback if that is the desired production behavior.
- Add clearer operator visibility:
  - Include user id and table/context in the log metadata without leaking sensitive data.
  - Consider a typed warning result or health check for missing `branchmind_user_plans` / `branchmind_plan_limits` tables.
- Do not expose raw database errors to end users.

Acceptance Criteria:

- Plan lookup failures are visible in server logs with actionable context.
- End-user responses remain safe.
- If a health/admin check is added, it reports missing plan tables clearly.

Suggested Tests:

```bash
npx vitest run tests/server/account-migration.test.ts tests/server/supabase-migration.test.ts
```

---

### Task 10: Move Free-Plan Model Allowlist Out Of Hardcoded Application Code

Priority: P3 architecture

Files:

- `lib/server/account-plan.ts`
- Supabase migration under `supabase/migrations/`
- `lib/supabase/database.types.ts` if database types are maintained manually or generated
- LLM router tests

Problem:

Free-plan model access is hardcoded:

```ts
const FREE_PLAN_DEEPSEEK_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
```

Plan limits are database-driven, but model access is code-driven.

Implementation:

- Introduce database-backed plan model access, for example a `branchmind_plan_model_access` table with:
  - `plan`
  - `provider_id`
  - `model`
  - timestamps if consistent with local schema conventions
- Seed current free-plan access to DeepSeek `deepseek-v4-flash` and `deepseek-v4-pro`.
- Update `isModelAllowedForAccountPlan()` or the calling flow to use DB-backed access where available.
- Preserve a safe static fallback for local/dev mode if needed.
- Ensure catalog filtering and candidate resolution still use one source of truth.

Acceptance Criteria:

- Admins can change free-plan model access through data/migration rather than code changes.
- Existing free-plan behavior is unchanged after migration.
- Tests cover:
  - allowed free DeepSeek models
  - disallowed free non-DeepSeek provider/model
  - unrestricted pro/max behavior
  - fallback behavior when DB access is unavailable, if applicable

Suggested Tests:

```bash
npx vitest run tests/server/llm-router.test.ts tests/server/supabase-migration.test.ts
```

---

## Definition Of Done

The agent may mark this tasklist complete only when:

- Tasks 1 through 5 are implemented and tested, or explicitly documented as intentionally deferred with reason.
- Any code behavior changed by Tasks 6 through 10 has corresponding tests or documented manual verification.
- Final verification commands have been run and results are reported.
- The final response lists:
  - files changed
  - tests run
  - any intentionally deferred tasks
  - any residual risks
