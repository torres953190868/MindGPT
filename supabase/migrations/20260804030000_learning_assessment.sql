-- Phase 5: server-scored learning assessments.
-- curriculum_exercises was introduced with the curriculum foundation. The
-- guarded create below keeps this migration safe for installations that apply
-- Phase 5 independently while preserving its existing shape.

create table if not exists public.curriculum_exercises (
  id text primary key,
  curriculum_version_id text not null references public.curriculum_versions(id) on delete cascade,
  node_id text not null references public.curriculum_nodes(id) on delete cascade,
  exercise_type text not null,
  prompt_json jsonb not null default '{}'::jsonb,
  rubric_json jsonb not null default '{}'::jsonb,
  answer_json jsonb,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  constraint curriculum_exercises_phase5_type_check check (
    exercise_type in ('quiz', 'open', 'code', 'project')
  )
);

create table if not exists public.learning_assessments (
  id text primary key,
  session_id text not null references public.learning_sessions(id) on delete cascade,
  enrollment_id text not null references public.learning_enrollments(id) on delete cascade,
  node_id text not null references public.curriculum_nodes(id) on delete cascade,
  exercise_id text references public.curriculum_exercises(id) on delete set null,
  assessment_type text not null,
  prompt_json jsonb not null default '{}'::jsonb,
  answer_json jsonb not null default '{}'::jsonb,
  rubric_json jsonb not null default '{}'::jsonb,
  score double precision not null,
  evidence_json jsonb not null default '{}'::jsonb,
  answer_hash text not null,
  agent_run_id text references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint learning_assessments_type_check check (
    assessment_type in ('quiz', 'open', 'code', 'project', 'exercise', 'explanation')
  ),
  constraint learning_assessments_score_range check (score >= 0 and score <= 1),
  constraint learning_assessments_answer_hash_not_blank check (length(btrim(answer_hash)) > 0)
);

-- PostgreSQL treats NULLs as distinct in a normal unique constraint. The
-- expression makes generated, exercise-less assessments idempotent as well.
create unique index if not exists learning_assessments_dedup_idx
  on public.learning_assessments(
    enrollment_id,
    node_id,
    coalesce(exercise_id, ''),
    answer_hash
  );

create index if not exists curriculum_exercises_node_order_idx
  on public.curriculum_exercises(curriculum_version_id, node_id, order_index);
create index if not exists learning_assessments_enrollment_node_created_idx
  on public.learning_assessments(enrollment_id, node_id, created_at desc);

-- Keep the relational version boundary authoritative. This prevents an
-- assessment from smuggling a node, session, or exercise from another
-- curriculum version even when the caller uses the service role.
create or replace function public.guard_learning_assessment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enrollment_version text;
  session_enrollment text;
  node_version text;
  exercise_version text;
  exercise_node text;
begin
  select curriculum_version_id into enrollment_version
  from public.learning_enrollments
  where id = new.enrollment_id;

  if enrollment_version is null then
    raise exception 'assessment enrollment % not found', new.enrollment_id;
  end if;

  select enrollment_id into session_enrollment
  from public.learning_sessions
  where id = new.session_id;
  if session_enrollment is distinct from new.enrollment_id then
    raise exception 'assessment session does not belong to enrollment';
  end if;

  select curriculum_version_id into node_version
  from public.curriculum_nodes
  where id = new.node_id;
  if node_version is distinct from enrollment_version then
    raise exception 'assessment node does not belong to enrollment version';
  end if;

  if new.exercise_id is not null then
    select curriculum_version_id, node_id
    into exercise_version, exercise_node
    from public.curriculum_exercises
    where id = new.exercise_id;
    if exercise_version is distinct from enrollment_version or exercise_node is distinct from new.node_id then
      raise exception 'assessment exercise does not belong to enrollment node';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists learning_assessment_scope_guard on public.learning_assessments;
create trigger learning_assessment_scope_guard
before insert or update on public.learning_assessments
for each row execute function public.guard_learning_assessment_scope();

alter table public.curriculum_exercises enable row level security;
alter table public.learning_assessments enable row level security;
revoke all on public.curriculum_exercises from anon, authenticated;
revoke all on public.learning_assessments from anon, authenticated;
revoke all on function public.guard_learning_assessment_scope() from anon, authenticated;
