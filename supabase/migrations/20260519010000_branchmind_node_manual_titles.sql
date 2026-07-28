alter table public.branchmind_nodes
  add column if not exists title_manually_edited boolean not null default false;
