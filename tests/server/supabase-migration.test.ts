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
});
