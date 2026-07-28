-- Rename the unlimited plan from "team" to "max".
do $$
declare
  plan_constraint text;
begin
  for plan_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'branchmind_user_plans'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%plan%'
  loop
    execute format(
      'alter table public.branchmind_user_plans drop constraint %I',
      plan_constraint
    );
  end loop;
end;
$$;

update public.branchmind_user_plans
set plan = 'max',
    updated_at = now()
where plan = 'team';

insert into public.branchmind_plan_limits (
  plan,
  max_projects,
  max_nodes,
  max_documents,
  max_ai_messages_per_day
)
values ('max', null, null, null, null)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_nodes = excluded.max_nodes,
  max_documents = excluded.max_documents,
  max_ai_messages_per_day = excluded.max_ai_messages_per_day;

delete from public.branchmind_plan_limits
where plan = 'team';

alter table public.branchmind_user_plans
  add constraint branchmind_user_plans_plan_check
  check (plan in ('free', 'pro', 'max'));
