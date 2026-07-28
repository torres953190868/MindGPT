-- Narrow the free plan to the single official DeepSeek V4 Flash model.
-- The automatic mode resolves to DeepSeek V4 Flash in the client.
delete from public.branchmind_plan_model_access
where plan = 'free';

insert into public.branchmind_plan_model_access (plan, provider_id, model)
values ('free', 'deepseek', 'deepseek-v4-flash')
on conflict (plan, provider_id, model) do nothing;
