-- T13: make draft persistence idempotent across a runner crash between the
-- version insert and the agent-run checkpoint.
alter table public.curriculum_versions
  add column if not exists agent_run_id text references public.agent_runs(id) on delete set null;

create unique index if not exists curriculum_versions_curriculum_agent_run_unique_idx
  on public.curriculum_versions(curriculum_id, agent_run_id)
  where agent_run_id is not null;
