-- Daily AI message usage per user, used to enforce per-plan daily limits.
create table if not exists public.branchmind_daily_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  message_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

-- Enable RLS
alter table public.branchmind_daily_ai_usage enable row level security;

-- Direct clients may read their own counters, but all mutations must go
-- through server-side service role code.
revoke all on public.branchmind_daily_ai_usage from anon, authenticated;
grant select on public.branchmind_daily_ai_usage to authenticated;

-- RLS policies
create policy "Users can view own daily AI usage"
  on public.branchmind_daily_ai_usage for select
  using (auth.uid() = user_id);

-- Atomically increments today's counter for a user and returns the new value.
-- Called with the service role from the server before each AI generation.
create or replace function public.increment_daily_ai_usage(p_user_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.branchmind_daily_ai_usage (user_id, usage_date, message_count, updated_at)
  values (p_user_id, current_date, 1, now())
  on conflict (user_id, usage_date)
  do update set
    message_count = branchmind_daily_ai_usage.message_count + 1,
    updated_at = now()
  returning message_count into new_count;
  return new_count;
end;
$$;

revoke all on function public.increment_daily_ai_usage(uuid) from anon, authenticated;
