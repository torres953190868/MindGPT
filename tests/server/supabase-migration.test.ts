import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260504000000_branchmind_foundation.sql"),
  "utf8",
);
const projectNotesMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260508000000_branchmind_project_notes.sql"),
  "utf8",
);
const messageAttachmentsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260514000000_branchmind_message_attachments.sql",
  ),
  "utf8",
);
const messageCitationsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260524010000_branchmind_message_citations.sql",
  ),
  "utf8",
);
const ragFoundationMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260514010000_pdf_rag_foundation.sql"),
  "utf8",
);
const nodeManualTitlesMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260519010000_branchmind_node_manual_titles.sql",
  ),
  "utf8",
);
const userPlansMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260521000000_branchmind_user_plans.sql",
  ),
  "utf8",
);
const adminLlmBugReportsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260522000000_branchmind_admin_llm_bug_reports.sql",
  ),
  "utf8",
);
const geminiLlmMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260524020000_branchmind_gemini_llm_provider.sql",
  ),
  "utf8",
);
const freePlanModelAccessMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260526000000_branchmind_free_plan_model_access.sql",
  ),
  "utf8",
);
const renameTeamPlanMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260526010000_branchmind_rename_team_plan_to_max.sql",
  ),
  "utf8",
);
const languagePreferenceMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260526020000_branchmind_language_preference.sql",
  ),
  "utf8",
);
const dailyAiUsageMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260729000000_branchmind_daily_ai_usage.sql",
  ),
  "utf8",
);
const agentDailyUsageMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260805000000_agent_daily_usage.sql"),
  "utf8",
);
const curriculumFoundationMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260804000000_curriculum_foundation.sql",
  ),
  "utf8",
);
const curriculumVersionAgentRunMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260805010000_curriculum_version_agent_run_id.sql",
  ),
  "utf8",
);
const agentRuntimeMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260804010000_agent_runtime.sql",
  ),
  "utf8",
);
const learningFoundationMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260804020000_learning_foundation.sql",
  ),
  "utf8",
);
const learningAssessmentMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260804030000_learning_assessment.sql",
  ),
  "utf8",
);
const securityEventsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260805000200_security_events.sql",
  ),
  "utf8",
);
const learningAssessmentPendingMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260805000100_learning_assessment_pending.sql",
  ),
  "utf8",
);

