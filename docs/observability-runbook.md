# BranchMind observability and retention runbook

Phase 6 exposes owner-scoped agent traces at `GET /api/agent-runs/:runId/trace`
and owner-scoped aggregates at `GET /api/agent-runs/metrics`. Responses contain
token counts, duration, status/failure counts, model/provider and estimated cost;
prompt, answer, source excerpt and code bodies are hashed or summarized.

Set `BRANCHMIND_LLM_COST_RATES_JSON` to JSON rates keyed by `provider/model`,
model, provider, or `default`, using input/output USD per million tokens. Missing
or invalid rates safely estimate cost as zero.

Search is degradable: Tavily failures are logged as provider/fallback/code and
fall back to the explicitly configured `WEB_SEARCH_FALLBACK_PROVIDER` (default
`disabled`). Prompt-injection signals record only rule, domain, hash and length.

Retention is dry-run by default. Inspect `createRetentionPlan()` and call
`executeRetentionCleanup({ dryRun: false, confirm: true })` only from an
explicitly authorized maintenance job. Default trace retention is 30 days;
source chunks 180 days; assessment artifacts 365 days. Active runs, active
enrollments, enrollment evidence, and source chunks still attached to versions
are protected. File cleanup uses a temporary file plus atomic rename.

Recommended beta alerts: failure rate above 10%, repeated budget exhaustion,
provider fallback spikes, and prompt-injection signal spikes.

