alter table public.branchmind_messages
  add column if not exists citations jsonb not null default '[]'::jsonb;
