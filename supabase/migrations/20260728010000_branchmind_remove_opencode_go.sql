-- Remove the OpenCode Go provider. Deleting the provider cascades to its
-- models, clears route fallbacks that referenced them (set null), and drops
-- any plan model access rows for those models.
delete from public.branchmind_llm_providers
where provider_id = 'opencode-go';