describe("Supabase foundation migration", () => {
  it("creates the beta persistence and distributed rate-limit tables", () => {
    expect(migration).toContain("create table if not exists public.branchmind_projects");
    expect(migration).toContain("create table if not exists public.branchmind_nodes");
    expect(migration).toContain("create table if not exists public.branchmind_messages");
    expect(migration).toContain("create table if not exists public.rate_limits");
  });

  it("enables RLS and revokes direct client table access", () => {
    for (const table of [
      "branchmind_projects",
      "branchmind_nodes",
      "branchmind_messages",
      "rate_limits",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
  });

  it("adds project notes persistence", () => {
    expect(projectNotesMigration).toContain("add column if not exists notes text not null default ''");
  });

  it("adds message attachment metadata persistence", () => {
    expect(messageAttachmentsMigration).toContain(
      "add column if not exists attachments jsonb not null default '[]'::jsonb",
    );
  });

  it("adds message citation metadata persistence", () => {
    expect(messageCitationsMigration).toContain(
      "add column if not exists citations jsonb not null default '[]'::jsonb",
    );
  });

  it("creates a private Supabase Storage bucket for RAG PDF files", () => {
    expect(ragFoundationMigration).toContain("insert into storage.buckets");
    expect(ragFoundationMigration).toContain("'branchmind-rag-files'");
    expect(ragFoundationMigration).toContain("false");
  });

  it("adds node manual title persistence", () => {
    expect(nodeManualTitlesMigration).toContain(
      "add column if not exists title_manually_edited boolean not null default false",
    );
  });

  it("keeps user plan fields read-only for authenticated clients", () => {
    expect(userPlansMigration).toContain(
      "create policy \"Users can view own plan\"",
    );
    expect(userPlansMigration).toContain(
      "grant select on branchmind_user_plans to authenticated",
    );
    expect(userPlansMigration).toContain(
      "revoke insert, update, delete on branchmind_user_plans from anon, authenticated",
    );
    expect(userPlansMigration).not.toMatch(
      /create policy\s+"Users can update own plan"[\s\S]*?for update/i,
    );
    expect(userPlansMigration).not.toMatch(
      /on branchmind_user_plans\s+for update/i,
    );
  });

  it("defaults newly-created users to the free plan", () => {
    expect(userPlansMigration).toContain("plan text not null default 'free'");
    expect(userPlansMigration).toContain("values (new.id, 'free')");
    expect(freePlanModelAccessMigration).toContain("alter column plan set default 'free'");
    expect(freePlanModelAccessMigration).toContain("create trigger on_auth_user_created_plan");
  });

  it("keeps official DeepSeek V4 models available for free-plan routing", () => {
    expect(freePlanModelAccessMigration).toContain("https://api.deepseek.com/chat/completions");
    expect(freePlanModelAccessMigration).toContain("'DEEPSEEK_API_KEY'");
    expect(freePlanModelAccessMigration).toContain("'deepseek-v4-flash'");
    expect(freePlanModelAccessMigration).toContain("'deepseek-v4-pro'");
  });

  it("renames the unlimited team plan to max", () => {
    expect(renameTeamPlanMigration).toContain("set plan = 'max'");
    expect(renameTeamPlanMigration).toContain("where plan = 'team'");
    expect(renameTeamPlanMigration).toContain("values ('max', null, null, null, null)");
    expect(renameTeamPlanMigration).toContain("check (plan in ('free', 'pro', 'max'))");
  });

  it("stores account language preference with Chinese as the default", () => {
    expect(languagePreferenceMigration).toContain(
      "add column if not exists language_preference text not null default 'zh'",
    );
    expect(languagePreferenceMigration).toContain("language_preference in ('zh', 'en')");
  });

  it("adds admin LLM routing tables and private bug report attachments", () => {
    expect(adminLlmBugReportsMigration).toContain("branchmind_llm_providers");
    expect(adminLlmBugReportsMigration).toContain("branchmind_llm_models");
    expect(adminLlmBugReportsMigration).toContain("branchmind_llm_routes");
    expect(adminLlmBugReportsMigration).toContain("branchmind_bug_reports");
    expect(adminLlmBugReportsMigration).toContain("'branchmind-bug-attachments'");
    expect(adminLlmBugReportsMigration).toContain("false");
    expect(adminLlmBugReportsMigration).toContain(
      "revoke all on public.branchmind_bug_reports from anon, authenticated",
    );
  });

  it("seeds Gemini as an OpenAI-compatible LLM provider", () => {
    expect(geminiLlmMigration).toContain("'gemini'");
    expect(geminiLlmMigration).toContain("GEMINI_API_KEY");
    expect(geminiLlmMigration).toContain("gemini-3.5-flash");
    expect(geminiLlmMigration).toContain(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });

  it("tracks daily AI message usage with an atomic increment function", () => {
    expect(dailyAiUsageMigration).toContain(
      "create table if not exists public.branchmind_daily_ai_usage",
    );
    expect(dailyAiUsageMigration).toContain("primary key (user_id, usage_date)");
    expect(dailyAiUsageMigration).toContain(
      "alter table public.branchmind_daily_ai_usage enable row level security",
    );
    expect(dailyAiUsageMigration).toContain(
      "revoke all on public.branchmind_daily_ai_usage from anon, authenticated",
    );
    expect(dailyAiUsageMigration).toContain(
      'create policy "Users can view own daily AI usage"',
    );
    expect(dailyAiUsageMigration).toContain(
      "create or replace function public.increment_daily_ai_usage(p_user_id uuid)",
    );
    expect(dailyAiUsageMigration).toContain("security definer set search_path = public");
    expect(dailyAiUsageMigration).toContain("on conflict (user_id, usage_date)");
    expect(dailyAiUsageMigration).toContain(
      "revoke all on function public.increment_daily_ai_usage(uuid) from anon, authenticated",
    );
  });

  it("adds atomic agent token and run aggregation columns", () => {
    expect(agentDailyUsageMigration).toContain("agent_tokens_total bigint not null default 0");
    expect(agentDailyUsageMigration).toContain("agent_runs_count integer not null default 0");
    expect(agentDailyUsageMigration).toContain("create or replace function public.increment_daily_agent_usage");
    expect(agentDailyUsageMigration).toContain("on conflict (user_id, usage_date)");
    expect(agentDailyUsageMigration).toContain(
      "revoke all on function public.increment_daily_agent_usage(uuid, bigint, integer) from anon, authenticated",
    );
  });
});

describe("Curriculum foundation migration", () => {
  it("binds drafts to agent runs with a partial unique idempotency index", () => {
    expect(curriculumVersionAgentRunMigration).toContain(
      "add column if not exists agent_run_id text references public.agent_runs(id)",
    );
    expect(curriculumVersionAgentRunMigration).toContain(
      "curriculum_versions_curriculum_agent_run_unique_idx",
    );
    expect(curriculumVersionAgentRunMigration).toContain(
      "where agent_run_id is not null",
    );
  });
  it("creates the nine curriculum domain tables", () => {
    for (const table of [
      "curricula",
      "curriculum_versions",
      "curriculum_modules",
      "curriculum_nodes",
      "curriculum_edges",
      "curriculum_sources",
      "curriculum_node_sources",
      "curriculum_exercises",
      "curriculum_source_chunks",
    ]) {
      expect(curriculumFoundationMigration).toContain(
        `create table if not exists public.${table}`,
      );
    }
  });

  it("enables RLS and revokes direct client access on every curriculum table", () => {
    for (const table of [
      "curricula",
      "curriculum_versions",
      "curriculum_modules",
      "curriculum_nodes",
      "curriculum_edges",
      "curriculum_sources",
      "curriculum_node_sources",
      "curriculum_exercises",
      "curriculum_source_chunks",
    ]) {
      expect(curriculumFoundationMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(curriculumFoundationMigration).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
    }
  });

  it("forbids physical curriculum deletes via a restrict foreign key", () => {
    expect(curriculumFoundationMigration).toContain(
      "references public.curricula(id) on delete restrict",
    );
  });

  it("enforces version, edge, source, and chunk uniqueness constraints", () => {
    expect(curriculumFoundationMigration).toContain("unique (curriculum_id, version_number)");
    expect(curriculumFoundationMigration).toContain(
      "unique (from_node_id, to_node_id, edge_type)",
    );
    expect(curriculumFoundationMigration).toContain("from_node_id <> to_node_id");
    expect(curriculumFoundationMigration).toContain(
      "unique (curriculum_version_id, canonical_url)",
    );
    expect(curriculumFoundationMigration).toContain("primary key (node_id, source_id)");
    expect(curriculumFoundationMigration).toContain("unique (source_id, chunk_index)");
  });

  it("allows at most one published version per curriculum via a partial unique index", () => {
    expect(curriculumFoundationMigration).toContain(
      "create unique index if not exists curriculum_versions_one_published_per_curriculum_idx",
    );
    expect(curriculumFoundationMigration).toContain("where status = 'published'");
  });

  it("stores source chunk embeddings as vector(1024) with a partial HNSW index", () => {
    expect(curriculumFoundationMigration).toContain("embedding vector(1024)");
    expect(curriculumFoundationMigration).toContain(
      "using hnsw (embedding vector_cosine_ops)",
    );
    expect(curriculumFoundationMigration).toContain("where embedding is not null");
  });

  it("publishes versions and allocates version numbers through locked RPCs", () => {
    expect(curriculumFoundationMigration).toContain(
      "create or replace function public.allocate_curriculum_version_number(p_curriculum_id text)",
    );
    expect(curriculumFoundationMigration).toContain(
      "create or replace function public.publish_curriculum_version(",
    );
    expect(curriculumFoundationMigration).toContain("security definer");
    expect(curriculumFoundationMigration).toContain("set search_path = public");
    expect(curriculumFoundationMigration).toContain("for update");
    expect(curriculumFoundationMigration).toContain("set status = 'superseded'");
    expect(curriculumFoundationMigration).toContain("set status = 'published',");
    expect(curriculumFoundationMigration).toContain(
      "revoke all on function public.allocate_curriculum_version_number(text) from anon, authenticated",
    );
    expect(curriculumFoundationMigration).toContain(
      "revoke all on function public.publish_curriculum_version(text, text) from anon, authenticated",
    );
  });
});

describe("Agent runtime migration", () => {
  it("creates agent_runs, agent_steps, agent_run_events and idempotency_keys", () => {
    for (const table of [
      "agent_runs",
      "agent_steps",
      "agent_run_events",
      "idempotency_keys",
    ]) {
      expect(agentRuntimeMigration).toContain(`create table if not exists public.${table}`);
    }
  });

  it("enables RLS and revokes direct client access on every agent runtime table", () => {
    for (const table of [
      "agent_runs",
      "agent_steps",
      "agent_run_events",
      "idempotency_keys",
    ]) {
      expect(agentRuntimeMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(agentRuntimeMigration).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
    }
  });

  it("constrains agent run type and status", () => {
    expect(agentRuntimeMigration).toContain(
      "check (agent_type in ('curriculum_builder', 'tutor'))",
    );
    expect(agentRuntimeMigration).toContain(
      "status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
    );
  });

  it("makes run idempotency keys globally unique", () => {
    expect(agentRuntimeMigration).toContain(
      "constraint agent_runs_idempotency_key_unique unique (idempotency_key)",
    );
  });

  it("allows at most one non-terminal run per curriculum via a partial unique index", () => {
    expect(agentRuntimeMigration).toContain(
      "create unique index if not exists agent_runs_one_active_per_curriculum_idx",
    );
    expect(agentRuntimeMigration).toContain(
      "where status in ('queued', 'running') and curriculum_id is not null",
    );
  });

  it("restricts curriculum deletes while agent runs reference them", () => {
    expect(agentRuntimeMigration).toContain(
      "references public.curricula(id) on delete restrict",
    );
    expect(agentRuntimeMigration).toContain(
      "references public.curriculum_versions(id) on delete restrict",
    );
  });

  it("enforces step and event uniqueness per run with cascade deletes", () => {
    expect(agentRuntimeMigration).toContain(
      "references public.agent_runs(id) on delete cascade",
    );
    expect(agentRuntimeMigration).toContain(
      "step_type in ('model', 'tool', 'validation', 'persistence')",
    );
    expect(agentRuntimeMigration).toContain(
      "constraint agent_steps_run_step_unique unique (run_id, step_number)",
    );
    expect(agentRuntimeMigration).toContain(
      "constraint agent_run_events_run_seq_unique unique (run_id, seq)",
    );
  });

  it("deduplicates API idempotency keys per user, endpoint and key", () => {
    expect(agentRuntimeMigration).toContain(
      "constraint idempotency_keys_user_endpoint_key_unique unique (user_id, endpoint, key)",
    );
  });

  it("widens the LLM route task check for the dual-agent tasks", () => {
    expect(agentRuntimeMigration).toContain(
      "drop constraint if exists branchmind_llm_routes_task_check",
    );
    expect(agentRuntimeMigration).toContain("'curriculum_research'");
    expect(agentRuntimeMigration).toContain("'curriculum_synthesis'");
    expect(agentRuntimeMigration).toContain("'curriculum_validation'");
    expect(agentRuntimeMigration).toContain("'tutor_chat'");
    expect(agentRuntimeMigration).toContain("'tutor_assessment'");
  });
});

describe("Learning foundation migration", () => {
  it("creates the four Phase 4 learning tables", () => {
    for (const table of [
      "learning_enrollments",
      "learning_node_progress",
      "learning_sessions",
      "learning_messages",
    ]) {
      expect(learningFoundationMigration).toContain(
        `create table if not exists public.${table}`,
      );
    }
  });

  it("binds enrollments to immutable versions and deduplicates learner enrollments", () => {
    expect(learningFoundationMigration).toContain(
      "constraint learning_enrollments_user_version_unique unique (user_id, curriculum_version_id)",
    );
    expect(learningFoundationMigration).toContain(
      "create trigger learning_enrollment_version_guard",
    );
    expect(learningFoundationMigration).toContain(
      "learning enrollment curriculum does not match curriculum version",
    );
  });

  it("guards progress/session nodes and message session scope", () => {
    expect(learningFoundationMigration).toContain(
      "create trigger learning_node_progress_version_guard",
    );
    expect(learningFoundationMigration).toContain(
      "create trigger learning_session_node_version_guard",
    );
    expect(learningFoundationMigration).toContain(
      "create trigger learning_message_session_scope_guard",
    );
  });

  it("keeps learning tables server-mediated and excludes Phase 5 assessment tables", () => {
    for (const table of [
      "learning_enrollments",
      "learning_node_progress",
      "learning_sessions",
      "learning_messages",
    ]) {
      expect(learningFoundationMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(learningFoundationMigration).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
    }
    expect(learningFoundationMigration).not.toMatch(
      /create table if not exists public\.learning_assessments/,
    );
  });
});

describe("Learning assessment migration", () => {
  it("allows Tutor-generated assessments to remain pending until answered", () => {
    expect(learningAssessmentPendingMigration).toContain(
      "alter table public.learning_assessments",
    );
    expect(learningAssessmentPendingMigration).toContain(
      "alter column answer_json drop not null",
    );
  });

  it("creates exercises and server-scored assessments with bounded scores", () => {
    expect(learningAssessmentMigration).toContain(
      "create table if not exists public.curriculum_exercises",
    );
    expect(learningAssessmentMigration).toContain(
      "create table if not exists public.learning_assessments",
    );
    expect(learningAssessmentMigration).toContain(
      "exercise_type in ('quiz', 'open', 'code', 'project')",
    );
    expect(learningAssessmentMigration).toContain(
      "constraint learning_assessments_score_range check (score >= 0 and score <= 1)",
    );
  });

  it("deduplicates answers and guards assessment version/session scope", () => {
    expect(learningAssessmentMigration).toContain(
      "learning_assessments_dedup_idx",
    );
    expect(learningAssessmentMigration).toContain(
      "create trigger learning_assessment_scope_guard",
    );
    expect(learningAssessmentMigration).toContain(
      "assessment exercise does not belong to enrollment node",
    );
  });

  it("keeps exercises and assessments server-mediated", () => {
    for (const table of ["curriculum_exercises", "learning_assessments"]) {
      expect(learningAssessmentMigration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(learningAssessmentMigration).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
    }
  });
});

describe("Security events migration", () => {
  it("creates hash-only security event records with request metadata support", () => {
    expect(securityEventsMigration).toContain(
      "create table if not exists public.security_events",
    );
    for (const column of [
      "id text primary key",
      "user_id text",
      "run_id text",
      "rule text not null",
      "domain text",
      "content_hash text not null",
      "metadata_json jsonb not null",
      "created_at timestamptz not null",
    ]) {
      expect(securityEventsMigration).toContain(column);
    }
    expect(securityEventsMigration).not.toContain("content text");
    expect(securityEventsMigration).not.toContain("body text");
  });

  it("keeps security event storage server-mediated and indexed for audit lookup", () => {
    expect(securityEventsMigration).toContain(
      "alter table public.security_events enable row level security",
    );
    expect(securityEventsMigration).toContain(
      "revoke all on public.security_events from anon, authenticated",
    );
    expect(securityEventsMigration).toContain(
      "security_events_created_at_idx",
    );
    expect(securityEventsMigration).toContain("security_events_run_id_idx");
  });
});
