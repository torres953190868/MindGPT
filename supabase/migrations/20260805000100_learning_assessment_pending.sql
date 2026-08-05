-- Phase 1 P0 T2: Tutor-generated questions are registered as pending
-- assessments before they are shown. Their answer is filled on submission.

alter table public.learning_assessments
  alter column answer_json drop not null;
