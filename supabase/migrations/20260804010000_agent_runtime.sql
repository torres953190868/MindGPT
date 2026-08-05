-- Agent runtime foundation for the dual-agent learning system
-- (spec §7.12 agent_runs, §7.13 agent_steps, §7.17 agent_run_events, and the
-- §11.5 API idempotency mechanism).
--
-- Lifecycle notes:
-- - A run is created as 'queued' with started_at set (it has entered the
--   system); terminal runs must carry finished_at.
-- - agent_runs.idempotency_key is globally unique so a client retry can never
--   create a duplicate run (spec §11.5); the service maps a unique violation
--   to "return the existing run".
-- - At most one non-terminal run per curriculum is enforced by the partial
--   unique index below (database backstop; the service checks first). Runs
--   without a curriculum (tutor runs, ad-hoc runs) are unconstrained.
-- - agent_steps / agent_run_events cascade with their run; agent_runs
--   references to curricula / curriculum_versions restrict deletion, matching
--   the never-physically-delete rule of the curriculum domain (spec §7.1).
-- - Stream events must be persisted to agent_run_events BEFORE they are
--   pushed to clients (spec §7.17); GET /events?after=seq reads this table.

create table if not exists public.agent_runs (
  id text primary key,
  agent_type text not null,
  user_id text not null,
  project_id text,
  curriculum_id text references public.curricula(id) on delete restrict,
  curriculum_version_id text references public.curriculum_versions(id) on delete restrict,
  enrollment_id text,
  idempotency_key text not null,
  status text not null default 'queued',
  current_stage text,
  resume_from_stage text,
  model_provider text,
  model_id text,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  budget_json jsonb not null default '{}'::jsonb,
  usage_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_runs_agent_type_check check (agent_type in ('curriculum_builder', 'tutor')),
  constraint agent_runs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  constraint agent_runs_user_id_not_blank check (length(btrim(user_id)) > 0),
  constraint agent_runs_idempotency_key_not_blank check (length(btrim(idempotency_key)) > 0),
  constraint agent_runs_idempotency_key_unique unique (idempotency_key),
  constraint agent_runs_finished_at_required check (
    status not in ('succeeded', 'failed', 'cancelled') or finished_at is not null
  )
);

create table if not exists public.agent_steps (
  id text primary key,
  run_id text not null references public.agent_runs(id) on delete cascade,
  step_number integer not null,
  stage text not null,
  step_type text not null,
  tool_name text,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  status text not null,
  duration_ms integer not null default 0,
  usage_json jsonb,
  error_json jsonb,
  created_at timestamptz not null default now(),
  constraint agent_steps_step_number_positive check (step_number > 0),
  constraint agent_steps_step_type_check check (
    step_type in ('model', 'tool', 'validation', 'persistence')
  ),
  constraint agent_steps_duration_ms_non_negative check (duration_ms >= 0),
  constraint agent_steps_run_step_unique unique (run_id, step_number)
);

create table if not exists public.agent_run_events (
  id text primary key,
  run_id text not null references public.agent_runs(id) on delete cascade,
  seq integer not null,
  event_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint agent_run_events_seq_positive check (seq > 0),
  constraint agent_run_events_run_seq_unique unique (run_id, seq)
);

-- API idempotency (spec §11.5): mutating endpoints accepting an
-- Idempotency-Key header deduplicate on (user_id, endpoint, key) for 24
-- hours; the 24h window is judged by the application layer on created_at.
-- response_json / status_code hold the FIRST deterministic (2xx/4xx)
-- response; 5xx responses are never stored so clients can retry.
create table if not exists public.idempotency_keys (
  id text primary key,
  user_id text not null,
  endpoint text not null,
  key text not null,
  response_json jsonb,
  status_code integer,
  created_at timestamptz not null default now(),
  constraint idempotency_keys_user_id_not_blank check (length(btrim(user_id)) > 0),
  constraint idempotency_keys_endpoint_not_blank check (length(btrim(endpoint)) > 0),
  constraint idempotency_keys_key_not_blank check (length(btrim(key)) > 0),
  constraint idempotency_keys_user_endpoint_key_unique unique (user_id, endpoint, key)
);

-- At most one non-terminal ('queued'/'running') run per curriculum at any
-- time (spec §7.12); the create-run service checks first and this partial
-- unique index is the database-level backstop.
create unique index if not exists agent_runs_one_active_per_curriculum_idx
  on public.agent_runs(curriculum_id)
  where status in ('queued', 'running') and curriculum_id is not null;

create index if not exists agent_runs_user_type_created_idx
  on public.agent_runs(user_id, agent_type, created_at desc);

create index if not exists agent_steps_run_idx
  on public.agent_steps(run_id, step_number);

create index if not exists agent_run_events_run_seq_idx
  on public.agent_run_events(run_id, seq);

-- The dual-agent tasks (spec §13) must be storable in the admin-managed route
-- table so operators can later split research/synthesis/validation/tutor
-- traffic across providers; widen the task check accordingly.
alter table public.branchmind_llm_routes
  drop constraint if exists branchmind_llm_routes_task_check;
alter table public.branchmind_llm_routes
  add constraint branchmind_llm_routes_task_check check (
    task in (
      'node_generation',
      'branch_chat',
      'pdf_qa',
      'curriculum_research',
      'curriculum_synthesis',
      'curriculum_validation',
      'tutor_chat',
      'tutor_assessment'
    )
  );

alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.agent_run_events enable row level security;
alter table public.idempotency_keys enable row level security;

revoke all on public.agent_runs from anon, authenticated;
revoke all on public.agent_steps from anon, authenticated;
revoke all on public.agent_run_events from anon, authenticated;
revoke all on public.idempotency_keys from anon, authenticated;
