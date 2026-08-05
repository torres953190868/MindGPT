-- Curriculum domain foundation for the dual-agent learning system (spec §7).
--
-- Delete/archive rule (spec §7.1): a curriculum is only ever archived, never
-- physically deleted, so progress and assessment records stay auditable. The
-- application layer forbids deleting curricula rows; curriculum_versions keeps
-- an `on delete restrict` foreign key as a database-level guard. Everything
-- under a version (modules, nodes, edges, sources, exercises, chunks) cascades
-- with its version, because versions are immutable once published and are
-- never deleted either.

create extension if not exists vector;

create table if not exists public.curricula (
  id text primary key,
  owner_user_id text not null,
  project_id text,
  title text not null,
  subject text not null,
  learning_goal text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curricula_owner_user_id_not_blank check (length(btrim(owner_user_id)) > 0),
  constraint curricula_title_not_blank check (length(btrim(title)) > 0),
  constraint curricula_subject_not_blank check (length(btrim(subject)) > 0),
  constraint curricula_learning_goal_not_blank check (length(btrim(learning_goal)) > 0),
  constraint curricula_status_check check (status in ('draft', 'active', 'archived'))
);

create table if not exists public.curriculum_versions (
  id text primary key,
  curriculum_id text not null references public.curricula(id) on delete restrict,
  version_number integer not null,
  version_label text not null,
  status text not null default 'draft',
  audience text not null,
  assumptions_json jsonb not null default '[]'::jsonb,
  exclusions_json jsonb not null default '[]'::jsonb,
  conflicts_json jsonb not null default '[]'::jsonb,
  estimated_weeks integer,
  estimated_hours double precision,
  build_request_json jsonb,
  validation_json jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint curriculum_versions_version_number_positive check (version_number > 0),
  constraint curriculum_versions_version_label_not_blank check (length(btrim(version_label)) > 0),
  constraint curriculum_versions_audience_not_blank check (length(btrim(audience)) > 0),
  constraint curriculum_versions_estimated_weeks_positive check (
    estimated_weeks is null or estimated_weeks > 0
  ),
  constraint curriculum_versions_estimated_hours_positive check (
    estimated_hours is null or estimated_hours > 0
  ),
  constraint curriculum_versions_status_check check (
    status in ('draft', 'published', 'superseded')
  ),
  -- published rows must carry a publish timestamp; superseded rows keep their
  -- historical published_at for audit, so the reverse implication is not enforced.
  constraint curriculum_versions_published_at_required check (
    status <> 'published' or published_at is not null
  ),
  constraint curriculum_versions_curriculum_version_unique unique (curriculum_id, version_number)
);

create table if not exists public.curriculum_modules (
  id text primary key,
  curriculum_version_id text not null references public.curriculum_versions(id) on delete cascade,
  title text not null,
  description text not null default '',
  order_index integer not null default 0,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  constraint curriculum_modules_title_not_blank check (length(btrim(title)) > 0),
  constraint curriculum_modules_order_index_non_negative check (order_index >= 0)
);

create table if not exists public.curriculum_nodes (
  id text primary key,
  curriculum_version_id text not null references public.curriculum_versions(id) on delete cascade,
  module_id text not null references public.curriculum_modules(id) on delete cascade,
  title text not null,
  summary text not null default '',
  node_type text not null,
  importance text not null,
  difficulty integer not null,
  estimated_minutes integer not null,
  learning_objectives_json jsonb not null default '[]'::jsonb,
  completion_criteria_json jsonb not null default '[]'::jsonb,
  tags_json jsonb not null default '[]'::jsonb,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  constraint curriculum_nodes_title_not_blank check (length(btrim(title)) > 0),
  constraint curriculum_nodes_node_type_check check (
    node_type in ('concept', 'procedure', 'example', 'exercise', 'project', 'assessment')
  ),
  constraint curriculum_nodes_importance_check check (
    importance in ('core', 'advanced', 'optional')
  ),
  constraint curriculum_nodes_difficulty_range check (difficulty between 1 and 5),
  constraint curriculum_nodes_estimated_minutes_positive check (estimated_minutes > 0),
  constraint curriculum_nodes_order_index_non_negative check (order_index >= 0)
);

