alter table public.documents
  drop constraint if exists documents_status_check;

alter table public.documents
  add constraint documents_status_check check (
    status in ('queued', 'uploaded', 'parsing', 'parsed', 'indexing', 'indexed', 'failed')
  );
