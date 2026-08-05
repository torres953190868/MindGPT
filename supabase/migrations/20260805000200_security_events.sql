-- Security event audit records are intentionally hash-only. The service role
-- is the only role allowed to read or write these records.

create table if not exists public.security_events (
  id text primary key,
  user_id text,
  run_id text,
  rule text not null,
  domain text,
  content_hash text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint security_events_rule_not_blank check (length(btrim(rule)) > 0),
  constraint security_events_content_hash_not_blank check (length(btrim(content_hash)) > 0),
  constraint security_events_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists security_events_created_at_idx
  on public.security_events (created_at desc);
create index if not exists security_events_user_id_idx
  on public.security_events (user_id, created_at desc);
create index if not exists security_events_run_id_idx
  on public.security_events (run_id, created_at desc);

alter table public.security_events enable row level security;
revoke all on public.security_events from anon, authenticated;