create table if not exists public.curriculum_edges (
  id text primary key,
  curriculum_version_id text not null references public.curriculum_versions(id) on delete cascade,
  from_node_id text not null references public.curriculum_nodes(id) on delete cascade,
  to_node_id text not null references public.curriculum_nodes(id) on delete cascade,
  edge_type text not null,
  created_at timestamptz not null default now(),
  constraint curriculum_edges_edge_type_check check (
    edge_type in ('prerequisite', 'recommended', 'related')
  ),
  constraint curriculum_edges_no_self_loop check (from_node_id <> to_node_id),
  constraint curriculum_edges_unique unique (from_node_id, to_node_id, edge_type)
);

create table if not exists public.curriculum_sources (
  id text primary key,
  curriculum_version_id text not null references public.curriculum_versions(id) on delete cascade,
  url text not null,
  canonical_url text not null,
  title text not null,
  publisher text,
  source_type text not null,
  retrieved_at timestamptz not null,
  published_at timestamptz,
  quality_score double precision not null,
  content_hash text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint curriculum_sources_url_not_blank check (length(btrim(url)) > 0),
  constraint curriculum_sources_canonical_url_not_blank check (length(btrim(canonical_url)) > 0),
  constraint curriculum_sources_title_not_blank check (length(btrim(title)) > 0),
  constraint curriculum_sources_source_type_check check (
    source_type in (
      'university_course',
      'textbook',
      'official_documentation',
      'standard',
      'research_paper',
      'industry_guide',
      'other'
    )
  ),
  constraint curriculum_sources_quality_score_range check (
    quality_score >= 0 and quality_score <= 1
  ),
  constraint curriculum_sources_canonical_url_unique unique (curriculum_version_id, canonical_url)
);

create table if not exists public.curriculum_node_sources (
  node_id text not null references public.curriculum_nodes(id) on delete cascade,
  source_id text not null references public.curriculum_sources(id) on delete cascade,
  support_type text not null default 'supporting',
  note text,
  created_at timestamptz not null default now(),
  constraint curriculum_node_sources_support_type_check check (
    support_type in ('primary', 'supporting', 'example')
  ),
  constraint curriculum_node_sources_pkey primary key (node_id, source_id)
);

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
  constraint curriculum_exercises_exercise_type_check check (
    exercise_type in ('quiz', 'open', 'code', 'project')
  ),
  constraint curriculum_exercises_order_index_non_negative check (order_index >= 0)
);

create table if not exists public.curriculum_source_chunks (
  id text primary key,
  source_id text not null references public.curriculum_sources(id) on delete cascade,
  chunk_index integer not null,
  excerpt text not null,
  embedding vector(1024),
  token_count integer not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  -- Only short cleaned excerpts are stored (spec §7.15), never full page bodies.
  constraint curriculum_source_chunks_excerpt_not_blank check (length(btrim(excerpt)) > 0),
  constraint curriculum_source_chunks_excerpt_length check (length(excerpt) <= 2000),
  constraint curriculum_source_chunks_chunk_index_non_negative check (chunk_index >= 0),
  constraint curriculum_source_chunks_token_count_positive check (token_count > 0),
  constraint curriculum_source_chunks_content_hash_not_blank check (length(btrim(content_hash)) > 0),
  constraint curriculum_source_chunks_source_chunk_unique unique (source_id, chunk_index)
);

create index if not exists curricula_owner_updated_idx
  on public.curricula(owner_user_id, updated_at desc);

-- At most one published version per curriculum at any time (spec §7.2); the
-- publish RPC supersedes the previous published version in the same
-- transaction, and this partial unique index is the database-level backstop.
create unique index if not exists curriculum_versions_one_published_per_curriculum_idx
  on public.curriculum_versions(curriculum_id)
  where status = 'published';

