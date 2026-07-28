-- Transactional save for a full BranchMind project (project + nodes + messages).
-- The function body runs in a single transaction: any failure rolls back all
-- writes, so a project can never be left half-updated.
--
-- Parameters are jsonb rows shaped exactly like the branchmind_projects /
-- branchmind_nodes / branchmind_messages table rows produced by
-- projectToRows() in lib/server/projects-repository.ts.

create or replace function public.branchmind_save_project(
  project_row jsonb,
  node_rows jsonb,
  message_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_project_id text := project_row ->> 'id';
begin
  insert into public.branchmind_projects (
    id,
    owner_session_id,
    title,
    notes,
    root_node_id,
    created_at,
    updated_at
  )
  values (
    target_project_id,
    project_row ->> 'owner_session_id',
    project_row ->> 'title',
    coalesce(project_row ->> 'notes', ''),
    project_row ->> 'root_node_id',
    (project_row ->> 'created_at')::timestamptz,
    (project_row ->> 'updated_at')::timestamptz
  )
  on conflict (id) do update set
    owner_session_id = excluded.owner_session_id,
    title = excluded.title,
    notes = excluded.notes,
    root_node_id = excluded.root_node_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  -- node_rows arrives parent-first (BFS order from projectToRows), so the
  -- self-referencing (project_id, parent_id) foreign key is satisfied as each
  -- row is inserted.
  insert into public.branchmind_nodes (
    id,
    project_id,
    parent_id,
    title,
    title_manually_edited,
    summary,
    position_x,
    position_y,
    branch_type,
    collapsed,
    child_order,
    created_at,
    updated_at
  )
  select
    n.id,
    n.project_id,
    n.parent_id,
    n.title,
    coalesce(n.title_manually_edited, false),
    coalesce(n.summary, ''),
    coalesce(n.position_x, 0),
    coalesce(n.position_y, 0),
    n.branch_type,
    coalesce(n.collapsed, false),
    coalesce(n.child_order, 0),
    n.created_at,
    n.updated_at
  from jsonb_to_recordset(node_rows) as n (
    id text,
    project_id text,
    parent_id text,
    title text,
    title_manually_edited boolean,
    summary text,
    position_x double precision,
    position_y double precision,
    branch_type text,
    collapsed boolean,
    child_order integer,
    created_at timestamptz,
    updated_at timestamptz
  )
  on conflict (id) do update set
    project_id = excluded.project_id,
    parent_id = excluded.parent_id,
    title = excluded.title,
    title_manually_edited = excluded.title_manually_edited,
    summary = excluded.summary,
    position_x = excluded.position_x,
    position_y = excluded.position_y,
    branch_type = excluded.branch_type,
    collapsed = excluded.collapsed,
    child_order = excluded.child_order,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  insert into public.branchmind_messages (
    id,
    project_id,
    node_id,
    role,
    content,
    attachments,
    citations,
    sort_order,
    created_at
  )
  select
    m.id,
    m.project_id,
    m.node_id,
    m.role,
    m.content,
    coalesce(m.attachments, '[]'::jsonb),
    coalesce(m.citations, '[]'::jsonb),
    coalesce(m.sort_order, 0),
    m.created_at
  from jsonb_to_recordset(message_rows) as m (
    id text,
    project_id text,
    node_id text,
    role text,
    content text,
    attachments jsonb,
    citations jsonb,
    sort_order integer,
    created_at timestamptz
  )
  on conflict (id) do update set
    project_id = excluded.project_id,
    node_id = excluded.node_id,
    role = excluded.role,
    content = excluded.content,
    attachments = excluded.attachments,
    citations = excluded.citations,
    sort_order = excluded.sort_order,
    created_at = excluded.created_at;

  -- Remove nodes that are no longer part of the project. Messages on stale
  -- nodes are removed by the branchmind_messages_node_fkey on delete cascade.
  delete from public.branchmind_nodes stale
  where stale.project_id = target_project_id
    and not exists (
      select 1
      from jsonb_to_recordset(node_rows) as keep (id text)
      where keep.id = stale.id
    );
end;
$$;

revoke all on function public.branchmind_save_project(jsonb, jsonb, jsonb) from anon, authenticated;
