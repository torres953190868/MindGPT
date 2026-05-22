import { describe, expect, it } from "vitest";
import { getAdminEmails, isAdminEmail } from "@/lib/server/admin-auth";

describe("admin auth helpers", () => {
  it("normalizes the admin email allowlist", () => {
    expect([...getAdminEmails(" Alice@Example.com, bob@example.com ,, ")]).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("allows only emails in the configured allowlist", () => {
    const env = "admin@branchmind.app,ops@branchmind.app";

    expect(isAdminEmail("ADMIN@branchmind.app", env)).toBe(true);
    expect(isAdminEmail(" user@branchmind.app ", env)).toBe(false);
    expect(isAdminEmail(null, env)).toBe(false);
  });
});
