-- Seed Gemini as an OpenAI-compatible chat completions provider.
insert into public.branchmind_llm_providers (
  provider_id,
  display_name,
  base_url,
  api_key_env,
  enabled,
  timeout_ms,
  payload_options
)
values (
  'gemini',
  'Gemini',
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'GEMINI_API_KEY',
  true,
  null,
  '{}'::jsonb
)
on conflict (provider_id) do nothing;

insert into public.branchmind_llm_models (
  provider_id,
  model,
  display_name,
  enabled,
  supports_streaming,
  supports_json,
  sort_order
)
values (
  'gemini',
  'gemini-3.5-flash',
  'Gemini 3.5 Flash',
  true,
  true,
  true,
  10
)
on conflict (provider_id, model) do nothing;
