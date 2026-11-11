create table if not exists public.branchmind_user_memory_profiles (
  owner_id text primary key,
  profile_summary text not null default '',
  preferred_style text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branchmind_user_memory_profiles_owner_not_blank check (
    length(btrim(owner_id)) > 0
  )
);

create table if not exists public.branchmind_user_memory_concepts (
  id text primary key,
  owner_id text not null,
  concept_key text not null,
  concept text not null,
  status text not null,
  note text not null default '',
  source_project_id text,
  source_node_id text,
  evidence_count integer not null default 1 check (evidence_count >= 1),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branchmind_user_memory_concepts_owner_not_blank check (
    length(btrim(owner_id)) > 0
  ),
  constraint branchmind_user_memory_concepts_status_check check (
    status in ('mastered', 'learning', 'struggling')
  ),
  constraint branchmind_user_memory_concepts_owner_key_unique unique (
    owner_id,
    concept_key
  ),
  constraint branchmind_user_memory_concepts_concept_not_blank check (
    length(btrim(concept)) > 0
  )
);

create index if not exists branchmind_user_memory_concepts_owner_seen_idx
  on public.branchmind_user_memory_concepts(owner_id, last_seen_at desc);

alter table public.branchmind_user_memory_profiles enable row level security;
alter table public.branchmind_user_memory_concepts enable row level security;

revoke all on public.branchmind_user_memory_profiles from anon, authenticated;
revoke all on public.branchmind_user_memory_concepts from anon, authenticated;
