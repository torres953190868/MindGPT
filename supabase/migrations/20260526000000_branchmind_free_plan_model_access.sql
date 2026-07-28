-- Keep newly-created accounts on the free plan by default.
create table if not exists public.branchmind_user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  display_name text,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text default 'inactive' check (
    subscription_status in ('active', 'canceled', 'past_due', 'inactive')
  ),
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.branchmind_user_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  project_count int not null default 0,
  node_count int not null default 0,
  document_count int not null default 0,
  ai_message_count int not null default 0,
  primary key (user_id, date)
);

create table if not exists public.branchmind_plan_limits (
  plan text primary key,
  max_projects int,
  max_nodes int,
  max_documents int,
  max_ai_messages_per_day int
);

alter table public.branchmind_user_plans enable row level security;
alter table public.branchmind_user_usage enable row level security;
alter table public.branchmind_plan_limits enable row level security;

revoke insert, update, delete on public.branchmind_user_plans from anon, authenticated;
revoke insert, update, delete on public.branchmind_user_usage from anon, authenticated;
revoke insert, update, delete on public.branchmind_plan_limits from anon, authenticated;
grant select on public.branchmind_user_plans to authenticated;
grant select on public.branchmind_user_usage to authenticated;
grant select on public.branchmind_plan_limits to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'branchmind_user_plans'
      and policyname = 'Users can view own plan'
  ) then
    create policy "Users can view own plan"
      on public.branchmind_user_plans for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'branchmind_user_usage'
      and policyname = 'Users can view own usage'
  ) then
    create policy "Users can view own usage"
      on public.branchmind_user_usage for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'branchmind_plan_limits'
      and policyname = 'Plan limits are public'
  ) then
    create policy "Plan limits are public"
      on public.branchmind_plan_limits for select
      to authenticated, anon
      using (true);
  end if;
end;
$$;

alter table public.branchmind_user_plans
  alter column plan set default 'free';

insert into public.branchmind_plan_limits (
  plan,
  max_projects,
  max_nodes,
  max_documents,
  max_ai_messages_per_day
)
values
  ('free', 5, 100, 3, 50)
on conflict (plan) do update set
  max_projects = excluded.max_projects,
  max_nodes = excluded.max_nodes,
  max_documents = excluded.max_documents,
  max_ai_messages_per_day = excluded.max_ai_messages_per_day;

create or replace function public.handle_new_user_plan()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.branchmind_user_plans (user_id, plan)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created_plan'
      and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created_plan
      after insert on auth.users
      for each row execute function public.handle_new_user_plan();
  end if;
end;
$$;

-- Free users are restricted in application code to official DeepSeek V4 models.
-- Keep the official DeepSeek provider and model rows present for existing databases.
create table if not exists public.branchmind_llm_providers (
  provider_id text primary key,
  display_name text not null,
  base_url text not null,
  api_key_env text not null,
  enabled boolean not null default true,
  timeout_ms integer,
  payload_options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branchmind_llm_providers_id_not_blank check (length(btrim(provider_id)) > 0),
  constraint branchmind_llm_providers_name_not_blank check (length(btrim(display_name)) > 0),
  constraint branchmind_llm_providers_url_not_blank check (length(btrim(base_url)) > 0),
  constraint branchmind_llm_providers_api_key_env_not_blank check (length(btrim(api_key_env)) > 0),
  constraint branchmind_llm_providers_timeout_valid check (
    timeout_ms is null or timeout_ms >= 1000
  )
);

create table if not exists public.branchmind_llm_models (
  provider_id text not null references public.branchmind_llm_providers(provider_id) on delete cascade,
  model text not null,
  display_name text not null,
  enabled boolean not null default true,
  supports_streaming boolean not null default true,
  supports_json boolean not null default true,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_id, model),
  constraint branchmind_llm_models_model_not_blank check (length(btrim(model)) > 0),
  constraint branchmind_llm_models_name_not_blank check (length(btrim(display_name)) > 0)
);

create table if not exists public.branchmind_llm_routes (
  task text primary key,
  default_provider_id text not null,
  default_model text not null,
  fallback_provider_id text,
  fallback_model text,
  updated_at timestamptz not null default now(),
  constraint branchmind_llm_routes_task_check check (
    task in ('node_generation', 'branch_chat', 'pdf_qa')
  ),
  constraint branchmind_llm_routes_default_fkey foreign key (default_provider_id, default_model)
    references public.branchmind_llm_models(provider_id, model)
    on delete restrict,
  constraint branchmind_llm_routes_fallback_fkey foreign key (fallback_provider_id, fallback_model)
    references public.branchmind_llm_models(provider_id, model)
    on delete set null,
  constraint branchmind_llm_routes_fallback_pair check (
    (fallback_provider_id is null and fallback_model is null)
    or (fallback_provider_id is not null and fallback_model is not null)
  )
);

create index if not exists branchmind_llm_models_provider_order_idx
  on public.branchmind_llm_models(provider_id, sort_order, model);

alter table public.branchmind_llm_providers enable row level security;
alter table public.branchmind_llm_models enable row level security;
alter table public.branchmind_llm_routes enable row level security;

revoke all on public.branchmind_llm_providers from anon, authenticated;
revoke all on public.branchmind_llm_models from anon, authenticated;
revoke all on public.branchmind_llm_routes from anon, authenticated;

insert into public.branchmind_llm_providers (
  provider_id,
  display_name,
  base_url,
  api_key_env,
  enabled,
  timeout_ms,
  payload_options
)
values (
  'deepseek',
  'DeepSeek',
  'https://api.deepseek.com/chat/completions',
  'DEEPSEEK_API_KEY',
  true,
  30000,
  '{"thinking":{"type":"disabled"}}'::jsonb
)
on conflict (provider_id) do update set
  display_name = excluded.display_name,
  base_url = excluded.base_url,
  api_key_env = excluded.api_key_env,
  enabled = true,
  payload_options = excluded.payload_options,
  updated_at = now();

insert into public.branchmind_llm_models (
  provider_id,
  model,
  display_name,
  enabled,
  supports_streaming,
  supports_json,
  sort_order
)
values
  ('deepseek', 'deepseek-v4-flash', 'DeepSeek V4 Flash', true, true, true, 10),
  ('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro', true, true, true, 20)
on conflict (provider_id, model) do update set
  display_name = excluded.display_name,
  enabled = true,
  supports_streaming = true,
  supports_json = true,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.branchmind_llm_routes (
  task,
  default_provider_id,
  default_model,
  fallback_provider_id,
  fallback_model
)
values
  ('node_generation', 'deepseek', 'deepseek-v4-flash', null, null),
  ('branch_chat', 'deepseek', 'deepseek-v4-flash', null, null),
  ('pdf_qa', 'deepseek', 'deepseek-v4-flash', null, null)
on conflict (task) do nothing;
