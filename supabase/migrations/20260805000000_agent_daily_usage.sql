-- Phase 1 P0: aggregate non-message agent usage without changing the
-- existing daily message-limit RPC contract.

alter table public.branchmind_daily_ai_usage
  add column if not exists agent_tokens_total bigint not null default 0,
  add column if not exists agent_runs_count integer not null default 0;

create or replace function public.increment_daily_agent_usage(
  p_user_id uuid,
  p_tokens bigint,
  p_runs_count integer
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.branchmind_daily_ai_usage (
    user_id,
    usage_date,
    message_count,
    agent_tokens_total,
    agent_runs_count,
    updated_at
  )
  values (p_user_id, current_date, 0, greatest(p_tokens, 0), greatest(p_runs_count, 0), now())
  on conflict (user_id, usage_date)
  do update set
    agent_tokens_total = branchmind_daily_ai_usage.agent_tokens_total + greatest(p_tokens, 0),
    agent_runs_count = branchmind_daily_ai_usage.agent_runs_count + greatest(p_runs_count, 0),
    updated_at = now();
end;
$$;

revoke all on function public.increment_daily_agent_usage(uuid, bigint, integer) from anon, authenticated;
