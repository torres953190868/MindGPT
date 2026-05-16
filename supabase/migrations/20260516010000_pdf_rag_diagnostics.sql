alter table public.documents
  add column if not exists error_code text,
  add column if not exists error_stage text,
  add column if not exists error_request_id text,
  add column if not exists error_details jsonb;

alter table public.documents
  drop constraint if exists documents_error_stage_check;

alter table public.documents
  add constraint documents_error_stage_check check (
    error_stage is null
    or error_stage in ('parsing', 'chunking', 'embedding', 'persisting')
  );
