create table if not exists public.branchmind_projects (
  id text primary key,
  owner_session_id text not null,
  title text not null,
  root_node_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branchmind_projects_title_not_blank check (length(btrim(title)) > 0),
  constraint branchmind_projects_owner_session_not_blank check (
    length(btrim(owner_session_id)) > 0
  )
);

create table if not exists public.branchmind_nodes (
  id text primary key,
  project_id text not null references public.branchmind_projects(id) on delete cascade,
  parent_id text,
  title text not null,
  summary text not null default '',
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  branch_type text not null,
  collapsed boolean not null default false,
  child_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branchmind_nodes_project_id_id_unique unique (project_id, id),
  constraint branchmind_nodes_parent_fkey foreign key (project_id, parent_id)
    references public.branchmind_nodes(project_id, id)
    on delete cascade,
  constraint branchmind_nodes_branch_type_check check (
    branch_type in ('root', 'continue', 'branch')
  ),
  constraint branchmind_nodes_root_parent_check check (
    (branch_type = 'root' and parent_id is null)
    or (branch_type in ('continue', 'branch') and parent_id is not null)
  ),
  constraint branchmind_nodes_title_not_blank check (length(btrim(title)) > 0)
);

create table if not exists public.branchmind_messages (
  id text primary key,
  project_id text not null references public.branchmind_projects(id) on delete cascade,
  node_id text not null,
  role text not null,
  content text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint branchmind_messages_node_fkey foreign key (project_id, node_id)
    references public.branchmind_nodes(project_id, id)
    on delete cascade,
  constraint branchmind_messages_role_check check (role in ('user', 'assistant'))
);

create index if not exists branchmind_projects_owner_updated_idx
  on public.branchmind_projects(owner_session_id, updated_at desc);

create unique index if not exists branchmind_nodes_one_root_per_project_idx
  on public.branchmind_nodes(project_id)
  where parent_id is null;

create index if not exists branchmind_nodes_project_parent_order_idx
  on public.branchmind_nodes(project_id, parent_id, child_order);

create index if not exists branchmind_messages_project_node_order_idx
  on public.branchmind_messages(project_id, node_id, sort_order);

create table if not exists public.rate_limits (
  key text primary key,
  action text not null,
  session_id text not null,
  fingerprint text not null,
  count integer not null default 1,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint rate_limits_action_not_blank check (length(btrim(action)) > 0),
  constraint rate_limits_session_id_not_blank check (length(btrim(session_id)) > 0),
  constraint rate_limits_count_non_negative check (count >= 0)
);

create index if not exists rate_limits_action_reset_idx
  on public.rate_limits(action, reset_at);

create index if not exists rate_limits_session_action_idx
  on public.rate_limits(session_id, action);

alter table public.branchmind_projects enable row level security;
alter table public.branchmind_nodes enable row level security;
alter table public.branchmind_messages enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.branchmind_projects from anon, authenticated;
revoke all on public.branchmind_nodes from anon, authenticated;
revoke all on public.branchmind_messages from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;
