alter table public.branchmind_projects
  add column if not exists notes text not null default '';
