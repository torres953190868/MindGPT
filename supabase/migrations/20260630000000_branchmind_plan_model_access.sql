-- Plan-driven model access allowlist.
-- Admins can change which provider/model combinations are available per plan
-- by editing data in this table rather than changing application code.
create table if not exists public.branchmind_plan_model_access (
  plan text not null,
  provider_id text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan, provider_id, model),
  constraint branchmind_plan_model_access_plan_fkey
    foreign key (plan) references public.branchmind_plan_limits(plan) on delete cascade,
  constraint branchmind_plan_model_access_model_fkey
    foreign key (provider_id, model) references public.branchmind_llm_models(provider_id, model) on delete cascade
);

alter table public.branchmind_plan_model_access enable row level security;

revoke all on public.branchmind_plan_model_access from anon, authenticated;
grant select on public.branchmind_plan_model_access to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'branchmind_plan_model_access'
      and policyname = 'Plan model access is public'
  ) then
    create policy "Plan model access is public"
      on public.branchmind_plan_model_access for select
      to authenticated, anon
      using (true);
  end if;
end;
$$;

-- Seed the current free-plan allowlist: official DeepSeek V4 models only.
insert into public.branchmind_plan_model_access (plan, provider_id, model)
values
  ('free', 'deepseek', 'deepseek-v4-flash'),
  ('free', 'deepseek', 'deepseek-v4-pro')
on conflict (plan, provider_id, model) do nothing;
