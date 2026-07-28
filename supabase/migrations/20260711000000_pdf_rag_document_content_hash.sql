alter table public.documents
  add column if not exists content_hash text;

alter table public.documents
  drop constraint if exists documents_content_hash_format_check;

alter table public.documents
  add constraint documents_content_hash_format_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists documents_user_content_hash_unique
  on public.documents (user_id, content_hash)
  where content_hash is not null;
