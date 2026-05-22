-- Admin LLM routing and user bug reports
create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('branchmind-bug-attachments', 'branchmind-bug-attachments', false)
on conflict (id) do nothing;

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

create table if not exists public.branchmind_bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references auth.users(id) on delete set null,
  reporter_email text,
  contact_email text,
  title text not null,
  description text not null,
  status text not null default 'open',
  current_url text,
  user_agent text,
  screenshot_path text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branchmind_bug_reports_title_not_blank check (length(btrim(title)) > 0),
  constraint branchmind_bug_reports_description_not_blank check (length(btrim(description)) > 0),
  constraint branchmind_bug_reports_status_check check (
    status in ('open', 'triaged', 'fixed', 'closed')
  )
);

create index if not exists branchmind_llm_models_provider_order_idx
  on public.branchmind_llm_models(provider_id, sort_order, model);

create index if not exists branchmind_bug_reports_status_created_idx
  on public.branchmind_bug_reports(status, created_at desc);

create index if not exists branchmind_bug_reports_reporter_created_idx
  on public.branchmind_bug_reports(reporter_user_id, created_at desc);

insert into public.branchmind_llm_providers (
  provider_id,
  display_name,
  base_url,
  api_key_env,
  enabled,
  timeout_ms,
  payload_options
)
values
  (
    'deepseek',
    'DeepSeek',
    'https://api.deepseek.com/chat/completions',
    'DEEPSEEK_API_KEY',
    true,
    null,
    '{"thinking":{"type":"disabled"}}'::jsonb
  ),
  (
    'opencode-go',
    'OpenCode Go',
    'https://opencode.ai/zen/go/v1/chat/completions',
    'OPENCODE_GO_API_KEY',
    true,
    90000,
    '{}'::jsonb
  )
on conflict (provider_id) do nothing;

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
  ('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro', true, true, true, 20),
  ('opencode-go', 'glm-5.1', 'GLM 5.1', true, true, true, 10),
  ('opencode-go', 'qwen3.6-plus', 'Qwen 3.6 Plus', true, true, true, 20),
  ('opencode-go', 'mimo-v2.5-pro', 'MiMo V2.5 Pro', true, true, true, 30),
  ('opencode-go', 'deepseek-v4-pro', 'DeepSeek V4 Pro', true, true, true, 40),
  ('opencode-go', 'kimi-k2.6', 'Kimi K2.6', true, true, true, 50)
on conflict (provider_id, model) do nothing;

insert into public.branchmind_llm_routes (
  task,
  default_provider_id,
  default_model,
  fallback_provider_id,
  fallback_model
)
values
  ('node_generation', 'deepseek', 'deepseek-v4-flash', 'opencode-go', 'glm-5.1'),
  ('branch_chat', 'deepseek', 'deepseek-v4-flash', 'opencode-go', 'glm-5.1'),
  ('pdf_qa', 'deepseek', 'deepseek-v4-flash', 'opencode-go', 'glm-5.1')
on conflict (task) do nothing;

alter table public.branchmind_llm_providers enable row level security;
alter table public.branchmind_llm_models enable row level security;
alter table public.branchmind_llm_routes enable row level security;
alter table public.branchmind_bug_reports enable row level security;

revoke all on public.branchmind_llm_providers from anon, authenticated;
revoke all on public.branchmind_llm_models from anon, authenticated;
revoke all on public.branchmind_llm_routes from anon, authenticated;
revoke all on public.branchmind_bug_reports from anon, authenticated;
