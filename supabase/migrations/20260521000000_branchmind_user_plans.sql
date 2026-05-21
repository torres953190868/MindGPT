-- User plans and subscriptions
create table branchmind_user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  display_name text,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text default 'inactive' check (subscription_status in ('active', 'canceled', 'past_due', 'inactive')),
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Daily usage aggregation
 create table branchmind_user_usage (
   user_id uuid not null references auth.users(id) on delete cascade,
   date date not null default current_date,
   project_count int not null default 0,
   node_count int not null default 0,
   document_count int not null default 0,
   ai_message_count int not null default 0,
   primary key (user_id, date)
 );

-- Plan limits configuration
 create table branchmind_plan_limits (
   plan text primary key,
   max_projects int,
   max_nodes int,
   max_documents int,
   max_ai_messages_per_day int
 );

 insert into branchmind_plan_limits (plan, max_projects, max_nodes, max_documents, max_ai_messages_per_day)
 values
   ('free', 5, 100, 3, 50),
   ('pro', null, null, 50, 500),
   ('team', null, null, null, null);

-- Enable RLS
 alter table branchmind_user_plans enable row level security;
 alter table branchmind_user_usage enable row level security;
 alter table branchmind_plan_limits enable row level security;

-- RLS policies
 create policy "Users can view own plan"
   on branchmind_user_plans for select
   using (auth.uid() = user_id);

 create policy "Users can update own plan"
   on branchmind_user_plans for update
   using (auth.uid() = user_id);

 create policy "Users can view own usage"
   on branchmind_user_usage for select
   using (auth.uid() = user_id);

 create policy "Plan limits are public"
   on branchmind_plan_limits for select
   to authenticated, anon
   using (true);

-- Trigger to auto-insert free plan for new users
 create or replace function public.handle_new_user_plan()
 returns trigger
 language plpgsql
 security definer set search_path = public
 as $$
 begin
   insert into public.branchmind_user_plans (user_id, plan)
   values (new.id, 'free')
   on conflict (user_id) do nothing;
   return new;
 end;
 $$;

 create trigger on_auth_user_created_plan
   after insert on auth.users
   for each row execute function public.handle_new_user_plan();
