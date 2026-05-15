create extension if not exists vector;

create table if not exists public.documents (
  id text primary key,
  user_id text,
  file_name text not null,
  file_url text,
  storage_path text,
  mime_type text not null,
  page_count integer not null default 0,
  title text,
  status text not null default 'uploaded',
  parser_version text not null,
  chunk_version text not null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_file_name_not_blank check (length(btrim(file_name)) > 0),
  constraint documents_mime_type_not_blank check (length(btrim(mime_type)) > 0),
  constraint documents_page_count_non_negative check (page_count >= 0),
  constraint documents_status_check check (
    status in ('uploaded', 'parsing', 'parsed', 'indexing', 'indexed', 'failed')
  )
);

create table if not exists public.document_pages (
  id text primary key,
  document_id text not null references public.documents(id) on delete cascade,
  page_number integer not null,
  raw_text text not null,
  clean_text text not null,
  char_count integer not null default 0,
  token_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint document_pages_page_number_positive check (page_number > 0),
  constraint document_pages_char_count_non_negative check (char_count >= 0),
  constraint document_pages_token_count_non_negative check (token_count >= 0),
  constraint document_pages_document_page_unique unique (document_id, page_number)
);

create table if not exists public.document_sections (
  id text primary key,
  document_id text not null references public.documents(id) on delete cascade,
  title text not null,
  heading_path jsonb not null default '[]'::jsonb,
  level integer not null,
  page_start integer not null,
  page_end integer not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint document_sections_title_not_blank check (length(btrim(title)) > 0),
  constraint document_sections_level_positive check (level > 0),
  constraint document_sections_page_range_valid check (
    page_start > 0 and page_end >= page_start
  ),
  constraint document_sections_source_check check (
    source in ('pdf_outline', 'font_heuristic', 'regex', 'fallback')
  )
);

create table if not exists public.document_chunks (
  id text primary key,
  document_id text not null references public.documents(id) on delete cascade,
  section_id text references public.document_sections(id) on delete set null,
  parent_chunk_id text references public.document_chunks(id) on delete set null,
  chunk_index integer not null,
  content text not null,
  content_hash text not null,
  page_start integer not null,
  page_end integer not null,
  heading_path jsonb not null default '[]'::jsonb,
  token_count integer not null,
  char_start integer,
  char_end integer,
  embedding vector(1024),
  embedding_model text,
  chunk_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint document_chunks_content_not_blank check (length(btrim(content)) > 0),
  constraint document_chunks_chunk_index_non_negative check (chunk_index >= 0),
  constraint document_chunks_page_range_valid check (
    page_start > 0 and page_end >= page_start
  ),
  constraint document_chunks_token_count_positive check (token_count > 0),
  constraint document_chunks_char_range_valid check (
    char_start is null
    or char_end is null
    or char_end >= char_start
  ),
  constraint document_chunks_document_hash_unique unique (
    document_id,
    content_hash,
    chunk_version
  )
);

create index if not exists documents_user_updated_idx
  on public.documents(user_id, updated_at desc);

create index if not exists document_pages_document_page_idx
  on public.document_pages(document_id, page_number);

create index if not exists document_sections_document_start_idx
  on public.document_sections(document_id, page_start, level);

create index if not exists document_chunks_document_index_idx
  on public.document_chunks(document_id, chunk_index);

create index if not exists document_chunks_document_page_idx
  on public.document_chunks(document_id, page_start, page_end);

create index if not exists document_chunks_content_fts_idx
  on public.document_chunks using gin (to_tsvector('simple', content));

create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create or replace function public.match_document_chunks(
  match_document_id text,
  query_embedding vector(1024),
  match_count integer default 20
)
returns table (
  id text,
  document_id text,
  section_id text,
  chunk_index integer,
  content text,
  content_hash text,
  page_start integer,
  page_end integer,
  heading_path jsonb,
  token_count integer,
  embedding_model text,
  chunk_version text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.section_id,
    dc.chunk_index,
    dc.content,
    dc.content_hash,
    dc.page_start,
    dc.page_end,
    dc.heading_path,
    dc.token_count,
    dc.embedding_model,
    dc.chunk_version,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.document_id = match_document_id
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_sections enable row level security;
alter table public.document_chunks enable row level security;

revoke all on public.documents from anon, authenticated;
revoke all on public.document_pages from anon, authenticated;
revoke all on public.document_sections from anon, authenticated;
revoke all on public.document_chunks from anon, authenticated;
revoke all on function public.match_document_chunks(text, vector, integer) from anon, authenticated;
