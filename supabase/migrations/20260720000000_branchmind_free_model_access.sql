-- Keep the free plan focused on the three models available to all users.
-- The automatic mode resolves to DeepSeek V4 Flash in the client.
delete from public.branchmind_plan_model_access
where plan = 'free';

insert into public.branchmind_plan_model_access (plan, provider_id, model)
values
  ('free', 'deepseek', 'deepseek-v4-flash'),
  ('free', 'opencode-go', 'kimi-k2.6'),
  ('free', 'opencode-go', 'mimo-v2.5-pro')
on conflict (plan, provider_id, model) do nothing;
