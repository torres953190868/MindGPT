-- Store each user's preferred BranchMind interface language.
alter table public.branchmind_user_plans
  add column if not exists language_preference text not null default 'zh';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'branchmind_user_plans_language_preference_check'
      and conrelid = 'public.branchmind_user_plans'::regclass
  ) then
    alter table public.branchmind_user_plans
      add constraint branchmind_user_plans_language_preference_check
      check (language_preference in ('zh', 'en'));
  end if;
end;
$$;
