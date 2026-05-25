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
});