create index if not exists curriculum_modules_version_order_idx
  on public.curriculum_modules(curriculum_version_id, order_index);

create index if not exists curriculum_nodes_version_idx
  on public.curriculum_nodes(curriculum_version_id);

create index if not exists curriculum_nodes_module_order_idx
  on public.curriculum_nodes(module_id, order_index);

create index if not exists curriculum_edges_version_idx
  on public.curriculum_edges(curriculum_version_id);

create index if not exists curriculum_edges_to_node_idx
  on public.curriculum_edges(to_node_id);

create index if not exists curriculum_node_sources_source_idx
  on public.curriculum_node_sources(source_id);

create index if not exists curriculum_exercises_node_order_idx
  on public.curriculum_exercises(node_id, order_index);

create index if not exists curriculum_source_chunks_embedding_hnsw_idx
  on public.curriculum_source_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- Allocates the next version_number for a curriculum. The curricula row is
-- locked with `for update` first, so concurrent version creation/derivation
-- for the same curriculum serializes here and can never allocate duplicate
-- numbers (spec §7.2).
create or replace function public.allocate_curriculum_version_number(p_curriculum_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_version_number integer;
begin
  perform 1
  from public.curricula
  where id = p_curriculum_id
  for update;

  if not found then
    raise exception 'curriculum % not found', p_curriculum_id;
  end if;

  select coalesce(max(v.version_number), 0) + 1
  into v_next_version_number
  from public.curriculum_versions v
  where v.curriculum_id = p_curriculum_id;

  return v_next_version_number;
end;
$$;

-- Publishes a draft version atomically (spec §7.2 / §8.4). The whole function
-- body runs in the caller's transaction: any failure rolls back all writes,
-- so a curriculum can never be left half-published. Concurrent publishes for
-- the same curriculum serialize on the curricula row lock.
create or replace function public.publish_curriculum_version(
  p_curriculum_id text,
  p_version_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_status text;
begin
  perform 1
  from public.curricula
  where id = p_curriculum_id
  for update;

  if not found then
    raise exception 'curriculum % not found', p_curriculum_id;
  end if;

  select v.status
  into v_target_status
  from public.curriculum_versions v
  where v.id = p_version_id
    and v.curriculum_id = p_curriculum_id;

  if not found then
    raise exception 'version % not found for curriculum %', p_version_id, p_curriculum_id;
  end if;

  if v_target_status <> 'draft' then
    raise exception 'only draft versions can be published (version % is %)',
      p_version_id,
      v_target_status;
  end if;

  update public.curriculum_versions
  set status = 'superseded'
  where curriculum_id = p_curriculum_id
    and status = 'published';

  update public.curriculum_versions
  set status = 'published',
      published_at = now()
  where id = p_version_id;

  update public.curricula
  set status = 'active',
      updated_at = now()
  where id = p_curriculum_id
    and status = 'draft';
end;
$$;

alter table public.curricula enable row level security;
alter table public.curriculum_versions enable row level security;
alter table public.curriculum_modules enable row level security;
alter table public.curriculum_nodes enable row level security;
alter table public.curriculum_edges enable row level security;
alter table public.curriculum_sources enable row level security;
alter table public.curriculum_node_sources enable row level security;
alter table public.curriculum_exercises enable row level security;
alter table public.curriculum_source_chunks enable row level security;

revoke all on public.curricula from anon, authenticated;
revoke all on public.curriculum_versions from anon, authenticated;
revoke all on public.curriculum_modules from anon, authenticated;
revoke all on public.curriculum_nodes from anon, authenticated;
revoke all on public.curriculum_edges from anon, authenticated;
revoke all on public.curriculum_sources from anon, authenticated;
revoke all on public.curriculum_node_sources from anon, authenticated;
revoke all on public.curriculum_exercises from anon, authenticated;
revoke all on public.curriculum_source_chunks from anon, authenticated;
revoke all on function public.allocate_curriculum_version_number(text) from anon, authenticated;
revoke all on function public.publish_curriculum_version(text, text) from anon, authenticated;
