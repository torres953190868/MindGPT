-- Phase 4 learning foundation (spec §7.8–§7.10 and §7.16).
--
-- This migration intentionally does not create learning_assessments or add
-- assessment/rubric rules. Those belong to Phase 5. All writes are server
-- mediated; direct anon/authenticated table access is revoked.

create table if not exists public.learning_enrollments (
  id text primary key,
  user_id text not null,
  curriculum_id text not null references public.curricula(id) on delete restrict,
  curriculum_version_id text not null references public.curriculum_versions(id) on delete restrict,
  status text not null default 'active',
  current_node_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_enrollments_user_id_not_blank check (length(btrim(user_id)) > 0),
  constraint learning_enrollments_status_check check (status in ('active', 'completed', 'paused')),
  constraint learning_enrollments_user_version_unique unique (user_id, curriculum_version_id)
);

create table if not exists public.learning_node_progress (
  id text primary key,
  enrollment_id text not null references public.learning_enrollments(id) on delete cascade,
  node_id text not null references public.curriculum_nodes(id) on delete restrict,
  status text not null default 'locked',
  mastery_score double precision not null default 0,
  attempt_count integer not null default 0,
  last_evidence_json jsonb,
  last_assessed_at timestamptz,
  next_review_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint learning_node_progress_status_check check (
    status in ('locked', 'available', 'in_progress', 'needs_review', 'completed')
  ),
  constraint learning_node_progress_mastery_range check (mastery_score >= 0 and mastery_score <= 1),
  constraint learning_node_progress_attempt_count_non_negative check (attempt_count >= 0),
  constraint learning_node_progress_enrollment_node_unique unique (enrollment_id, node_id)
);

create table if not exists public.learning_sessions (
  id text primary key,
  enrollment_id text not null references public.learning_enrollments(id) on delete cascade,
  node_id text references public.curriculum_nodes(id) on delete restrict,
  skill_id text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary text not null default '',
  created_at timestamptz not null default now(),
  constraint learning_sessions_status_check check (status in ('active', 'ended', 'abandoned'))
);

create table if not exists public.learning_messages (
  id text primary key,
  session_id text not null references public.learning_sessions(id) on delete cascade,
  enrollment_id text not null references public.learning_enrollments(id) on delete cascade,
  role text not null,
  blocks_json jsonb not null default '[]'::jsonb,
  agent_run_id text references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint learning_messages_role_check check (role in ('user', 'assistant', 'system_event'))
);

create index if not exists learning_enrollments_user_updated_idx
  on public.learning_enrollments(user_id, updated_at desc);
create index if not exists learning_progress_enrollment_idx
  on public.learning_node_progress(enrollment_id, updated_at desc);
create index if not exists learning_sessions_enrollment_created_idx
  on public.learning_sessions(enrollment_id, created_at desc);
create index if not exists learning_messages_enrollment_created_idx
  on public.learning_messages(enrollment_id, created_at);
create index if not exists learning_messages_session_created_idx
  on public.learning_messages(session_id, created_at);

create or replace function public.assert_learning_enrollment_version()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  version_curriculum text;
begin
  select curriculum_id into version_curriculum
    from public.curriculum_versions where id = new.curriculum_version_id;
  if version_curriculum is null or version_curriculum <> new.curriculum_id then
    raise exception 'learning enrollment curriculum does not match curriculum version';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_enrollment_version_guard on public.learning_enrollments;
create trigger learning_enrollment_version_guard
before insert or update on public.learning_enrollments
for each row execute function public.assert_learning_enrollment_version();

-- The application also checks these relationships before every write. These
-- triggers make the version boundary a database invariant for direct server
-- SQL as well: a progress/session node must belong to the enrolled version,
-- and a message must belong to the session's enrollment.
create or replace function public.assert_learning_node_version()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  enrollment_version text;
  node_version text;
begin
  select curriculum_version_id into enrollment_version
    from public.learning_enrollments where id = new.enrollment_id;
  select curriculum_version_id into node_version
    from public.curriculum_nodes where id = new.node_id;
  if enrollment_version is null or node_version is null or enrollment_version <> node_version then
    raise exception 'learning node does not belong to the enrolled curriculum version';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_node_progress_version_guard on public.learning_node_progress;
create trigger learning_node_progress_version_guard
before insert or update on public.learning_node_progress
for each row execute function public.assert_learning_node_version();

drop trigger if exists learning_session_node_version_guard on public.learning_sessions;
create trigger learning_session_node_version_guard
before insert or update on public.learning_sessions
for each row when (new.node_id is not null)
execute function public.assert_learning_node_version();

create or replace function public.assert_learning_message_session_scope()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  session_enrollment text;
begin
  select enrollment_id into session_enrollment from public.learning_sessions where id = new.session_id;
  if session_enrollment is null or session_enrollment <> new.enrollment_id then
    raise exception 'learning message session does not belong to enrollment';
  end if;
  return new;
end;
$$;

drop trigger if exists learning_message_session_scope_guard on public.learning_messages;
create trigger learning_message_session_scope_guard
before insert or update on public.learning_messages
for each row execute function public.assert_learning_message_session_scope();

alter table public.learning_enrollments enable row level security;
alter table public.learning_node_progress enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.learning_messages enable row level security;

revoke all on public.learning_enrollments from anon, authenticated;
revoke all on public.learning_node_progress from anon, authenticated;
revoke all on public.learning_sessions from anon, authenticated;
revoke all on public.learning_messages from anon, authenticated;
revoke all on function public.assert_learning_node_version() from anon, authenticated;
revoke all on function public.assert_learning_message_session_scope() from anon, authenticated;
revoke all on function public.assert_learning_enrollment_version() from anon, authenticated;
